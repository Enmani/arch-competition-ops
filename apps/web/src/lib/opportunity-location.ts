import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

type OpportunityLocationInput = Pick<
  StoredOpportunityFeedItem,
  "authorityName" | "jurisdictionKey" | "jurisdictionLabel" | "title"
>;

const trimLocationCandidate = (value: string) =>
  value
    .replace(/^[\s,;:]+|[\s,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

const normalizeLocationCandidate = (value: string) =>
  trimLocationCandidate(
    value
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .replace(/[–—]/g, "-")
      .replace(/^["']+|["']+$/g, ""),
  )
    .replace(/\s*\([A-Z]{2}\)\s*$/u, "")
    .replace(/^(?:en|in|nel|nella|at|sur|em|na|no|te)\s+/iu, "");

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

  if (looksAddressLikeLocationCandidate(candidate)) {
    return false;
  }

  const words = candidate.split(/\s+/);
  if (words.length > 5) {
    return false;
  }

  return !/\b(?:amt|department|office|regierung|council|cabildo|authority)\b/i.test(candidate);
};

export const pickOpportunityExplicitCity = (opportunity: OpportunityLocationInput) => {
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

  const municipalTitleMatch = opportunity.title.match(
    /\bt[eé]rmino municipal de\s+(.+?)(?:\s+de la provincia|\s*[.;,]|$)/iu,
  );
  if (municipalTitleMatch && isUsefulLocationCandidate(municipalTitleMatch[1])) {
    return normalizeLocationCandidate(municipalTitleMatch[1]);
  }

  const authorityCityMatch = opportunity.authorityName.match(
    /\b(?:gemeindeverwaltung|gemeinde|commune de|ville de|city of|municipality of|munic[ií]pio do|munic[ií]pio de|gemeente|stad\s+|ayuntamiento de|municipio de|comune(?: di)?|citt[aà] di)\s+(.+?)(?:\s+v\/.*|\s*\(|\s+-|$)/iu,
  );
  if (authorityCityMatch && isUsefulLocationCandidate(authorityCityMatch[1])) {
    return normalizeLocationCandidate(authorityCityMatch[1]);
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

  return null;
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
