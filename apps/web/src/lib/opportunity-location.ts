import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

type OpportunityLocationInput = Pick<
  StoredOpportunityFeedItem,
  "authorityName" | "jurisdictionKey" | "jurisdictionLabel" | "title"
>;

type OpportunityDisplayLocationInput = OpportunityLocationInput &
  Pick<StoredOpportunityFeedItem, "locationLabel">;

const combiningDiacriticPattern = /[\u0300-\u036f]/g;

const trimLocationCandidate = (value: string) =>
  value
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const splitLocationSegments = (value: string) =>
  value
    .split(",")
    .map((segment) => trimLocationCandidate(segment))
    .filter(Boolean);

const normalizeLocationComparisonText = (value: string) =>
  value
    .normalize("NFD")
    .replace(combiningDiacriticPattern, "")
    .toLowerCase();

const splitLocationComparisonTokens = (value: string) =>
  normalizeLocationComparisonText(value)
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

const locationAuthorityNoisePattern =
  /\b(?:authority|cabildo|council|department|direktion|office|regierung|toimiala)\b/iu;
const locationInstitutionNoisePattern =
  /\b(?:banner|campus|center|centre|community|hospital|library|newsletter|plant|project|school|site|stadium|station|wearch)\b/iu;
const locationNoisePattern =
  /\b(?:abschnitt|anlagengruppe|banner|contabilit[aà]|coordinamento|cre|cse|detailplan(?:ung)?|direzione|freianlagen|hoai|iark|investimento|lark|lavori|newsletter|optional(?:e)?|phase\s+candidature|regolare\s+esecuzione|vergabenummer)\b/iu;
const locationUrlLikePattern =
  /(?:https?:\/\/|www\.|[a-z0-9-]+\.(?:com|org|net|eu|gov|edu|it|fr|de|es|pt|cn|nz|no|ch|ca)\b)/iu;
const chineseAdministrativeTitleLeadPattern =
  /^(?:\d{4}年)?((?:(?:[\p{Script=Han}]{1,12}(?:市|县|镇|乡|街道|新区|开发区|自治州|自治县))|(?:[\p{Script=Han}]{1,12}区)){1,4})/u;
const chineseAdministrativeCorePattern = /(?:市|县|镇|乡|街道|新区|开发区|自治州|自治县)/u;
const chineseProjectScaleTailPattern = /(?:片区|街区|地块|小区|校区|院区|园区|基地)$/u;
const dashSeparatedTitleLeadPattern = /\s*[–—-]\s*/u;
const dashSeparatedLocationFollowerPattern =
  /^(?:chemin|rue|route|avenue|avenues|boulevard|all[eé]e|impasse|quai|parvis|esplanade|zac|zap|zone\s+d['’](?:am[eé]nagement|activit[eé]s?)|groupe\s+scolaire|coll[eè]ge|lyc[eé]e|gymnase|mus[eé]e|palais|centre\s+d['’]intervention|complexe|site)\b/iu;

const prefersTrailingLocationSegment = (value: string) => {
  const segments = splitLocationSegments(value);
  if (segments.length < 2) {
    return value;
  }

  const trailingSegment = segments[segments.length - 1] ?? value;
  const leadingSegments = segments.slice(0, -1).join(", ");
  const trailingTokens = splitLocationComparisonTokens(trailingSegment);
  if (trailingTokens.length === 0 || trailingTokens.length > 4) {
    return value;
  }

  if (
    locationAuthorityNoisePattern.test(leadingSegments) ||
    segments.slice(0, -1).some((segment) => segment.split(/\s+/).length > 4)
  ) {
    return trailingSegment;
  }

  return value;
};

