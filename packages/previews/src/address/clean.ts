// Clean raw address, locality and site strings captured by the patterns.
import {
  addressBodyPattern,
  addressPrefixPattern,
  chineseAddressNoiseLeadPattern,
  chineseAdministrativeUnitPattern,
  chineseCompoundPlacePattern,
  chineseDirectionalSuffixPattern,
  chineseLocalityNoiseLeadPattern,
  chineseRoadPattern,
  localityPrefixPattern,
  localityTailNoisePattern,
  multiLocalityConnectorPattern,
  placeNamePattern,
  preservedChineseAdministrativeSitePattern,
  rejectedAddressCandidatePattern,
  rejectedAddressMarkers,
  rejectedBroadChineseLocalityPattern,
  rejectedLocalityMarkers,
  rejectedProceduralAddressPattern,
  streetNumberBodyPattern,
  trailingAddressFieldStopPattern,
  trailingStreetAddressPattern,
  trailingStreetTypePattern,
} from "./patterns";
import { normalizeComparisonText, normalizeWhitespace } from "../text/normalize";

export const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export const extractTrailingDashLocality = (value: string) => {
  const segments = value
    .split(/\s*[-–—]\s*/u)
    .map((segment) => cleanLocalityHint(segment))
    .filter((segment): segment is string => Boolean(segment));
  return segments.at(-1) ?? null;
};

