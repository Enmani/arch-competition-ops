// Chinese-language road, campus and locality hint helpers.
import { cleanAddressCandidate, cleanLocalityHint, cleanSiteCandidate } from "./clean";
import {
  chineseAdministrativeUnitPattern,
  chineseFacilityCorePattern,
  chineseRoadInsideSitePattern,
  chineseRoadOnlyPattern,
  chineseRoadWithNumberPattern,
  chineseWeakSiteNoisePattern,
} from "./patterns";
import { normalizeWhitespace } from "../text/normalize";
import type { AddressCandidateKind } from "../types";

export const extractChineseContextLocalityHint = (
  normalizedText: string,
  matchIndex: number,
  rawAddress: string,
) => {
  const normalizeChineseLocalityParts = (parts: string[]) =>
    cleanLocalityHint(
      [...new Set(parts.filter((value) => value && !/\d/.test(value) && value !== "棚户区"))].join(""),
    );

  const contextBefore = normalizedText.slice(Math.max(0, matchIndex - 96), matchIndex);
  const nearbyContext = normalizedText.slice(
    Math.max(0, matchIndex - 140),
    Math.min(normalizedText.length, matchIndex + rawAddress.length + 40),
  );
  const explicitLocationLeadMatch = nearbyContext.match(
    new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,3})[^。；;\n]{0,40}?(?:位于|建设地点[：:]?)`, "u"),
  );
  if (explicitLocationLeadMatch?.[1]) {
    return cleanLocalityHint(explicitLocationLeadMatch[1]);
  }

  const nearbyAdministrativeMatches = [
    ...nearbyContext.matchAll(new RegExp(chineseAdministrativeUnitPattern, "gu")),
  ]
    .map((entry) => normalizeWhitespace(entry[0] ?? ""));
  if (nearbyAdministrativeMatches.length > 0) {
    const normalizedHint = normalizeChineseLocalityParts(nearbyAdministrativeMatches.slice(0, 4));
    if (normalizedHint) {
      return normalizedHint;
    }
  }

  const directAdministrativeMatches = [
    ...contextBefore.matchAll(new RegExp(chineseAdministrativeUnitPattern, "gu")),
  ].map((entry) => normalizeWhitespace(entry[0] ?? ""));

  if (directAdministrativeMatches.length > 0) {
    const normalizedHint = normalizeChineseLocalityParts(directAdministrativeMatches.slice(-4));
    if (normalizedHint) {
      return normalizedHint;
    }
  }

  const inlineMatch = normalizedText
    .slice(Math.max(0, matchIndex - 120), Math.min(normalizedText.length, matchIndex + rawAddress.length + 40))
    .match(new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,3})[^。；;，,\n]{0,40}${rawAddress}`, "u"));

  return inlineMatch?.[1] ? cleanLocalityHint(inlineMatch[1]) : null;
};

export const extractChineseStreetRoadFromSite = (value: string) => {
  const embeddedRoadMatch = value.match(chineseRoadInsideSitePattern);
  if (!embeddedRoadMatch?.[1]) {
    return null;
  }

  const road = normalizeWhitespace(embeddedRoadMatch[1]);
  const narrowedRoad = road.replace(/^.*(?=(?:[\p{Script=Han}]{2,6}(?:路|街|道)$))/u, "");
  return cleanAddressCandidate(narrowedRoad || road);
};

export const extractChineseFacilityCore = (value: string) => {
  const facilityMatch = normalizeWhitespace(value).match(chineseFacilityCorePattern);
  return facilityMatch?.[1] ? cleanSiteCandidate(facilityMatch[1]) : null;
};

export const extractChineseInstitutionBaseName = (value: string) => {
  const normalizedValue = normalizeWhitespace(value);
  const baseInstitutionMatch = normalizedValue.match(
    /((?:[\p{Script=Han}]{2,24}(?:大学|学院|学校|中学|小学|医院|人民医院)))/u,
  );
  return baseInstitutionMatch?.[1] ? cleanSiteCandidate(baseInstitutionMatch[1]) : null;
};

