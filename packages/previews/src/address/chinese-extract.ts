// Extract address candidates from Chinese notice text.
import {
  deriveLocalityHintFromChineseAddress,
  extractChineseContextLocalityHint,
  extractChineseRoadCandidates,
  extractChineseStreetRoadFromSite,
  extractGlobalChineseLocalityHint,
  isChineseCandidateProbablyTooBroad,
  isInvalidChineseStreetCandidate,
} from "./chinese";
import {
  cleanAddressCandidate,
  cleanLocalityHint,
  cleanSiteCandidate,
  pickMoreSpecificLocalityHint,
} from "./clean";
import {
  dedupeAddressCandidates,
  dedupeRawAddressCandidates,
  getAddressCandidateComparisonKey,
} from "./compare";
import {
  chineseAdministrativeSitePattern,
  chineseAdministrativeUnitPattern,
  chineseCompoundPlacePattern,
  chineseDirectionalRoadPattern,
  chineseInstitutionCampusPattern,
  chinesePreciseSiteFieldPattern,
  chinesePreciseStreetFieldPattern,
  chineseRoadPattern,
  chineseShortSiteAnchorPattern,
  chineseStreetAsLocalityPattern,
  genericChineseRegenerationSitePattern,
} from "./patterns";
import { normalizeComparisonText, normalizeWhitespace } from "../text/normalize";
import type { AddressCandidate, AddressCandidateKind } from "../types";

