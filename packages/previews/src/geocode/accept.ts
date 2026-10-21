// Accept or reject geocoder results and derive their precision.
import {
  acceptedBroadGeocodeAddressTypes,
  acceptedExactGeocodeAddressTypes,
  acceptedGeocodeCategories,
  acceptedLocalityGeocodeCategories,
  acceptedSiteGeocodeCategories,
  rejectedGeocodeAddressTypes,
} from "../data";
import { hasStreetNumber } from "../address/compare";
import { parseFiniteCoordinate } from "./china";
import type {
  AddressCandidate,
  AmapGeocodeResult,
  BaiduGeocodeResult,
  NominatimSearchResult,
  SatellitePreviewPrecision,
} from "../types";

export const calculateBoundingBoxDiagonalKm = (boundingBox: string[] | undefined) => {
  if (!Array.isArray(boundingBox) || boundingBox.length !== 4) {
    return null;
  }

  const [south, north, west, east] = boundingBox.map((value) => Number(value));
  if (![south, north, west, east].every((value) => Number.isFinite(value))) {
    return null;
  }

  const latitudeSpanKm = Math.abs(north - south) * 111.32;
  const midpointLatitude = ((south + north) / 2) * (Math.PI / 180);
  const longitudeSpanKm = Math.abs(east - west) * 111.32 * Math.cos(midpointLatitude);
  return Math.sqrt(latitudeSpanKm ** 2 + longitudeSpanKm ** 2);
};

export const resolveGeocodePrecision = (
  result: Pick<NominatimSearchResult, "addresstype" | "type">,
  candidate: AddressCandidate,
): SatellitePreviewPrecision => {
  const addresstype = result.addresstype?.toLowerCase() ?? "";
  const type = result.type?.toLowerCase() ?? "";
  const kind = addresstype || type;

  if (candidate.kind === "locality") {
    return kind === "city" || kind === "town" || kind === "municipality" ? "locality" : "locality";
  }

  if (candidate.kind === "site") {
    return kind === "square" ? "square" : "site";
  }

  if (kind === "square") {
    return "square";
  }

  if (kind === "city" || kind === "town" || kind === "municipality") {
    return "city";
  }

  if (candidate.kind === "street_address") {
    return "address";
  }

  return "street";
};

export const isBroadStreetLikeResult = (result: NominatimSearchResult) => {
  const addresstype = result.addresstype?.toLowerCase() ?? "";
  const type = result.type?.toLowerCase() ?? "";
  return acceptedBroadGeocodeAddressTypes.has(addresstype) || acceptedBroadGeocodeAddressTypes.has(type);
};

export const getDefaultPrecisionForCandidate = (
  candidate: Pick<AddressCandidate, "address" | "kind">,
): SatellitePreviewPrecision => {
  if (candidate.kind === "locality") {
    return "locality";
  }

  if (candidate.kind === "site") {
    return "site";
  }

  if (candidate.kind === "street_address") {
    return "address";
  }

  return hasStreetNumber(candidate.address) ? "address" : "street";
};

export const resolveChineseGeocodePrecision = (
  candidate: AddressCandidate,
  level: string | null | undefined,
) => {
  const normalizedLevel = level?.trim().toLowerCase() ?? "";
  if (
    normalizedLevel === "门址" ||
    normalizedLevel === "门牌号" ||
    normalizedLevel === "house number" ||
    normalizedLevel === "门址点"
  ) {
    return "address";
  }

  if (
    normalizedLevel === "道路" ||
    normalizedLevel === "street" ||
    normalizedLevel === "road" ||
    normalizedLevel === "乡镇街道"
  ) {
    return candidate.kind === "locality" ? "locality" : "street";
  }

  if (
    normalizedLevel === "兴趣点" ||
    normalizedLevel === "poi" ||
    normalizedLevel === "开发区" ||
    normalizedLevel === "村庄" ||
    normalizedLevel === "landmark"
  ) {
    return candidate.kind === "locality" ? "locality" : "site";
  }

  if (
    normalizedLevel === "区县" ||
    normalizedLevel === "city" ||
    normalizedLevel === "city区" ||
    normalizedLevel === "乡镇" ||
    normalizedLevel === "district" ||
    normalizedLevel === "country"
  ) {
    return candidate.kind === "locality" ? "locality" : "city";
  }

  return getDefaultPrecisionForCandidate(candidate);
};

