// Build geocoder query permutations and locality candidates.
import {
  pickOpportunityDisplayLocality,
  pickOpportunityExplicitCity,
  sanitizeOpportunityLocationLabel,
} from "../location";
import { cleanLocalityHint } from "../address/clean";
import { dedupeAddressCandidates } from "../address/compare";
import {
  multiLocalityConnectorPattern,
  rejectedBroadChineseLocalityPattern,
} from "../address/patterns";
import {
  expandAddressVariantsForGeocoder,
  expandLocalityVariantsForGeocoder,
  normalizeLocalityForGeocoderSearch,
  normalizeLocalityHintForGeocoder,
  stripLeadingStreetPrefixForGeocoder,
} from "./normalize";
import { normalizeComparisonText, normalizeWhitespace } from "../text/normalize";
import type { AddressCandidate, PreviewOpportunity } from "../types";

export const buildLocalityCandidate = (
  value: string | null | undefined,
  source: AddressCandidate["source"],
): AddressCandidate | null => {
  const sanitizedLocation = sanitizeOpportunityLocationLabel(value);
  if (!sanitizedLocation) {
    return null;
  }

  if (multiLocalityConnectorPattern.test(sanitizedLocation) || rejectedBroadChineseLocalityPattern.test(sanitizedLocation)) {
    return null;
  }

  return {
    address: sanitizedLocation,
    kind: "locality",
    localityHint: null,
    source,
  } satisfies AddressCandidate;
};

export const buildLocalityCandidatesFromAddressHints = (candidates: AddressCandidate[]) =>
  dedupeAddressCandidates(
    candidates.flatMap((candidate) => {
      const localityCandidate = buildLocalityCandidate(cleanLocalityHint(candidate.localityHint ?? ""), candidate.source);
      if (!localityCandidate) {
        return [];
      }

      return normalizeComparisonText(localityCandidate.address) ===
        normalizeComparisonText(candidate.address)
        ? []
        : [localityCandidate];
    }),
  );

export const resolveOpportunityLocalityCandidates = (opportunity: PreviewOpportunity) =>
  dedupeAddressCandidates(
    [
      buildLocalityCandidate(pickOpportunityDisplayLocality(opportunity), "title"),
      sanitizeOpportunityLocationLabel(opportunity.locationLabel) &&
      sanitizeOpportunityLocationLabel(opportunity.locationLabel) !== opportunity.locationLabel
        ? buildLocalityCandidate(sanitizeOpportunityLocationLabel(opportunity.locationLabel), "page")
        : null,
      buildLocalityCandidate(pickOpportunityExplicitCity(opportunity), "title"),
    ].flatMap((candidate) => (candidate ? [candidate] : [])),
  );

export type GeocodeQueryOptions = {
  includeExplicitCity?: boolean;
  includeLocationLabel?: boolean;
  includeJurisdictionLabel?: boolean;
};

export const buildGeocodeQueries = (
  opportunity: PreviewOpportunity,
  candidate: AddressCandidate,
  options: GeocodeQueryOptions = {},
) => {
  const explicitCity =
    options.includeExplicitCity === false ? null : pickOpportunityDisplayLocality(opportunity);
  const addressVariants = expandAddressVariantsForGeocoder(candidate.address);
  const localityVariants = expandLocalityVariantsForGeocoder(candidate.localityHint);
  const localityOptions = localityVariants.length > 0 ? localityVariants : [null];
  const seenQueries = new Set<string>();
  const queries: string[] = [];
  const includeLocationLabel = options.includeLocationLabel !== false;
  const includeJurisdictionLabel = options.includeJurisdictionLabel !== false;

  for (const addressVariant of addressVariants) {
    for (const localityVariant of localityOptions) {
      const seenParts = new Set<string>();
      const parts: string[] = [];

      const pushPart = (value: string | null | undefined) => {
        if (typeof value !== "string") {
          return;
        }

        const normalizedValue = normalizeWhitespace(value);
        if (!normalizedValue) {
          return;
        }

        const comparisonKey = normalizeComparisonText(normalizedValue);
        if (seenParts.has(comparisonKey)) {
          return;
        }

        seenParts.add(comparisonKey);
        parts.push(normalizedValue);
      };

      if (candidate.kind === "locality") {
        pushPart(normalizeLocalityForGeocoderSearch(addressVariant));
      } else {
        pushPart(addressVariant);
      }
      pushPart(normalizeLocalityForGeocoderSearch(normalizeLocalityHintForGeocoder(localityVariant)));
      pushPart(normalizeLocalityForGeocoderSearch(explicitCity));
      if (includeLocationLabel) {
        pushPart(normalizeLocalityForGeocoderSearch(sanitizeOpportunityLocationLabel(opportunity.locationLabel)));
      }
      if (includeJurisdictionLabel) {
        pushPart(opportunity.jurisdictionLabel);
      }

      const query = normalizeWhitespace(parts.join(", "));
      const queryKey = normalizeComparisonText(query);
      if (!query || seenQueries.has(queryKey)) {
        continue;
      }

      seenQueries.add(queryKey);
      queries.push(query);
    }
  }

  return queries;
};

export const resolveGeocodeQueries = (
  opportunity: PreviewOpportunity,
  candidate: AddressCandidate,
) => buildGeocodeQueries(opportunity, candidate);

export const resolveFallbackGeocodeQueries = (
  opportunity: PreviewOpportunity,
  candidate: AddressCandidate,
) => {
  const strippedAddress = stripLeadingStreetPrefixForGeocoder(candidate.address);
  const explicitCity = normalizeLocalityForGeocoderSearch(pickOpportunityDisplayLocality(opportunity));
  const normalizedLocalityHint = normalizeLocalityForGeocoderSearch(
    normalizeLocalityHintForGeocoder(candidate.localityHint),
  );
  const fallbackCandidate =
    strippedAddress !== candidate.address && candidate.kind === "street_address"
      ? {
          ...candidate,
          address: strippedAddress,
          localityHint:
            explicitCity &&
            normalizedLocalityHint &&
            normalizeComparisonText(explicitCity) !== normalizeComparisonText(normalizedLocalityHint)
              ? null
              : candidate.localityHint,
          kind: "street" as const,
        }
      : strippedAddress !== candidate.address && candidate.kind === "street"
        ? {
            ...candidate,
            address: strippedAddress,
            localityHint:
              explicitCity &&
              normalizedLocalityHint &&
              normalizeComparisonText(explicitCity) !== normalizeComparisonText(normalizedLocalityHint)
                ? null
                : candidate.localityHint,
          }
    : candidate;

  const fallbackQueries = [
    ...buildGeocodeQueries(opportunity, fallbackCandidate),
    ...buildGeocodeQueries(opportunity, fallbackCandidate, {
      includeJurisdictionLabel: false,
    }),
    ...buildGeocodeQueries(opportunity, fallbackCandidate, {
      includeJurisdictionLabel: false,
      includeLocationLabel: false,
    }),
    ...(candidate.kind === "locality"
      ? []
      : buildGeocodeQueries(opportunity, fallbackCandidate, {
          includeExplicitCity: false,
          includeJurisdictionLabel: false,
          includeLocationLabel: false,
        })),
  ];

  return fallbackQueries.filter((query) => query.length > 0);
};