const normalizeLocationCandidate = (value: string) =>
  trimLocationCandidate(
    prefersTrailingLocationSegment(value)
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/^["']+|["']+$/g, ""),
  )
    .replace(/\s*\([A-Z]{2}\)\s*$/u, "")
    .replace(/^(?:at|au|aux|em|en|im|in|na|nel|nella|no|sur|te|v|w|u|à)\s+/iu, "");

const addressLikeLocationPattern =
  /^(?:(?:en|in|nel|nella|a|at|sur|na|no|em|w|v|u)\s+)?(?:c\/|c\.|via|viale|piazza|piazzale|corso|largo|vicolo|lungomare|strada|street|road|drive|lane|way|boulevard|avenue|avenida|avda\.?|av\.|rue|route|allee|gasse|platz|strasse|straße|calle|camino|carretera|ruta|plaza|paseo|ronda|rua|travessa|estrada|pra[çc]a|cal[çc]ada|rotunda|laan|plein|gracht|kade|singel|dreef|tie|katu|kuja|polku|ul\.?|ulica|ulice|aleja|al\.?|bd\.?|bulevard(?:ul)?|bulvar|bulevar|str\.?|calea|sos\.?|șos\.?|ул\.?)\b/iu;
const trailingStreetLikeLocationPattern =
  /\b(?:[\p{L}\p{N}.'’/-]+\s+)?[\p{L}\p{N}.'’/-]+(?:straat|laan|plein|gracht|kade|singel|dreef|gade|gata|gatan|gate|torv|torget|plass|plassen|vei|veien|veg|vegen|v[aä]g|v[aä]gen|tie|katu|kuja|polku|cesta|ulica|n[aá]m[ěe]st[ií]|trg|utca)\s+\d[\p{L}\p{N}/-]{0,7}\b/iu;

const looksAddressLikeLocationCandidate = (value: string) => {
  const candidate = normalizeLocationCandidate(value);
  return addressLikeLocationPattern.test(candidate) || trailingStreetLikeLocationPattern.test(candidate);
};

const isUsefulLocationCandidate = (value: string) => {
  const candidate = normalizeLocationCandidate(value);
  if (!candidate) {
    return false;
  }

  if (/^[\p{Ll}]/u.test(candidate) && !/[\p{Lu}]/u.test(candidate)) {
    return false;
  }

  if (/\b(?:esta localidad|this locality|questa localit[aà])\b/i.test(candidate)) {
    return false;
  }

  if (/^(?:district|distrito|bairro|barrio)\b/i.test(candidate)) {
    return false;
  }

  if (locationNoisePattern.test(candidate)) {
    return false;
  }

  if (locationUrlLikePattern.test(candidate)) {
    return false;
  }

  if (looksAddressLikeLocationCandidate(candidate)) {
    return false;
  }

  if (candidate.includes(",") && !splitLocationSegments(candidate).every((segment) => !locationNoisePattern.test(segment))) {
    return false;
  }

  if (
    /(?:\b\d{2,}\b(?!\s*\))|\b[A-Z]{2,}\d+[A-Z0-9-]*\b)/u.test(candidate) &&
    !/\(\d{4,5}\)\s*$/u.test(candidate)
  ) {
    return false;
  }

  if (locationInstitutionNoisePattern.test(candidate)) {
    return false;
  }

  if (/[省]$/u.test(candidate) || /(自治区|特别行政区)$/u.test(candidate)) {
    return false;
  }

  const words = candidate.split(/\s+/);
  if (words.length > 5) {
    return false;
  }

  return !locationAuthorityNoisePattern.test(candidate);
};

export const sanitizeOpportunityLocationLabel = (value: string | null | undefined) => {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = normalizeLocationCandidate(value);
  return normalized && isUsefulLocationCandidate(normalized) ? normalized : null;
};

const haveCompatibleLocationTokens = (leftValue: string, rightValue: string) => {
  const leftTokens = splitLocationComparisonTokens(leftValue);
  const rightTokens = splitLocationComparisonTokens(rightValue);
  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false;
  }

  return (
    leftTokens.every((token) => rightTokens.includes(token)) ||
    rightTokens.every((token) => leftTokens.includes(token))
  );
};