export const isAcceptableBaiduGeocodeResult = (
  result: BaiduGeocodeResult,
  candidate: AddressCandidate,
) => {
  const lat = parseFiniteCoordinate(result.location?.lat);
  const lng = parseFiniteCoordinate(result.location?.lng);
  if (lat === null || lng === null) {
    return false;
  }

  const confidence = parseFiniteCoordinate(result.confidence);
  const precise = parseFiniteCoordinate(result.precise);
  const level = result.level?.trim().toLowerCase() ?? "";

  if (candidate.kind === "locality") {
    return true;
  }

  if (candidate.kind === "street_address") {
    if (precise === 1) {
      return true;
    }

    return (confidence ?? 0) >= 45;
  }

  if (candidate.kind === "site") {
    if (level.includes("poi") || level.includes("兴趣点")) {
      return true;
    }

    return (confidence ?? 0) >= 30;
  }

  if (candidate.kind === "street") {
    if (
      level.includes("road") ||
      level.includes("street") ||
      level.includes("道路") ||
      level.includes("乡镇街道")
    ) {
      return true;
    }

    return (confidence ?? 0) >= 30;
  }

  return true;
};

export const isAcceptableAmapGeocodeResult = (
  result: AmapGeocodeResult,
  candidate: AddressCandidate,
) => {
  const location = result.location?.split(",");
  if (!location || location.length < 2) {
    return false;
  }

  const lng = parseFiniteCoordinate(location[0]);
  const lat = parseFiniteCoordinate(location[1]);
  if (lat === null || lng === null) {
    return false;
  }

  const level = result.level?.trim().toLowerCase() ?? "";
  if (candidate.kind === "locality") {
    return true;
  }

  if (candidate.kind === "street_address") {
    return (
      level === "门牌号" ||
      level === "道路" ||
      level === "street" ||
      level === "road" ||
      hasStreetNumber(candidate.address)
    );
  }

  if (candidate.kind === "street") {
    return level !== "省" && level !== "city" && level !== "区县";
  }

  if (candidate.kind === "site") {
    return level !== "省";
  }

  return true;
};

export const isAcceptableGeocodeResult = (
  result: NominatimSearchResult,
  candidate: AddressCandidate,
) => {
  const addresstype = result.addresstype?.toLowerCase() ?? "";
  const category = result.category?.toLowerCase() ?? "";
  const type = result.type?.toLowerCase() ?? "";
  const diagonalKm = calculateBoundingBoxDiagonalKm(result.boundingbox);
  const hasHouseNumber = Boolean(result.address?.house_number);
  const isLocalityCandidate = candidate.kind === "locality";

  if (!isLocalityCandidate && (rejectedGeocodeAddressTypes.has(addresstype) || rejectedGeocodeAddressTypes.has(type))) {
    return false;
  }

  if (category && !acceptedGeocodeCategories.has(category)) {
    if (candidate.kind === "locality" && acceptedLocalityGeocodeCategories.has(category)) {
      // Administrative boundary results are expected for city/locality lookups.
    } else
    if (candidate.kind !== "site" || !acceptedSiteGeocodeCategories.has(category)) {
      return false;
    }
  }

  if (
    addresstype.length > 0 &&
    !(addresstype === "place" && hasHouseNumber) &&
    !acceptedExactGeocodeAddressTypes.has(addresstype) &&
    candidate.kind !== "locality"
  ) {
    if (!(candidate.kind === "street" && isBroadStreetLikeResult(result))) {
      return false;
    }
  }

  if (diagonalKm === null) {
    return true;
  }

  if (candidate.kind === "locality") {
    if (addresstype === "city" || type === "city" || addresstype === "town" || type === "town") {
      return diagonalKm <= 14;
    }

    if (addresstype === "municipality" || type === "municipality") {
      return diagonalKm <= 10;
    }

    return diagonalKm <= 18;
  }

  if (candidate.kind === "site") {
    return diagonalKm <= 8;
  }

  if (candidate.kind === "street_address") {
    return diagonalKm <= 4;
  }

  return diagonalKm <= 18;
};
