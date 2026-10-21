// The four geocoding providers. Each function turns one query into a LookupOutcome through
// `cachedLookup`, so caching, in-flight de-duplication and the "failures are never cached" rule
// are identical everywhere. Acceptance rules live in ./accept and ./photon-match.
import type {
  AddressCandidate,
  AmapGeocodeResponse,
  BaiduGeocodeResponse,
  GeocodeResult,
  NominatimSearchResult,
  PhotonSearchResult,
  PreviewOpportunity,
} from "../types";
import {
  getDefaultPrecisionForCandidate,
  isAcceptableAmapGeocodeResult,
  isAcceptableBaiduGeocodeResult,
  isAcceptableGeocodeResult,
  resolveChineseGeocodePrecision,
  resolveGeocodePrecision,
} from "./accept";
import { buildProviderGeocodeCacheKey } from "./cache";
import { bd09ToWgs84, buildBaiduSignedUrl, gcj02ToWgs84, parseFiniteCoordinate } from "./china";
import { cachedLookup, type LookupOutcome } from "./lookup";
import {
  expandAddressVariantsForGeocoder,
  expandLocalityVariantsForGeocoder,
  normalizeLocalityForGeocoderSearch,
  normalizeLocalityHintForGeocoder,
} from "./normalize";
import { doesPhotonFeatureMatchCandidate } from "./photon-match";
import type { GeocodingContext } from "./services";
import { pickOpportunityDisplayLocality, sanitizeOpportunityLocationLabel } from "../location";
import { normalizeWhitespace } from "../text/normalize";

const FAILED: LookupOutcome = { status: "failed" };
const EMPTY: LookupOutcome = { status: "empty" };

export const geocodeViaNominatim = async (
  { budget, services }: GeocodingContext,
  candidate: AddressCandidate,
  queries: string[],
  countryCode: string | undefined,
): Promise<GeocodeResult | null> => {
  for (const query of queries) {
    const result = await cachedLookup(
      services.cache,
      buildProviderGeocodeCacheKey("nominatim", query),
      getDefaultPrecisionForCandidate(candidate),
      async () => {
        const params = new URLSearchParams({
          addressdetails: "1",
          format: "jsonv2",
          limit: "1",
          q: query,
        });
        if (countryCode) {
          params.set("countrycodes", countryCode);
        }
        const response = await services.nominatim.getJson(
          `${services.config.nominatimUrl}?${params.toString()}`,
          budget,
        );
        if (response.kind === "failed") {
          return FAILED;
        }

        const payload = response.json as NominatimSearchResult[] | undefined;
        const accepted = Array.isArray(payload)
          ? payload.find((entry) => isAcceptableGeocodeResult(entry, candidate))
          : undefined;
        const lat = Number(accepted?.lat);
        const lng = Number(accepted?.lon);
        if (!accepted || !Number.isFinite(lat) || !Number.isFinite(lng)) {
          services.log("nominatim-rejected", { query });
          return EMPTY;
        }
        return {
          result: { lat, lng, precision: resolveGeocodePrecision(accepted, candidate) },
          status: "hit",
        };
      },
    );
    if (result) {
      return result;
    }
  }
  return null;
};

export const geocodeViaPhoton = async (
  { budget, services }: GeocodingContext,
  opportunity: PreviewOpportunity,
  candidate: AddressCandidate,
): Promise<GeocodeResult | null> => {
  const addressVariants =
    candidate.kind === "locality"
      ? expandLocalityVariantsForGeocoder(candidate.address)
      : expandAddressVariantsForGeocoder(candidate.address);

  for (const addressVariant of addressVariants) {
    const query = normalizeWhitespace(
      [
        normalizeLocalityForGeocoderSearch(addressVariant) ?? addressVariant,
        normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(candidate.localityHint)),
        normalizeLocalityForGeocoderSearch(pickOpportunityDisplayLocality(opportunity)),
        normalizeLocalityForGeocoderSearch(sanitizeOpportunityLocationLabel(opportunity.locationLabel)),
        opportunity.jurisdictionLabel,
      ]
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .join(" "),
    );
    if (!query) {
      continue;
    }

    const result = await cachedLookup(
      services.cache,
      buildProviderGeocodeCacheKey("photon", query),
      getDefaultPrecisionForCandidate(candidate),
      async () => {
        const params = new URLSearchParams({ limit: "5", q: query });
        const response = await services.photon.getJson(
          `${services.config.photonUrl}?${params.toString()}`,
          budget,
        );
        if (response.kind === "failed") {
          return FAILED;
        }

        const payload = response.json as PhotonSearchResult | undefined;
        const coordinates = payload?.features?.find((feature) =>
          doesPhotonFeatureMatchCandidate(feature, candidate, opportunity),
        )?.geometry?.coordinates;
        const [lng, lat] = coordinates ?? [];
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
          return EMPTY;
        }
        return {
          result: { lat, lng, precision: getDefaultPrecisionForCandidate(candidate) },
          status: "hit",
        };
      },
    );
    if (result) {
      return result;
    }
  }
  return null;
};

