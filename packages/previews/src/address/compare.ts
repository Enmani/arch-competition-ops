// Street/locality token comparison and address candidate de-duplication.
import { streetComparisonNoiseTokens } from "../data";
import { pickMoreSpecificLocalityHint } from "./clean";
import { streetNumberBodyPattern, streetNumberPattern } from "./patterns";
import { normalizeComparisonText, splitComparisonTokens } from "../text/normalize";
import type { AddressCandidate } from "../types";

export const hasStreetNumber = (value: string) =>
  streetNumberPattern.test(value);

export const houseNumberCapturePattern =
  new RegExp(
    String.raw`\b(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?(${streetNumberBodyPattern})\b`,
    "iu",
  );

export const extractComparableHouseNumber = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const match = value.match(houseNumberCapturePattern);
  if (!match?.[1]) {
    return null;
  }

  return normalizeComparisonText(match[1]).replace(/[^\p{L}\p{N}]+/gu, "");
};

export const normalizeStreetComparisonTokens = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return [];
  }

  const withoutHouseNumber = value.replace(houseNumberCapturePattern, " ");
  return splitComparisonTokens(withoutHouseNumber).filter(
    (token) =>
      !streetComparisonNoiseTokens.has(token) &&
      !new RegExp(String.raw`^${streetNumberBodyPattern}$`, "u").test(token),
  );
};

export const haveStreetCoreTokenMatch = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  const leftTokens = normalizeStreetComparisonTokens(leftValue);
  const rightTokens = normalizeStreetComparisonTokens(rightValue);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  if (leftTokens.join(" ") === rightTokens.join(" ")) {
    return true;
  }

  return (
    leftTokens.every((token) => rightTokens.includes(token)) ||
    rightTokens.every((token) => leftTokens.includes(token))
  );
};

export const haveLocalityTokenMatch = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  if (typeof leftValue !== "string" || typeof rightValue !== "string") {
    return false;
  }

  const leftTokens = splitComparisonTokens(leftValue);
  const rightTokens = splitComparisonTokens(rightValue);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  return leftTokens.every((token) => rightTokens.includes(token));
};

export const getAddressCandidateComparisonKey = (candidate: AddressCandidate) =>
  normalizeComparisonText(`${candidate.kind}|${candidate.address}|${candidate.localityHint ?? ""}`);

export const dedupeAddressCandidates = (candidates: AddressCandidate[]) => {
  const deduped: AddressCandidate[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const baseKey = normalizeComparisonText(`${candidate.kind}|${candidate.address}`);
    const existingIndex = deduped.findIndex(
      (entry) => normalizeComparisonText(`${entry.kind}|${entry.address}`) === baseKey,
    );
    if (existingIndex >= 0) {
      const existing = deduped[existingIndex];
      const mergedLocalityHint = pickMoreSpecificLocalityHint(
        existing.localityHint,
        candidate.localityHint,
      );
      if (mergedLocalityHint !== existing.localityHint) {
        deduped[existingIndex] = {
          ...existing,
          localityHint: mergedLocalityHint,
        };
      }
      continue;
    }

    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
};

export const dedupeRawAddressCandidates = (candidates: AddressCandidate[]) => {
  const seen = new Set<string>();
  const deduped: AddressCandidate[] = [];

  for (const candidate of candidates) {
    const key = getAddressCandidateComparisonKey(candidate);
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(candidate);
  }

  return deduped;
};
