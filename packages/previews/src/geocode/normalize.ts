// Normalise address and locality strings into geocoder-friendly variants.
import {
  expandChineseRoadNumberVariant,
  extractChineseFacilityCore,
  extractChineseInstitutionBaseName,
  extractChineseRoadCandidates,
} from "../address/chinese";
import {
  addressBodyPattern,
  addressPrefixPattern,
  chineseInstitutionSiteTailPattern,
  compoundAddressPattern,
  compoundTrailingStreetWordPattern,
  localityWrapperStripPattern,
  referencedAddressPattern,
  streetNumberBodyPattern,
  streetPrefixForGeocoderStripPattern,
  trailingStreetTypePattern,
} from "../address/patterns";
import { normalizeComparisonText, normalizeWhitespace } from "../text/normalize";

export const normalizeAddressForGeocoder = (value: string) =>
  normalizeWhitespace(
    value
      .replace(/[–—]/g, "-")
      .replace(/^c\/\s*/iu, "Calle ")
      .replace(/^c\.(?=\s)/iu, "Calle")
      .replace(/^r\.(?=\s)/iu, "Rua")
      .replace(/^tv\.?(?=\s)/iu, "Travessa")
      .replace(/^estr\.?(?=\s)/iu, "Estrada")
      .replace(/^ul\.?(?=\s)/iu, "Ulica")
      .replace(/^al\.?(?=\s)/iu, "Aleja")
      .replace(/^bd\.?(?=\s)/iu, "Bulevard")
      .replace(/^avda\.?(?=\s)/iu, "Avenida")
      .replace(/^av\.(?=\s)/iu, "Avenida")
      .replace(/^plaza\s+/iu, "Plaza ")
      .replace(/^pza\.?\s*/iu, "Plaza ")
      .replace(/\b(?:n(?:[°ºo.]|\.)?\s*|no\.?\s*|nr\.?\s*|n\.\s*)(\d[\p{L}\p{N}/-]{0,7})\b/giu, "$1")
      .replace(/\bsnc\b/giu, "")
      .replace(/\s*,\s*/g, ", "),
  );

export const stripLeadingStreetPrefixForGeocoder = (value: string) =>
  normalizeWhitespace(value.replace(streetPrefixForGeocoderStripPattern, ""));

export const expandLocalityVariantsForGeocoder = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return [];
  }

  const seen = new Set<string>();
  const variants: string[] = [];

  const pushVariant = (candidateValue: string | null | undefined) => {
    if (typeof candidateValue !== "string") {
      return;
    }

    const normalizedValue = normalizeWhitespace(candidateValue);
    if (!normalizedValue) {
      return;
    }

    const comparisonKey = normalizeComparisonText(normalizedValue);
    if (seen.has(comparisonKey)) {
      return;
    }

    seen.add(comparisonKey);
    variants.push(normalizedValue);
  };

  pushVariant(value.replace(localityWrapperStripPattern, ""));
  pushVariant(value);

  return variants;
};

export const normalizeLocalityHintForGeocoder = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  return normalizeWhitespace(
    value
      .replace(localityWrapperStripPattern, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+comune\s+di\s+/iu, "")
      .replace(/^comune\s+di\s+/iu, "")
      .replace(/^(?:nel|nella|nello|nei|negli|in|a)\s+/iu, ""),
  );
};