export const cleanAddressCandidate = (value: string) => {
  const cleaned = normalizeWhitespace(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/^(?:位于|坐落于|建设地点[：:]?|东至|南至|西至|北至)\s*/u, "")
      .replace(chineseAddressNoiseLeadPattern, "")
      .replace(/^(?:action)\s+/iu, "")
      .replace(/^.*?\b(?:projekt|project|projet|progetto)\s+/iu, "")
      .replace(/^.*?\b(?:przy|na\s+naslovu|sito\s+en|ubicado\s+en|situado\s+en)\s+/iu, "")
      .replace(/^(?:aan|på|pa)\s+/iu, "")
      .replace(/^.*?\b(?:fachplanung|werkraum|schule)\s+(?=[\p{L}\p{N}.'’/-]+\s+straße\b)/iu, "")
      .replace(new RegExp(String.raw`^(?:${chineseAdministrativeUnitPattern}){1,3}`, "u"), "")
      .replace(trailingAddressFieldStopPattern, "")
      .replace(
        new RegExp(
          String.raw`^((?:piazza|piazzale|plaza|platz|square|place)\s+${addressBodyPattern})\s+(?:in|a|à|en|em|nel|nella|na|no)\s+${placeNamePattern}\s*$`,
          "iu",
        ),
        "$1",
      )
      .replace(/\s*[-–—]\s*(?:lotto|lot\b|projekt(?:steuerung)?|project|projet|construction|mission|objektplanung|fachplanung|planung|raum(?:-| und )|ma[iî]trise|proc[eé]dure|procedura)\b[\s\S]*$/iu, "")
      .replace(/\s+nel\s+comune\s+di\b[\s\S]*$/iu, "")
      .replace(/\s*\([A-Z0-9-]{2,}\)\s*$/u, "")
      .replace(/\s+-\s+lot\s+\d+\b[\s\S]*$/iu, "")
      .replace(/,\s*\d+\s+logements?\b[\s\S]*$/iu, "")
      .replace(/\.\s+Nell'ambito dell['’ ]Avviso Pubblico\b[\s\S]*$/iu, "")
      .replace(/\s+finalizzat[oa]?\s+al(?:la)?\b[\s\S]*$/iu, "")
      .replace(/\s+urbanistic[oa]\b[\s\S]*$/iu, "")
      .replace(/\s+certificato\s+di\s+regolare\s+esecuzione\b[\s\S]*$/iu, "")
      .replace(/\s+N\.?C\.?E\.?U\.?\b[\s\S]*$/iu, "")
      .replace(/\b(?:项目|工程|招标公告|招标|建设项目|方案设计|初步设计|施工图设计|设计服务)\b[\s\S]*$/u, "")
      .replace(chineseDirectionalSuffixPattern, "")
      .replace(/\s+(?:w|v|u)\s+[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4}\s*$/iu, "")
      .replace(/\s+\b(?:al\s+patrimonio\s+del\s+comune\s+di|al\s+massimo\s+\d+\s+caratteri|indietro|avanti|grazie)\b[\s\S]*$/iu, "")
      .replace(/\s+pour\s+l['’][\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,6}\s*$/iu, "")
      .replace(/^[,;:\-.\s]+|[,;:\-.\s]+$/g, ""),
  );

  if (!cleaned) {
    return null;
  }

  if (
    cleaned.length > 96 ||
    rejectedAddressMarkers.test(cleaned) ||
    rejectedAddressCandidatePattern.test(cleaned)
  ) {
    return null;
  }

  if (
    !new RegExp(
      String.raw`(?:\b${streetNumberBodyPattern}\b|${trailingStreetTypePattern}\b|${chineseCompoundPlacePattern}|${chineseRoadPattern})`,
      "iu",
    ).test(cleaned) &&
    rejectedProceduralAddressPattern.test(cleaned)
  ) {
    return null;
  }

  if (
    new RegExp(String.raw`^(?:${addressPrefixPattern}|${trailingStreetTypePattern})$`, "iu").test(
      cleaned,
    )
  ) {
    return null;
  }

  return cleaned;
};

export const cleanLocalityCandidate = (value: string) => {
  const stripped = value
    .replace(/\s+(?:lungo|along)\b[\s\S]*$/iu, "")
    .replace(/\s+al\s+km\b[\s\S]*$/iu, "")
    .replace(/\s+km\b[\s\S]*$/iu, "")
    .replace(/\s+sito\b[\s\S]*$/iu, "");

  return cleanAddressCandidate(stripped);
};

export const cleanSiteCandidate = (value: string) =>
  (() => {
    const normalizedValue = value.replace(/^\d{4}年/u, "").replace(/(?:[«»"“”])/gu, "");
    if (preservedChineseAdministrativeSitePattern.test(normalizedValue)) {
      const preservedCleaned = normalizeWhitespace(
        normalizedValue
          .replace(/\b(?:项目|工程|招标公告|招标|建设项目|方案设计|初步设计|施工图设计|设计服务)\b[\s\S]*$/u, "")
          .replace(/^[,;:\-.\s]+|[,;:\-.\s]+$/g, ""),
      );
      if (
        !preservedCleaned ||
        preservedCleaned.length > 96 ||
        rejectedAddressMarkers.test(preservedCleaned) ||
        rejectedAddressCandidatePattern.test(preservedCleaned)
      ) {
        return null;
      }

      return preservedCleaned;
    }

    return cleanAddressCandidate(
      normalizedValue
        .replace(new RegExp(String.raw`^(?:${chineseAdministrativeUnitPattern}){1,3}`, "u"), "")
        .replace(/^[\p{Script=Han}]{2,12}(?:医院|学校)/u, "")
        .replace(/((?:片区|片小区|小区|街区))\d{4}年老旧(?:小区|街区)$/u, "$1")
        .replace(/((?:片区|片小区|小区|街区))(?:改造工程|改造项目|修复改造|建设项目)[\s\S]*$/u, "$1")
        .replace(/\s+(?:à|en|em|w|v|u|im|am|bei|auf|nel|nella|in|na|no|te|i)\s+[\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,5}\s*(?:\([A-Z]{2}\))?$/iu, "")
        .replace(/\s+(?:comprensivo|incluye|including)\b[\s\S]*$/iu, "")
        .replace(/\s+(?:mission|ma[iî]trise|travaux|construction|consultation|lot|n[°ºo]\s*op[\p{L}\p{N}-]*)\b[\s\S]*$/iu, "")
        .replace(/\s*\([^)]+\)\s*$/u, ""),
    );
  })();

export const cleanLocalityHint = (value: string) => {
  const cleaned = normalizeWhitespace(
    value
      .replace(/^\d{4}年/u, "")
      .replace(/^年/u, "")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(chineseLocalityNoiseLeadPattern, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+comune\s+di\s+/iu, "")
      .replace(/^comune\s+di\s+/iu, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+/iu, "")
      .replace(trailingAddressFieldStopPattern, "")
      .replace(/\d+号棚户区[\s\S]*$/u, "")
      .replace(/棚户区改造项目[\s\S]*$/u, "")
      .replace(/棚户区[\s\S]*$/u, "")
      .replace(/号$/u, "")
      .replace(/,\s*(?:district|distrito)\b[\s\S]*$/iu, "")
      .replace(/,\s*[^,]*\b(?:district|distrito)\b[\s\S]*$/iu, "")
      .replace(/\s+de\s+esta\s+localidad\b[\s\S]*$/iu, "")
      .replace(/\s+di\s+questa\s+localit[aà]\b[\s\S]*$/iu, "")
      .replace(/\s+desta\s+localidade\b[\s\S]*$/iu, "")
      .replace(/号及其周边(?:区域|区)$/u, "")
      .replace(/\s*\([A-Z]{2}\)\s*$/u, "")
      .replace(/\s*\((?:\d{2,5})\)\s*$/u, "")
      .replace(/\s+\d{2,5}\s*$/u, "")
      .replace(/^[,;:\-.\s]+|[,;:\-.\s]+$/g, ""),
  );

  if (!cleaned) {
    return null;
  }

  if (cleaned.length > 72 || rejectedLocalityMarkers.test(cleaned) || rejectedAddressMarkers.test(cleaned)) {
    return null;
  }

  if (localityTailNoisePattern.test(cleaned)) {
    return null;
  }

  if (rejectedBroadChineseLocalityPattern.test(cleaned) || multiLocalityConnectorPattern.test(cleaned)) {
    return null;
  }

  return cleaned;
};

export const normalizeStructuredField = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const cleaned = normalizeWhitespace(value);
  return cleaned.length > 0 ? cleaned : null;
};

export const leadingStreetAddressSegmentPattern = new RegExp(
  String.raw`^${addressPrefixPattern}\s+${addressBodyPattern}(?:(?:\s*,\s*|\s+)(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?\d[\p{L}\p{N}/-]{0,7}|(?:\s*,\s*|\s+)snc)?$`,
  "iu",
);

export const trailingStreetAddressSegmentPattern = new RegExp(
  String.raw`^${trailingStreetAddressPattern}(?:\s*,\s*|\s+)(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)?\d[\p{L}\p{N}/-]{0,7}$`,
  "iu",
);

export const extractStreetAddressFromPlacename = (value: string | null | undefined) => {
  const normalizedValue = normalizeStructuredField(value);
  if (!normalizedValue) {
    return null;
  }

  const segments = normalizedValue.split(",").map(normalizeWhitespace).filter(Boolean);
  for (const segment of segments) {
    const normalizedSegment = segment.replace(/^\d{4,6}\s+/u, "");
    if (!normalizedSegment) {
      continue;
    }

    if (/^(?:campus)\b/iu.test(normalizedSegment)) {
      return normalizedSegment;
    }

    if (
      leadingStreetAddressSegmentPattern.test(normalizedSegment) ||
      trailingStreetAddressSegmentPattern.test(normalizedSegment)
    ) {
      return normalizedSegment;
    }
  }

  return null;
};

export const extractLocalityHintFromPlacename = (value: string | null | undefined) => {
  const normalizedValue = normalizeStructuredField(value);
  if (!normalizedValue) {
    return null;
  }

  const segments = normalizedValue.split(",").map(normalizeWhitespace).filter(Boolean);
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const cleanedSegment = cleanLocalityHint(segments[index].replace(/^\d{4,6}\s+/u, ""));
    if (cleanedSegment) {
      return cleanedSegment;
    }
  }

  return null;
};

export const extractLocalityHintFromTail = (value: string) => {
  const localityTailPatterns = [
    new RegExp(String.raw`^\s*[,;]\s*(${localityPrefixPattern}\s+${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*[,;]\s*\d{4,6}\s+(${placeNamePattern})`, "iu"),
    new RegExp(
      String.raw`^[\s,;:-]*(?:situad[oa]s?|ubicad[oa]s?|sito(?:s)?|site[ds]?)\s+en\s+(?:la\s+|el\s+)?(${localityPrefixPattern}\s+${placeNamePattern})`,
      "iu",
    ),
    new RegExp(
      String.raw`^\s*,\s*(${placeNamePattern})\s*,\s*(?:z|with|con|w|v|u|em|en|nel|in|na|no)\b`,
      "iu",
    ),
    new RegExp(String.raw`^\s*,\s*en\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+en\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*(?:w|v|u)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+(?:w|v|u)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*em\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+em\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*à\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+à\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*,\s*(?:au|aux|sur|sous|l[eè]s)\s+(${placeNamePattern})(?:\s*\((?:\d{2,5}|[A-Z]{2})\))?`, "iu"),
    new RegExp(String.raw`^\s+(?:au|aux|sur|sous|l[eè]s)\s+(${placeNamePattern})(?:\s*\((?:\d{2,5}|[A-Z]{2})\))?`, "iu"),
    new RegExp(String.raw`^\s+(?:nel|in|a|na|no|te|i)\s+(${placeNamePattern})\s*\([A-Z]{2}\)`, "iu"),
    new RegExp(String.raw`^\s+(?:nel|in|a|na|no|te|i)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s+(?:im|am|bei|auf)\s+(${placeNamePattern})`, "iu"),
    new RegExp(String.raw`^\s*-\s*(${placeNamePattern})\s*\([A-Z]{2}\)`, "u"),
    new RegExp(String.raw`^\s*-\s*(${placeNamePattern})\s*\((?:\d{2,5}|[A-Z]{2})\)`, "u"),
    new RegExp(String.raw`^\s*,\s*(${placeNamePattern})\s*\([A-Z]{2}\)`, "u"),
  ];

  for (const pattern of localityTailPatterns) {
    const match = value.match(pattern);
    if (!match) {
      continue;
    }

    const localityHint = cleanLocalityHint(match[1]);
    if (localityHint) {
      return localityHint;
    }
  }

  return null;
};

export const extractInlineLocalityHintFromAddress = (value: string) => {
  const patterns = [
    new RegExp(
      String.raw`^(?:piazza|piazzale|plaza|platz|square|place)\s+${addressBodyPattern}\s+(?:in|a|à|en|em|nel|nella|na|no)\s+(${placeNamePattern})\s*$`,
      "iu",
    ),
    new RegExp(String.raw`\s+(?:w|v|u)\s+(${placeNamePattern})\s*$`, "iu"),
    new RegExp(String.raw`((?:${chineseAdministrativeUnitPattern}){1,3})\s*[\p{Script=Han}\p{L}\p{N}-]{1,40}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地|路|街|道|巷|胡同|正街|大道)\s*$`, "u"),
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (!match) {
      continue;
    }

    const localityHint = cleanLocalityHint(match[1]);
    if (localityHint) {
      return localityHint;
    }
  }

  return null;
};

export const pickMoreSpecificLocalityHint = (
  leftValue: string | null | undefined,
  rightValue: string | null | undefined,
) => {
  if (typeof leftValue !== "string" || leftValue.length === 0) {
    return typeof rightValue === "string" && rightValue.length > 0 ? rightValue : null;
  }

  if (typeof rightValue !== "string" || rightValue.length === 0) {
    return leftValue;
  }

  const leftKey = normalizeComparisonText(leftValue);
  const rightKey = normalizeComparisonText(rightValue);
  if (leftKey === rightKey) {
    return leftValue.length >= rightValue.length ? leftValue : rightValue;
  }

  if (rightKey.includes(leftKey)) {
    return rightValue;
  }

  if (leftKey.includes(rightKey)) {
    return leftValue;
  }

  return leftValue.length >= rightValue.length ? leftValue : rightValue;
};