export const extractChineseAddressCandidatesFromText = (
  normalizedText: string,
  source: AddressCandidate["source"],
) => {
  const candidates: AddressCandidate[] = [];
  const seen = new Set<string>();
  const globalLocalityHint = extractGlobalChineseLocalityHint(normalizedText);
  const sentenceLocalityHint = (
    rawAddress: string,
    matchIndex: number,
    fallbackLocalityHint?: string | null,
  ) =>
    pickMoreSpecificLocalityHint(
      extractChineseContextLocalityHint(normalizedText, matchIndex, rawAddress),
      fallbackLocalityHint ?? globalLocalityHint,
    );

  const pushCandidate = (
    rawAddress: string,
    kind: AddressCandidateKind,
    matchIndex: number,
    forcedLocalityHint?: string | null,
  ) => {
    const address =
      kind === "site" ? cleanSiteCandidate(rawAddress) : cleanAddressCandidate(rawAddress);
    if (!address) {
      return;
    }

    const localityHint = sentenceLocalityHint(rawAddress, matchIndex, forcedLocalityHint);
    const candidate = {
      address,
      kind,
      localityHint,
      source,
    } satisfies AddressCandidate;
    if (kind === "street" && isInvalidChineseStreetCandidate(rawAddress, address)) {
      return;
    }
    if (isChineseCandidateProbablyTooBroad(candidate.address, candidate.kind)) {
      return;
    }
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    candidates.push(candidate);
  };

  for (const match of normalizedText.matchAll(chinesePreciseSiteFieldPattern)) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const localityHint = deriveLocalityHintFromChineseAddress(rawAddress);
    pushCandidate(rawAddress, "site", match.index, localityHint);
  }

  for (const match of normalizedText.matchAll(chinesePreciseStreetFieldPattern)) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const localityHint = deriveLocalityHintFromChineseAddress(rawAddress);
    const roadCandidates = extractChineseRoadCandidates(rawAddress);
    if (roadCandidates.length > 0) {
      const preciseRoadCandidate =
        roadCandidates.find((candidateValue) => /\d+\s*号$/u.test(candidateValue)) ??
        roadCandidates[0];
      pushCandidate(
        preciseRoadCandidate,
        /\d+\s*号$/u.test(preciseRoadCandidate) ? "street_address" : "street",
        match.index ?? 0,
        localityHint,
      );
      continue;
    }

    pushCandidate(rawAddress, /\d+号$/u.test(rawAddress) ? "street_address" : "street", match.index, localityHint);
  }

  for (const match of normalizedText.matchAll(
    new RegExp(
      String.raw`(?:建设地点[：:]?|位于|坐落于)?(?:((?:${chineseAdministrativeUnitPattern}){1,3}))?[^。；;\n]{0,24}?(${chineseCompoundPlacePattern})`,
      "gu",
    ),
  )) {
    const rawAddress = normalizeWhitespace(match[2] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const explicitLocalityHint = cleanLocalityHint(match[1] ?? "");
    const address = cleanSiteCandidate(rawAddress);
    if (!address || isChineseCandidateProbablyTooBroad(address, "site")) {
      continue;
    }

    const candidate = {
      address,
      kind: "site" as const,
      localityHint: pickMoreSpecificLocalityHint(
        pickMoreSpecificLocalityHint(
          explicitLocalityHint,
          extractChineseContextLocalityHint(normalizedText, match.index, rawAddress),
        ),
        sentenceLocalityHint(rawAddress, match.index),
      ),
      source,
    } satisfies AddressCandidate;
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);

    const embeddedRoad = extractChineseStreetRoadFromSite(candidate.address);
    if (embeddedRoad) {
      pushCandidate(embeddedRoad, "street", match.index);
    }
  }

  for (const match of normalizedText.matchAll(chineseInstitutionCampusPattern)) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const cleanedAddress = cleanSiteCandidate(rawAddress);
    if (!cleanedAddress) {
      continue;
    }

    const localityHint =
      pickMoreSpecificLocalityHint(
        extractChineseContextLocalityHint(normalizedText, match.index, rawAddress),
        sentenceLocalityHint(rawAddress, match.index),
      ) ?? rawAddress;
    const candidate = {
      address: cleanedAddress,
      kind: "site" as const,
      localityHint,
      source,
    } satisfies AddressCandidate;
    const key = getAddressCandidateComparisonKey(candidate);
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(candidate);
    }

    const embeddedRoad = extractChineseStreetRoadFromSite(rawAddress);
    if (embeddedRoad) {
      const roadCandidate = {
        address: embeddedRoad,
        kind: "street" as const,
        localityHint,
        source,
      } satisfies AddressCandidate;
      if (roadCandidate.address) {
        const roadKey = getAddressCandidateComparisonKey(roadCandidate);
        if (!seen.has(roadKey)) {
          seen.add(roadKey);
          candidates.push(roadCandidate);
        }
      }
    }
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseAdministrativeSitePattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const cleanedAddress = cleanSiteCandidate(rawAddress);
    if (!cleanedAddress || genericChineseRegenerationSitePattern.test(cleanedAddress)) {
      continue;
    }

    const localityLead = normalizeWhitespace(
      rawAddress.match(/^(.*?(?:街道|镇|乡))/u)?.[1] ?? "",
    );
    const candidate = {
      address: cleanedAddress,
      kind: "site" as const,
      localityHint:
        pickMoreSpecificLocalityHint(
          cleanLocalityHint(localityLead),
          sentenceLocalityHint(rawAddress, match.index),
        ) ?? cleanLocalityHint(localityLead),
      source,
    } satisfies AddressCandidate;

    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseShortSiteAnchorPattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const largerAnchorExists = candidates.some(
      (candidate) =>
        candidate.kind === "site" &&
        normalizeComparisonText(candidate.address).includes(normalizeComparisonText(rawAddress)) &&
        normalizeComparisonText(candidate.address) !== normalizeComparisonText(rawAddress),
    );
    if (largerAnchorExists) {
      continue;
    }

    const address = cleanSiteCandidate(rawAddress);
    if (!address || genericChineseRegenerationSitePattern.test(address)) {
      continue;
    }

    pushCandidate(address, "site", match.index);
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseStreetAsLocalityPattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    const candidate = {
      address: rawAddress.replace(/^\d{4}年/u, ""),
      kind: "locality" as const,
      localityHint: pickMoreSpecificLocalityHint(
        extractChineseContextLocalityHint(normalizedText, match.index, rawAddress),
        globalLocalityHint,
      ),
      source,
    } satisfies AddressCandidate;
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  for (const match of normalizedText.matchAll(
    /((?:[A-Z]{1,6}\d{0,2}(?:-\d{2,6}){2,}[A-Z0-9-]*)(?:、[A-Z]{1,6}\d{0,2}(?:-\d{2,6}){2,}[A-Z0-9-]*)*)地块/gu,
  )) {
    const codes = (match[1] ?? "")
      .split("、")
      .map((value) => normalizeWhitespace(value))
      .filter(Boolean);
    for (const code of codes) {
      const rawAddress = `${code}地块`;
      if (!rawAddress || match.index === undefined) {
        continue;
      }

      const candidate = {
        address: rawAddress,
        kind: "site" as const,
        localityHint: sentenceLocalityHint(rawAddress, match.index),
        source,
      } satisfies AddressCandidate;
      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  for (const match of normalizedText.matchAll(
    new RegExp(String.raw`(?:东至|南至|西至|北至)\s*(${chineseRoadPattern})`, "gu"),
  )) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    pushCandidate(rawAddress, "street", match.index);
  }

  for (const match of normalizedText.matchAll(new RegExp(chineseDirectionalRoadPattern, "gu"))) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    pushCandidate(rawAddress, "street", match.index);
  }

  for (const match of normalizedText.matchAll(
    new RegExp(
      String.raw`(?:建设地点[：:]|建设地点|位于|坐落于)[^。；;\n]{0,80}?(${chineseRoadPattern})`,
      "gu",
    ),
  )) {
    const rawAddress = normalizeWhitespace(match[1] ?? "");
    if (!rawAddress || match.index === undefined) {
      continue;
    }

    pushCandidate(rawAddress, "street", match.index);
  }

  return dedupeAddressCandidates(dedupeRawAddressCandidates(candidates));
};