export const expandAddressVariantsForGeocoder = (value: string) => {
  const seen = new Set<string>();
  const variants: string[] = [];

  const pushVariant = (candidateValue: string | null | undefined) => {
    if (typeof candidateValue !== "string") {
      return;
    }

    const normalizedValue = normalizeAddressForGeocoder(candidateValue);
    if (!normalizedValue) {
      return;
    }

    const comparisonKey = normalizeComparisonText(normalizedValue);
    if (seen.has(comparisonKey)) {
      return;
    }

    seen.add(comparisonKey);
    variants.push(normalizedValue);
  };

  const normalizedValue = normalizeAddressForGeocoder(value);
  pushVariant(normalizedValue);

  const compoundMatch = normalizedValue.match(compoundAddressPattern);
  if (compoundMatch) {
    pushVariant(compoundMatch[1]);
    pushVariant(compoundMatch[2]);
  }

  const referencedAddressMatch = normalizedValue.match(referencedAddressPattern);
  if (referencedAddressMatch) {
    pushVariant(referencedAddressMatch[1]);
  }

  const siteCampusMatch = normalizedValue.match(/^(Campus)\s+(.+)$/iu);
  if (siteCampusMatch) {
    pushVariant(`${siteCampusMatch[1]} ${siteCampusMatch[2].replace(/\b(?:di|de|del)\s+/iu, "")}`);

    const campusBody = siteCampusMatch[2];
    const universityCityCampusMatch = campusBody.match(
      /^Universitario\s+de\s+([\p{L}\p{N}.'’/-]+)(?:\s+de\s+la\s+Universidad\s+de\s+([\p{L}\p{N}.'’/-]+))?$/iu,
    );
    if (universityCityCampusMatch) {
      const city = universityCityCampusMatch[1];
      const university = universityCityCampusMatch[2];
      pushVariant(`Campus ${city}`);
      if (university) {
        pushVariant(`Campus ${city} ${university}`);
        pushVariant(`Campus ${city} UVa`);
      }
    }

    const iutCampusMatch = campusBody.match(/^IUT\s+([\p{L}\p{N}.'’/-]+)(?:\s+Universit[eé]\s+de\s+.+)?$/iu);
    if (iutCampusMatch) {
      pushVariant(`IUT ${iutCampusMatch[1]}`);
      pushVariant(`Institut Universitaire de Technologie de ${iutCampusMatch[1]}`);
    }
  }

  const instituteSiteMatch = normalizedValue.match(
    /^IUT\s+([\p{L}\p{N}.'’/-]+)(?:\s+Universit[eé]\s+de\s+.+)?$/iu,
  );
  if (instituteSiteMatch) {
    pushVariant(`Institut Universitaire de Technologie de ${instituteSiteMatch[1]}`);
  }

  const numericLeadingStreetMatch = normalizedValue.match(
    new RegExp(
      String.raw`^((?:\d+(?:\s+(?:bis|ter|quater))?|${streetNumberBodyPattern}))\s+(${addressPrefixPattern}\s+${addressBodyPattern})$`,
      "iu",
    ),
  );
  if (numericLeadingStreetMatch) {
    pushVariant(`${numericLeadingStreetMatch[2]} ${numericLeadingStreetMatch[1]}`);
  }

  const trailingStreetCoreMatch = normalizedValue.match(
    new RegExp(
      String.raw`(?:^|[\s,;:-])(${compoundTrailingStreetWordPattern}|[\p{L}\p{N}.'’/-]+\s+${trailingStreetTypePattern})$`,
      "iu",
    ),
  );
  if (trailingStreetCoreMatch?.[1]) {
    pushVariant(trailingStreetCoreMatch[1]);
  }

  const strippedSiteWrapper = normalizeWhitespace(
    normalizedValue.replace(
      /^(?:quartier|quartiers|lotissement|urbanizaci[oó]n|urbanizzazione|resid[eé]nce|residenza|parque(?:\s+empresarial)?|parco|zac|zap|zone\s+d['’](?:am[eé]nagement|activit[eé]s?)|site(?:\s+pilote)?|[iî]lot|ilot|secteur|sous-secteur|lieu-dit|groupe\s+scolaire|[eé]cole|coll[eè]ge|lyc[eé]e|gymnase|mus[eé]e|palais|complexe|centre\s+d['’]intervention)\s+(?:(?:de|del|de la|des|du|la|le|los|las)\s+)?/iu,
      "",
    ),
  );
  if (strippedSiteWrapper && strippedSiteWrapper !== normalizedValue) {
    pushVariant(strippedSiteWrapper);
  }

  const frenchSiteWithCityMatch = normalizedValue.match(
    /^(.*?)(?:\s+(?:a|à|au|aux|sur|sous|l[eè]s)\s+)([\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4})$/iu,
  );
  if (
    frenchSiteWithCityMatch &&
    !new RegExp(String.raw`^${addressPrefixPattern}\b`, "iu").test(normalizedValue)
  ) {
    pushVariant(frenchSiteWithCityMatch[1]);
    pushVariant(`${frenchSiteWithCityMatch[1]} ${frenchSiteWithCityMatch[2]}`);
  }

  const chineseSiteMatch = normalizedValue.match(
    /^([\p{Script=Han}\p{L}\p{N}-]{1,40}(?:校区|院区|园区|片区|街区|地块|小区|社区|村\d+号|村|广场|公园|基地))$/u,
  );
  if (chineseSiteMatch) {
    pushVariant(chineseSiteMatch[1]);
  }

  const chineseFacilityCore = extractChineseFacilityCore(normalizedValue);
  if (chineseFacilityCore) {
    pushVariant(chineseFacilityCore);
  }

  const chineseInstitutionBaseName = extractChineseInstitutionBaseName(normalizedValue);
  if (chineseInstitutionBaseName) {
    pushVariant(chineseInstitutionBaseName);
  }

  const chineseInstitutionSiteMatch = normalizedValue.match(chineseInstitutionSiteTailPattern);
  if (chineseInstitutionSiteMatch?.[1]) {
    pushVariant(chineseInstitutionSiteMatch[1]);
  }

  const spacedChineseRoadNumberVariant = expandChineseRoadNumberVariant(normalizedValue);
  if (spacedChineseRoadNumberVariant) {
    pushVariant(spacedChineseRoadNumberVariant);
  }

  for (const roadCandidate of extractChineseRoadCandidates(normalizedValue)) {
    pushVariant(roadCandidate);
    const spacedRoadCandidate = expandChineseRoadNumberVariant(roadCandidate);
    if (spacedRoadCandidate) {
      pushVariant(spacedRoadCandidate);
    }
  }

  const chineseAdministrativeLeadMatch = normalizedValue.match(
    /^((?:[\p{Script=Han}]{1,12}(?:省|市|区|县|镇|乡|街道|新区)){1,4})([\p{Script=Han}\p{L}\p{N}-]{1,40}(?:村\d+号|村|地块|街区|片区|园区|基地))$/u,
  );
  if (chineseAdministrativeLeadMatch) {
    pushVariant(chineseAdministrativeLeadMatch[0]);
    pushVariant(chineseAdministrativeLeadMatch[2]);
  }

  const chineseVillageNumberMatch = normalizedValue.match(
    /^([\p{Script=Han}]{2,20}村\d+号)$/u,
  );
  if (chineseVillageNumberMatch) {
    pushVariant(chineseVillageNumberMatch[1]);
    pushVariant(chineseVillageNumberMatch[1].replace(/\d+号$/u, ""));
  }

  return variants;
};

export const normalizeLocalityForGeocoderSearch = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeWhitespace(
    value
      .replace(/\s*\([A-Z]{2}\)\s*/gu, " ")
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[”"]+$/g, "")
      .replace(/\b(?:w|v|u)\s+([\p{L}\p{N}.'’/-]+(?:\s+[\p{L}\p{N}.'’/-]+){0,4})$/iu, "$1"),
  );

  if (!normalized) {
    return null;
  }

  const chineseCityMatch = normalized.match(/^([\p{Script=Han}]{2,12})(?:城市|市)$/u);
  if (chineseCityMatch?.[1]) {
    return chineseCityMatch[1];
  }

  return normalized;
};