export const expandChineseRoadNumberVariant = (value: string) => {
  const normalizedValue = normalizeWhitespace(value);
  if (!/[\p{Script=Han}]/u.test(normalizedValue)) {
    return null;
  }

  const spacedVariant = normalizedValue.replace(
    /((?:[\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)))(\d+)号/u,
    "$1 $2 号",
  );
  return spacedVariant !== normalizedValue ? spacedVariant : null;
};

export const extractChineseRoadCandidates = (value: string) => {
  const normalizedValue = normalizeWhitespace(value);
  const results: string[] = [];
  const normalizeChineseRoadNumberAddress = (candidateValue: string) =>
    normalizeWhitespace(candidateValue).replace(
      /((?:[\p{Script=Han}\p{L}\p{N}-]{1,30}(?:路|街(?!区)|道|巷|胡同|正街|大道)))\s*(\d+)\s*号/u,
      "$1$2号",
    );
  const pushRoad = (candidateValue: string | null | undefined) => {
    const cleaned = candidateValue ? cleanAddressCandidate(candidateValue) : null;
    if (!cleaned || results.includes(cleaned)) {
      return;
    }

    results.push(cleaned);
  };

  normalizedValue
    .split(/[、，,；;]/u)
    .map((segment) => normalizeWhitespace(segment))
    .filter(Boolean)
    .forEach((segment) => {
      const preciseMatch = segment.match(chineseRoadWithNumberPattern);
      if (preciseMatch?.[1]) {
        pushRoad(normalizeChineseRoadNumberAddress(preciseMatch[1]));
      }

      const roadOnlyMatch = segment.match(chineseRoadOnlyPattern);
      if (roadOnlyMatch?.[1]) {
        pushRoad(roadOnlyMatch[1]);
      }
    });

  return results;
};

export const deriveLocalityHintFromChineseAddress = (value: string) => {
  const localityParts = [...value.matchAll(new RegExp(chineseAdministrativeUnitPattern, "gu"))]
    .map((match) => normalizeWhitespace(match[0] ?? ""))
    .filter(Boolean);
  if (localityParts.length === 0) {
    return null;
  }

  return cleanLocalityHint(localityParts.join(""));
};

export const isInvalidChineseStreetCandidate = (rawAddress: string, address: string) =>
  /(?:片区|街区)/u.test(rawAddress) || /(?:片区|街区)/u.test(address);

export const extractGlobalChineseLocalityHint = (normalizedText: string) => {
  const directConstructionLocationMatch = normalizedText.match(
    new RegExp(String.raw`建设地点[：:]?\s*((?:${chineseAdministrativeUnitPattern}){1,4})`, "u"),
  );
  if (directConstructionLocationMatch?.[1]) {
    return cleanLocalityHint(directConstructionLocationMatch[1]);
  }

  const broaderLocationLeadMatch = normalizedText.match(
    new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,4})[^。；;\n]{0,40}?(?:位于|建设地点[：:]?)`, "u"),
  );
  if (broaderLocationLeadMatch?.[1]) {
    return cleanLocalityHint(broaderLocationLeadMatch[1]);
  }

  const titleAdministrativeLeadMatch = normalizedText.match(
    new RegExp(String.raw`^(?:\d{4}年)?((?:${chineseAdministrativeUnitPattern}){1,4})`, "u"),
  );
  if (titleAdministrativeLeadMatch?.[1]) {
    return cleanLocalityHint(titleAdministrativeLeadMatch[1]);
  }

  return null;
};

export const isChineseCandidateProbablyTooBroad = (address: string, kind: AddressCandidateKind) => {
  if (chineseWeakSiteNoisePattern.test(address)) {
    return true;
  }

  if (kind === "site") {
    return /(?:位于|建设地点)/u.test(address) || address.length > 26;
  }

  return /(?:位于|建设地点|街区)/u.test(address) || address.length > 18;
};
