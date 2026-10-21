// Detect contact blocks, page chrome and plan boilerplate around an address match.
import {
  pageChromeContextMarkers,
  pageContactContextMarkers,
  pagePlanNoiseMarkers,
  projectContextMarkers,
} from "../data";
import { splitComparisonTokens } from "../text/normalize";

export const emailLikePattern = /\b[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[a-z]{2,}\b/iu;

export const phoneLikePattern = /\+?\d(?:[\d()./\-\s]{5,}\d)/u;

export const normalizeMarkerContext = (value: string) => splitComparisonTokens(value).join(" ");

export const countDistinctMarkerMatches = (value: string, markers: string[]) => {
  const normalizedValue = normalizeMarkerContext(value);
  if (!normalizedValue) {
    return 0;
  }

  let count = 0;
  for (const marker of markers) {
    const normalizedMarker = normalizeMarkerContext(marker);
    if (normalizedMarker && normalizedValue.includes(normalizedMarker)) {
      count += 1;
    }
  }

  return count;
};

export const findFirstMarkerIndex = (value: string, markers: string[]) => {
  const normalizedValue = normalizeMarkerContext(value);
  if (!normalizedValue) {
    return -1;
  }

  let firstIndex = -1;
  for (const marker of markers) {
    const normalizedMarker = normalizeMarkerContext(marker);
    if (!normalizedMarker) {
      continue;
    }

    const markerIndex = normalizedValue.indexOf(normalizedMarker);
    if (markerIndex >= 0 && (firstIndex === -1 || markerIndex < firstIndex)) {
      firstIndex = markerIndex;
    }
  }

  return firstIndex;
};

export const findLastMarkerIndex = (value: string, markers: string[]) => {
  const normalizedValue = normalizeMarkerContext(value);
  if (!normalizedValue) {
    return -1;
  }

  let lastIndex = -1;
  for (const marker of markers) {
    const normalizedMarker = normalizeMarkerContext(marker);
    if (!normalizedMarker) {
      continue;
    }

    const markerIndex = normalizedValue.lastIndexOf(normalizedMarker);
    if (markerIndex > lastIndex) {
      lastIndex = markerIndex;
    }
  }

  return lastIndex;
};

export const findFirstPatternIndex = (value: string, pattern: RegExp) => {
  const match = value.match(pattern);
  return match?.index ?? -1;
};

export const isLikelyPageAddressNoise = (
  rawAddress: string,
  contextBefore: string,
  contextAfter: string,
) => {
  const candidateContext = `${contextBefore} ${rawAddress} ${contextAfter}`;
  const immediateContextBefore = contextBefore.slice(-120);
  const immediateContextAfter = contextAfter.slice(0, 140);
  const immediateContext = `${immediateContextBefore} ${rawAddress} ${immediateContextAfter}`;
  const candidateContactHits = countDistinctMarkerMatches(rawAddress, pageContactContextMarkers);
  const candidateChromeHits = countDistinctMarkerMatches(rawAddress, pageChromeContextMarkers);
  if (candidateContactHits > 0 || candidateChromeHits > 0) {
    return true;
  }

  const contactHits = countDistinctMarkerMatches(candidateContext, pageContactContextMarkers);
  const chromeHits = countDistinctMarkerMatches(candidateContext, pageChromeContextMarkers);
  const projectHits = countDistinctMarkerMatches(candidateContext, projectContextMarkers);
  const planNoiseHits = countDistinctMarkerMatches(candidateContext, pagePlanNoiseMarkers);
  const immediateContactHits = countDistinctMarkerMatches(immediateContext, pageContactContextMarkers);
  const immediateChromeHits = countDistinctMarkerMatches(immediateContext, pageChromeContextMarkers);
  const immediateProjectHits = countDistinctMarkerMatches(immediateContext, projectContextMarkers);
  const immediatePlanNoiseHits = countDistinctMarkerMatches(immediateContext, pagePlanNoiseMarkers);
  const previousContactMarkerIndex = Math.max(
    findLastMarkerIndex(contextBefore, pageContactContextMarkers),
    findLastMarkerIndex(contextBefore, pageChromeContextMarkers),
  );
  const previousProjectMarkerIndex = findLastMarkerIndex(contextBefore, projectContextMarkers);
  const nextContactMarkerIndex = findFirstMarkerIndex(contextAfter, pageContactContextMarkers);
  const nextProjectMarkerIndex = findFirstMarkerIndex(contextAfter, projectContextMarkers);
  const nextEmailIndex = findFirstPatternIndex(contextAfter, emailLikePattern);
  const nextPhoneIndex = findFirstPatternIndex(contextAfter, phoneLikePattern);
  const nextContactSignalIndex = [nextContactMarkerIndex, nextEmailIndex, nextPhoneIndex]
    .filter((value) => value >= 0)
    .sort((left, right) => left - right)[0] ?? -1;
  const precededByContactLead =
    previousContactMarkerIndex >= 0 &&
    (previousProjectMarkerIndex === -1 || previousContactMarkerIndex > previousProjectMarkerIndex);
  const precededByProjectLead =
    previousProjectMarkerIndex >= 0 &&
    (previousContactMarkerIndex === -1 || previousProjectMarkerIndex > previousContactMarkerIndex);
  const followedByContactBeforeProject =
    nextContactSignalIndex >= 0 &&
    (nextProjectMarkerIndex === -1 || nextContactSignalIndex < nextProjectMarkerIndex);
  const contextHasEmail = emailLikePattern.test(candidateContext);
  const contextHasPhone = phoneLikePattern.test(contextAfter);
  const immediateHasEmail =
    emailLikePattern.test(immediateContextBefore) || emailLikePattern.test(immediateContextAfter);
  const immediateHasPhone = phoneLikePattern.test(immediateContextAfter);

  if (precededByContactLead && followedByContactBeforeProject) {
    return true;
  }

  if (precededByContactLead && (immediateHasEmail || immediateHasPhone)) {
    return true;
  }

  if (followedByContactBeforeProject && (immediateContactHits >= 1 || immediateChromeHits >= 1)) {
    if (precededByProjectLead && immediateProjectHits >= 1) {
      return false;
    }

    if (immediateProjectHits === 0) {
      return true;
    }
  }

  if (immediateHasEmail && immediateContactHits >= 2 && immediateProjectHits <= 2) {
    return true;
  }

  if (immediateHasPhone && immediateContactHits >= 2 && immediateProjectHits === 0) {
    return true;
  }

  if (immediateChromeHits >= 1 && immediateProjectHits === 0) {
    return true;
  }

  if (contextHasEmail && contactHits >= 2 && projectHits <= 1) {
    if (immediateProjectHits >= 1) {
      return false;
    }
    return true;
  }

  if (contextHasPhone && contactHits >= 2 && projectHits === 0) {
    return true;
  }

  if (contactHits >= 3 && projectHits === 0) {
    return true;
  }

  if (chromeHits >= 1 && projectHits === 0) {
    return true;
  }

  if (planNoiseHits >= 2 && contactHits >= 1 && projectHits === 0) {
    return true;
  }

  if (immediatePlanNoiseHits >= 2 && immediateContactHits >= 1 && immediateProjectHits === 0) {
    return true;
  }

  return false;
};
