// Decide whether a Photon feature matches an address candidate.
import { pickOpportunityDisplayLocality, sanitizeOpportunityLocationLabel } from "../location";
import { getJurisdictionEntry } from "../jurisdictions";
import {
  extractComparableHouseNumber,
  haveLocalityTokenMatch,
  haveStreetCoreTokenMatch,
} from "../address/compare";
import { normalizeLocalityForGeocoderSearch, normalizeLocalityHintForGeocoder } from "./normalize";
import {
  normalizeWhitespace,
  splitComparisonTokens,
} from "../text/normalize";
import type { AddressCandidate, PhotonFeature, PreviewOpportunity } from "../types";

export const resolveCountryComparisonTokens = (jurisdictionKey: string | null | undefined) =>
  (getJurisdictionEntry(jurisdictionKey)?.comparisonNames ?? []).flatMap((value) =>
    splitComparisonTokens(value),
  );

export const normalizePhotonLocalityValue = (feature: PhotonFeature) =>
  normalizeWhitespace(
    [
      feature.properties?.city,
      feature.properties?.district,
      feature.properties?.county,
      feature.properties?.state,
    ]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" "),
  );

export const normalizeChinesePlaceStem = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return "";
  }

  return normalizeWhitespace(value)
    .replace(/[^\p{Script=Han}\p{N}]+/gu, "")
    .replace(/\d+号?$/u, "")
    .replace(/(?:管委会|政务中心|医疗服务中心|第一实验学校|中学|学校|南口|西口|东口|北口)$/u, "")
    .replace(/(?:托幼用地|二类居住用地|产业园区|科技园区|建设项目|项目)$/u, "")
    .replace(/(?:地块.*|片区.*|街区.*|园区.*|基地.*)$/u, "");
};

export const haveChineseLoosePlaceMatch = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  const left = normalizeChinesePlaceStem(leftValue);
  const right = normalizeChinesePlaceStem(rightValue);
  if (!left || !right) {
    return false;
  }

  return left.includes(right) || right.includes(left);
};

export const doesPhotonFeatureMatchCandidate = (
  feature: PhotonFeature,
  candidate: AddressCandidate,
  opportunity: PreviewOpportunity,
) => {
  const coordinates = feature.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return false;
  }

  const featureStreet = feature.properties?.street ?? feature.properties?.name ?? null;
  const localityHint =
    normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(candidate.localityHint)) ??
    normalizeLocalityForGeocoderSearch(pickOpportunityDisplayLocality(opportunity)) ??
    normalizeLocalityForGeocoderSearch(sanitizeOpportunityLocationLabel(opportunity.locationLabel));
  const featureLocality = normalizePhotonLocalityValue(feature);
  const candidateLooksChinese =
    /[\p{Script=Han}]/u.test(candidate.address) ||
    /[\p{Script=Han}]/u.test(candidate.localityHint ?? "");
  const candidateHouseNumber = extractComparableHouseNumber(candidate.address);
  const featureHouseNumber = extractComparableHouseNumber(feature.properties?.housenumber ?? null);
  const countryTokens = resolveCountryComparisonTokens(opportunity.jurisdictionKey);
  const featureCountryTokens = splitComparisonTokens(feature.properties?.country ?? "");
  const featureName = feature.properties?.name ?? null;

  if (candidate.kind === "locality") {
    if (countryTokens.length > 0 && !countryTokens.some((token) => featureCountryTokens.includes(token))) {
      return false;
    }

    if (
      haveLocalityTokenMatch(candidate.address, featureName) ||
      (candidateLooksChinese && haveChineseLoosePlaceMatch(candidate.address, featureName))
    ) {
      return true;
    }

    return localityHint ? haveLocalityTokenMatch(localityHint, featureLocality) : true;
  }

  if (candidateHouseNumber && featureHouseNumber && candidateHouseNumber !== featureHouseNumber) {
    return false;
  }

  if (countryTokens.length > 0 && !countryTokens.some((token) => featureCountryTokens.includes(token))) {
    return false;
  }

  if (!haveStreetCoreTokenMatch(candidate.address, featureStreet)) {
    if (
      !(
        candidateLooksChinese &&
        (haveStreetCoreTokenMatch(candidate.address, featureName) ||
          haveLocalityTokenMatch(candidate.address, featureName) ||
          haveChineseLoosePlaceMatch(candidate.address, featureName))
      )
    ) {
      return false;
    }
  }

  if (
    localityHint &&
    !haveLocalityTokenMatch(localityHint, featureLocality) &&
    !(candidateLooksChinese && haveChineseLoosePlaceMatch(localityHint, featureLocality))
  ) {
    return false;
  }

  return true;
};
