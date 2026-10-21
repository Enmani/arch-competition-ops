// Geocode one address candidate: Chinese providers first for Chinese notices, then Nominatim over
// the conservative query permutations, then Photon as the last resort.
import { getJurisdictionEntry } from "../jurisdictions";
import type { AddressCandidate, GeocodeResult, PreviewOpportunity } from "../types";
import { isChinaJurisdiction } from "./china";
import { resolveFallbackGeocodeQueries, resolveGeocodeQueries } from "./queries";
import {
  geocodeViaAmap,
  geocodeViaBaidu,
  geocodeViaNominatim,
  geocodeViaPhoton,
} from "./providers";
import type { GeocodingContext } from "./services";

const geocodeViaChinaProviders = async (
  context: GeocodingContext,
  opportunity: PreviewOpportunity,
  candidate: AddressCandidate,
  queries: string[],
) => {
  if (!isChinaJurisdiction(opportunity)) {
    return null;
  }

  for (const query of queries) {
    const baidu = await geocodeViaBaidu(context, candidate, query);
    if (baidu) {
      return baidu;
    }
    const amap = await geocodeViaAmap(context, candidate, query);
    if (amap) {
      return amap;
    }
  }
  return null;
};

export const geocodePreciseAddress = async (
  context: GeocodingContext,
  opportunity: PreviewOpportunity,
  candidate: AddressCandidate,
): Promise<GeocodeResult | null> => {
  await context.services.cache.load();

  const fallbackQueries =
    candidate.kind === "street_address" || candidate.kind === "street"
      ? resolveFallbackGeocodeQueries(opportunity, candidate)
      : [];
  const allQueries = [...resolveGeocodeQueries(opportunity, candidate), ...fallbackQueries];
  const countryCode = getJurisdictionEntry(opportunity.jurisdictionKey)?.geocoderCountryCode;

  const chinese = await geocodeViaChinaProviders(context, opportunity, candidate, allQueries);
  if (chinese) {
    return chinese;
  }

  const nominatim = await geocodeViaNominatim(context, candidate, allQueries, countryCode);
  if (nominatim) {
    return nominatim;
  }

  return geocodeViaPhoton(context, opportunity, candidate);
};