export const pickOpportunityExplicitCity = (opportunity: OpportunityLocationInput) => {
  const chineseLeadingAdministrativeTitleMatch = opportunity.title.match(chineseAdministrativeTitleLeadPattern);
  if (
    chineseLeadingAdministrativeTitleMatch &&
    chineseAdministrativeCorePattern.test(chineseLeadingAdministrativeTitleMatch[1]) &&
    isUsefulLocationCandidate(chineseLeadingAdministrativeTitleMatch[1]) &&
    !chineseProjectScaleTailPattern.test(chineseLeadingAdministrativeTitleMatch[1])
  ) {
    return normalizeLocationCandidate(chineseLeadingAdministrativeTitleMatch[1]);
  }

  const authorityCityMatch = opportunity.authorityName.match(
    /\b(?:gemeindeverwaltung|gemeinde|commune de|commune d['’]|mairie de|mairie d['’]|ville de|city of|municipality of|munic[ií]pio do|munic[ií]pio de|gemeente|stad\s+|ayuntamiento de|municipio de|comune(?: di)?|citt[aà] di)\s+(.+?)(?:\s+v\/.*|\s*\(|\s+-|$)/iu,
  );
  if (authorityCityMatch && isUsefulLocationCandidate(authorityCityMatch[1])) {
    return normalizeLocationCandidate(authorityCityMatch[1]);
  }

  const provincialAuthorityCityMatch = opportunity.authorityName.match(
    /\b(?:provincia di|province of|citt[aà] metropolitana di)\s+(.+?)(?:\s+v\/.*|\s*\(|\s+-|$)/iu,
  );
  if (provincialAuthorityCityMatch && isUsefulLocationCandidate(provincialAuthorityCityMatch[1])) {
    return normalizeLocationCandidate(provincialAuthorityCityMatch[1]);
  }

  const centralEuropeanAuthorityPrefixCityMatch = opportunity.authorityName.match(
    /^(?:gmina\s+miasto|miasto|m[eě]sto|obec|grad|v[aá]ros|obshtina)\s+(.+?)(?:\s+v\/.*|\s*\(|\s+-|$)/iu,
  );
  if (
    centralEuropeanAuthorityPrefixCityMatch &&
    isUsefulLocationCandidate(centralEuropeanAuthorityPrefixCityMatch[1])
  ) {
    return normalizeLocationCandidate(centralEuropeanAuthorityPrefixCityMatch[1]);
  }

  const trailingAuthorityCityMatch = opportunity.authorityName.match(
    /^(.+?)\s+(?:kommune|kommun|kaupunki)(?:\s+v\/.*|\s*\(|\s+-|$)/iu,
  );
  if (trailingAuthorityCityMatch && isUsefulLocationCandidate(trailingAuthorityCityMatch[1])) {
    return normalizeLocationCandidate(trailingAuthorityCityMatch[1]);
  }

  const trailingCentralEuropeanAuthorityCityMatch = opportunity.authorityName.match(
    /^(.+?)\s+(?:miasto|m[eě]sto|obec|gmina|grad|v[aá]ros|obshtina)(?:\s+v\/.*|\s*\(|\s+-|$)/iu,
  );
  if (
    trailingCentralEuropeanAuthorityCityMatch &&
    isUsefulLocationCandidate(trailingCentralEuropeanAuthorityCityMatch[1])
  ) {
    return normalizeLocationCandidate(trailingCentralEuropeanAuthorityCityMatch[1]);
  }

  const cityBeforeAddressTailMatch = opportunity.title.match(
    /,\s*([^,\d.;][^,.;]{1,79})\s*,\s*([^,.;]{1,120})\s*$/u,
  );
  if (
    cityBeforeAddressTailMatch &&
    isUsefulLocationCandidate(cityBeforeAddressTailMatch[1]) &&
    looksAddressLikeLocationCandidate(cityBeforeAddressTailMatch[2])
  ) {
    return normalizeLocationCandidate(cityBeforeAddressTailMatch[1]);
  }

  const cityBeforeDescriptiveTailMatch = opportunity.title.match(
    /,\s*([^,\d.;][^,.;]{1,79})\s*,\s*(?:z|with|con|w|v|u|em|en|nel|in|na|no)\b/iu,
  );
  if (
    cityBeforeDescriptiveTailMatch &&
    isUsefulLocationCandidate(cityBeforeDescriptiveTailMatch[1])
  ) {
    return normalizeLocationCandidate(cityBeforeDescriptiveTailMatch[1]);
  }

  const postalCodeTailMatch = opportunity.title.match(
    /,\s*(?:\d{4,5}\s+)?([^,\d.;][^,.;]{1,79})\s*$/u,
  );
  if (postalCodeTailMatch && isUsefulLocationCandidate(postalCodeTailMatch[1])) {
    return normalizeLocationCandidate(postalCodeTailMatch[1]);
  }

  const dashSeparatedSegments = opportunity.title
    .split(dashSeparatedTitleLeadPattern)
    .map((segment) =>
      normalizeLocationCandidate(segment.replace(/^[«»"“”'\s]+|[«»"“”'\s]+$/gu, "")),
    )
    .filter(Boolean);
  for (let index = 0; index < dashSeparatedSegments.length - 1; index += 1) {
    const currentSegment = dashSeparatedSegments[index];
    const nextSegment = dashSeparatedSegments[index + 1] ?? "";
    if (
      currentSegment &&
      isUsefulLocationCandidate(currentSegment) &&
      dashSeparatedLocationFollowerPattern.test(nextSegment)
    ) {
      return currentSegment;
    }
  }

  const trailingPrepositionCityMatch = opportunity.title.match(
    /\b(?:a|à|au|aux|in|en|em|nel|nella|na|no|w|v|u|sur|sous|l[eè]s)\s+([^,.;()]{2,80})(?:\s*(?:\((?:[A-Z]{2}|\d{2,5})\)|\d{2,5})?\s*)$/iu,
  );
  if (
    trailingPrepositionCityMatch &&
    isUsefulLocationCandidate(trailingPrepositionCityMatch[1])
  ) {
    return normalizeLocationCandidate(trailingPrepositionCityMatch[1]);
  }

  const municipalTitleMatch = opportunity.title.match(
    /\bt[eé]rmino municipal de\s+(.+?)(?:\s+de la provincia|\s*[.;,]|$)/iu,
  );
  if (municipalTitleMatch && isUsefulLocationCandidate(municipalTitleMatch[1])) {
    return normalizeLocationCandidate(municipalTitleMatch[1]);
  }

  return null;
};

export const pickOpportunityDisplayLocality = (
  opportunity: OpportunityDisplayLocationInput,
) => {
  const explicitCity = pickOpportunityExplicitCity(opportunity);
  const sanitizedLocationLabel = sanitizeOpportunityLocationLabel(opportunity.locationLabel);

  if (explicitCity && sanitizedLocationLabel) {
    if (haveCompatibleLocationTokens(explicitCity, sanitizedLocationLabel)) {
      return sanitizedLocationLabel.length >= explicitCity.length
        ? sanitizedLocationLabel
        : explicitCity;
    }

    return explicitCity;
  }

  return explicitCity ?? sanitizedLocationLabel;
};

const countryCodeMap: Record<string, string> = {
  austria: "AT",
  belgium: "BE",
  canada: "CA",
  china: "CN",
  croatia: "HR",
  czechia: "CZ",
  denmark: "DK",
  estonia: "EE",
  finland: "FI",
  france: "FR",
  germany: "DE",
  greece: "GR",
  hungary: "HU",
  ireland: "IE",
  italy: "IT",
  latvia: "LV",
  lithuania: "LT",
  luxembourg: "LU",
  netherlands: "NL",
  norway: "NO",
  poland: "PL",
  portugal: "PT",
  romania: "RO",
  serbia: "RS",
  slovakia: "SK",
  slovenia: "SI",
  spain: "ES",
  sweden: "SE",
  switzerland: "CH",
  "united-kingdom": "UK",
  "united_kingdom": "UK",
};

export const getOpportunityJurisdictionCode = (opportunity: {
  jurisdictionKey: string | null | undefined;
  jurisdictionLabel: string | null | undefined;
}) => {
  const jurisdictionKey = opportunity.jurisdictionKey?.trim().toLowerCase();
  if (jurisdictionKey && countryCodeMap[jurisdictionKey]) {
    return countryCodeMap[jurisdictionKey];
  }

  const label = opportunity.jurisdictionLabel?.trim();
  if (!label) {
    return "OPS";
  }

  const initials = label
    .split(/[\s-]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return initials || label.slice(0, 2).toUpperCase();
};
