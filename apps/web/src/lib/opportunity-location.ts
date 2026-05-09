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

const isUsefulLocationCandidate = (value: string) => {
  const candidate = trimLocationCandidate(value);
  if (!candidate) {
    return false;
  }

  const words = candidate.split(/\s+/);
  if (words.length > 5) {
    return false;
  }

  return !/\b(?:amt|department|office|regierung|council|cabildo|authority)\b/i.test(candidate);
};

export const pickOpportunityExplicitCity = (opportunity: OpportunityLocationInput) => {
  const postalCodeTailMatch = opportunity.title.match(
    /,\s*(?:\d{4,5}\s+)?([\p{Lu}][\p{L}\p{M}'’.\-]*(?:[\s-][\p{Lu}][\p{L}\p{M}'’.\-]*){0,3})\s*$/u,
  );
  if (postalCodeTailMatch && isUsefulLocationCandidate(postalCodeTailMatch[1])) {
    return trimLocationCandidate(postalCodeTailMatch[1]);
  }

  const municipalTitleMatch = opportunity.title.match(
    /\bt[eé]rmino municipal de\s+(.+?)(?:\s+de la provincia|\s*[.;,]|$)/iu,
  );
  if (municipalTitleMatch && isUsefulLocationCandidate(municipalTitleMatch[1])) {
    return trimLocationCandidate(municipalTitleMatch[1]);
  }

  const authorityCityMatch = opportunity.authorityName.match(
    /\b(?:gemeindeverwaltung|gemeinde|commune de|ville de|city of|municipality of|ayuntamiento de|municipio de|comune(?: di)?|citt[aà] di)\s+(.+?)(?:\s*\(|\s+-|$)/iu,
  );
  if (authorityCityMatch && isUsefulLocationCandidate(authorityCityMatch[1])) {
    return trimLocationCandidate(authorityCityMatch[1]);
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