export const geocodeViaBaidu = async (
  { budget, services }: GeocodingContext,
  candidate: AddressCandidate,
  query: string,
): Promise<GeocodeResult | null> => {
  const { baiduAk, baiduSk, baiduUrl } = services.config;
  if (!baiduAk) {
    return null;
  }

  return cachedLookup(
    services.cache,
    buildProviderGeocodeCacheKey("baidu", query),
    getDefaultPrecisionForCandidate(candidate),
    async () => {
      const params = new URLSearchParams({
        address: query,
        ak: baiduAk,
        output: "json",
        ret_coordtype: "bd09ll",
      });
      const response = await services.baidu.getJson(
        buildBaiduSignedUrl(baiduUrl, params, baiduSk),
        budget,
      );
      if (response.kind === "failed") {
        return FAILED;
      }

      const payload = response.json as BaiduGeocodeResponse | undefined;
      const accepted =
        payload?.status === 0 || payload?.status === "0" ? (payload.result ?? null) : null;
      if (!accepted || !isAcceptableBaiduGeocodeResult(accepted, candidate)) {
        return EMPTY;
      }
      const rawLat = parseFiniteCoordinate(accepted.location?.lat);
      const rawLng = parseFiniteCoordinate(accepted.location?.lng);
      if (rawLat === null || rawLng === null) {
        return EMPTY;
      }
      const converted = bd09ToWgs84(rawLat, rawLng);
      return {
        result: {
          lat: converted.lat,
          lng: converted.lng,
          precision: resolveChineseGeocodePrecision(candidate, accepted.level),
        },
        status: "hit",
      };
    },
  );
};

export const geocodeViaAmap = async (
  { budget, services }: GeocodingContext,
  candidate: AddressCandidate,
  query: string,
): Promise<GeocodeResult | null> => {
  const { amapKey, amapUrl } = services.config;
  if (!amapKey) {
    return null;
  }

  return cachedLookup(
    services.cache,
    buildProviderGeocodeCacheKey("amap", query),
    getDefaultPrecisionForCandidate(candidate),
    async () => {
      const params = new URLSearchParams({ address: query, key: amapKey, output: "json" });
      const response = await services.amap.getJson(`${amapUrl}?${params.toString()}`, budget);
      if (response.kind === "failed") {
        return FAILED;
      }

      const payload = response.json as AmapGeocodeResponse | undefined;
      const first = payload?.geocodes?.[0];
      if (
        !first ||
        !(payload?.status === "1" || payload?.status === 1) ||
        !isAcceptableAmapGeocodeResult(first, candidate)
      ) {
        return EMPTY;
      }
      const [rawLngValue, rawLatValue] = first.location?.split(",") ?? [];
      const rawLat = parseFiniteCoordinate(rawLatValue);
      const rawLng = parseFiniteCoordinate(rawLngValue);
      if (rawLat === null || rawLng === null) {
        return EMPTY;
      }
      const converted = gcj02ToWgs84(rawLat, rawLng);
      return {
        result: {
          lat: converted.lat,
          lng: converted.lng,
          precision: resolveChineseGeocodePrecision(candidate, first.level),
        },
        status: "hit",
      };
    },
  );
};
