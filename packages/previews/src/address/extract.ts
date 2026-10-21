// Extract address candidates from title, page and PDF text.
import { extractChineseContextLocalityHint } from "./chinese";
import { extractChineseAddressCandidatesFromText } from "./chinese-extract";
import {
  cleanAddressCandidate,
  cleanLocalityCandidate,
  cleanSiteCandidate,
  escapeRegExp,
  extractInlineLocalityHintFromAddress,
  extractLocalityHintFromTail,
  extractTrailingDashLocality,
} from "./clean";
import {
  dedupeAddressCandidates,
  dedupeRawAddressCandidates,
  getAddressCandidateComparisonKey,
} from "./compare";
import { isLikelyPageAddressNoise } from "./noise";
import {
  addressCandidatePatterns,
  dashDelimitedLocalityTokenPattern,
  frenchDashDelimitedSiteLeadPattern,
  frenchQuotedSiteLeadPattern,
  titleAddressCandidatePatterns,
} from "./patterns";
import { decodeHtmlEntities } from "../text/html";
import { normalizeComparisonText, normalizeWhitespace } from "../text/normalize";
import type { AddressCandidate, AddressCandidateKind } from "../types";

export const buildAddressCandidate = (
  normalizedText: string,
  match: RegExpMatchArray,
  kind: AddressCandidateKind,
  source: AddressCandidate["source"],
) => {
  const rawAddress = normalizeWhitespace(match[0]);
  const address =
    kind === "locality"
      ? cleanLocalityCandidate(rawAddress)
      : kind === "site"
        ? cleanSiteCandidate(rawAddress)
        : cleanAddressCandidate(rawAddress);
  if (!address || match.index === undefined) {
    return null;
  }

  if (source === "page") {
    const contextBefore = normalizedText.slice(Math.max(0, match.index - 160), match.index);
    const contextAfter = normalizedText.slice(
      match.index + match[0].length,
      Math.min(normalizedText.length, match.index + match[0].length + 220),
    );
    if (isLikelyPageAddressNoise(rawAddress, contextBefore, contextAfter)) {
      return null;
    }
  }

  const tail = normalizedText.slice(match.index + match[0].length);
  const tailLocalityHint = extractLocalityHintFromTail(tail);
  const chineseContextLocalityHint = extractChineseContextLocalityHint(
    normalizedText,
    match.index,
    rawAddress,
  );
  return {
    address,
    kind,
    localityHint:
      tailLocalityHint ??
      extractInlineLocalityHintFromAddress(rawAddress) ??
      chineseContextLocalityHint,
    source,
  } satisfies AddressCandidate;
};

export const enrichTitleCandidatesWithDashLocalities = (candidates: AddressCandidate[], normalizedText: string) => {
  if (!/\s[-–—]\s/u.test(normalizedText)) {
    return candidates;
  }

  return candidates.map((candidate) => {
    if (candidate.localityHint || candidate.source !== "title") {
      return candidate;
    }

    const cityStreetMatch = normalizedText.match(
      new RegExp(
        String.raw`\b(${dashDelimitedLocalityTokenPattern}(?:\s+${dashDelimitedLocalityTokenPattern}){0,4})\s*[-–—]\s+${escapeRegExp(candidate.address)}\b`,
        "iu",
      ),
    );
    if (!cityStreetMatch?.[1]) {
      return candidate;
    }

    const localityHint = extractTrailingDashLocality(cityStreetMatch[1]);
    return localityHint
      ? {
          ...candidate,
          localityHint,
        }
      : candidate;
  });
};

export const extractAddressCandidatesFromText = (
  value: string,
  source: AddressCandidate["source"],
): AddressCandidate[] => {
  const normalized = normalizeWhitespace(value.replace(/[–—]/g, "-"));
  if (!normalized) {
    return [];
  }

  const seen = new Set<string>();
  const candidates: AddressCandidate[] = [];

  for (const { kind, pattern } of addressCandidatePatterns) {
    for (const match of normalized.matchAll(pattern)) {
      const candidate = buildAddressCandidate(normalized, match, kind, source);
      if (!candidate) {
        continue;
      }

      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }
  }

  for (const candidate of extractChineseAddressCandidatesFromText(normalized, source)) {
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    candidates.push(candidate);
  }

  if (source === "title") {
    for (const match of normalized.matchAll(frenchDashDelimitedSiteLeadPattern)) {
      if (match.index === undefined) {
        continue;
      }

      const localityHint = extractTrailingDashLocality(match[1] ?? "");
      const address = cleanSiteCandidate(match[2] ?? "");
      if (!address) {
        continue;
      }

      const candidate = {
        address,
        kind: /^(?:chemin|rue|route|avenue|avenues|boulevard|all[eé]e|impasse|quai|parvis|esplanade)\b/iu.test(
          address,
        )
          ? ("street" as const)
          : ("site" as const),
        localityHint,
        source,
      } satisfies AddressCandidate;
      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }

    for (const match of normalized.matchAll(frenchQuotedSiteLeadPattern)) {
      if (match.index === undefined) {
        continue;
      }

      const localityHint = extractTrailingDashLocality(match[1] ?? "");
      const address = cleanSiteCandidate(match[2] ?? "");
      if (!address) {
        continue;
      }

      const candidate = {
        address,
        kind: "site" as const,
        localityHint,
        source,
      } satisfies AddressCandidate;
      const key = getAddressCandidateComparisonKey(candidate);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push(candidate);
    }

    for (const { kind, pattern } of titleAddressCandidatePatterns) {
      for (const match of normalized.matchAll(pattern)) {
        const candidate = buildAddressCandidate(normalized, match, kind, source);
        if (!candidate) {
          continue;
        }

        if (
          candidate.kind === "street" &&
          candidates.some(
            (existingCandidate) =>
              existingCandidate.kind === "street_address" &&
              normalizeComparisonText(existingCandidate.address) ===
                normalizeComparisonText(candidate.address),
          )
        ) {
          continue;
        }

        const key = getAddressCandidateComparisonKey(candidate);
        if (seen.has(key)) {
          continue;
        }

        seen.add(key);
        candidates.push(candidate);
      }
    }
  }

  return dedupeAddressCandidates(dedupeRawAddressCandidates(enrichTitleCandidatesWithDashLocalities(candidates, normalized)));
};

const pdfMaxExtractedTextLength = 24000;

export const normalizePdfTextForAddressExtraction = (value: string) => {
  const normalized = normalizeWhitespace(
    decodeHtmlEntities(
      value
        .replace(/\u0000/g, " ")
        .replace(/\u000c/g, " ")
        .replace(/(?<=\p{L})-\s*(?:\r?\n)+\s*(?=\p{Ll})/gu, "")
        .replace(/\r\n?/g, "\n")
        .replace(/([^\n])\n(?=\d{4,6}\s+[\p{L}])/gu, "$1; ")
        .replace(/\s*\n\s*/g, " "),
    ),
  );

  return normalized.length > pdfMaxExtractedTextLength
    ? normalized.slice(0, pdfMaxExtractedTextLength)
    : normalized;
};

export const extractAddressCandidatesFromPdfText = (value: string) => {
  const normalizedText = normalizePdfTextForAddressExtraction(value);
  if (!normalizedText) {
    return [] as AddressCandidate[];
  }

  return extractAddressCandidatesFromText(normalizedText, "page");
};
