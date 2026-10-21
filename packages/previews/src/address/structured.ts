// Extract address candidates from meta tags and JSON-LD.
import {
  cleanAddressCandidate,
  cleanLocalityHint,
  cleanSiteCandidate,
  extractLocalityHintFromPlacename,
  extractStreetAddressFromPlacename,
  normalizeStructuredField,
} from "./clean";
import { dedupeAddressCandidates, hasStreetNumber } from "./compare";
import { extractAddressCandidatesFromText } from "./extract";
import { parseTagAttributes } from "../text/html";
import type { AddressCandidate, StructuredAddressRecord } from "../types";

export const buildStructuredAddressCandidates = (record: StructuredAddressRecord) => {
  const placename = normalizeStructuredField(record.placename);
  const localityHint =
    cleanLocalityHint(record.locality ?? "") ?? extractLocalityHintFromPlacename(placename);
  const structuredStreetAddress =
    normalizeStructuredField(record.streetAddress) ?? extractStreetAddressFromPlacename(placename);

  if (structuredStreetAddress) {
    const kind = /^(?:campus)\b/iu.test(structuredStreetAddress)
      ? "site"
      : hasStreetNumber(structuredStreetAddress)
        ? "street_address"
        : "street";
    const cleanedAddress =
      kind === "site"
        ? cleanSiteCandidate(structuredStreetAddress)
        : cleanAddressCandidate(structuredStreetAddress);

    if (!cleanedAddress) {
      return [] as AddressCandidate[];
    }

    return [
      {
        address: cleanedAddress,
        kind,
        localityHint,
        source: "page",
      } satisfies AddressCandidate,
    ];
  }

  if (!placename) {
    return [] as AddressCandidate[];
  }

  return extractAddressCandidatesFromText(placename, "page").map((candidate) =>
    localityHint && !candidate.localityHint
      ? {
          ...candidate,
          localityHint,
        }
      : candidate,
  );
};

export const collectJsonStructuredAddressRecords = (
  value: unknown,
  target: StructuredAddressRecord[],
) => {
  if (!value) {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry) => collectJsonStructuredAddressRecords(entry, target));
    return;
  }

  if (typeof value !== "object") {
    return;
  }

  const record = value as Record<string, unknown>;
  const streetAddress = typeof record.streetAddress === "string" ? record.streetAddress : null;
  const locality =
    typeof record.addressLocality === "string"
      ? record.addressLocality
      : typeof record.locality === "string"
        ? record.locality
        : null;
  const placename =
    typeof record.name === "string"
      ? record.name
      : typeof record.alternateName === "string"
        ? record.alternateName
        : typeof record.description === "string"
          ? record.description
          : null;

  if (
    streetAddress ||
    locality ||
    typeof record.addressRegion === "string" ||
    typeof record.postalCode === "string" ||
    typeof record.addressCountry === "string"
  ) {
    target.push({
      country: typeof record.addressCountry === "string" ? record.addressCountry : null,
      locality,
      placename,
      postalCode: typeof record.postalCode === "string" ? record.postalCode : null,
      region: typeof record.addressRegion === "string" ? record.addressRegion : null,
      streetAddress,
    });
  }

  Object.values(record).forEach((entry) => collectJsonStructuredAddressRecords(entry, target));
};

export const extractStructuredAddressCandidatesFromHtml = (html: string) => {
  const metaValues = new Map<string, string[]>();
  const structuredRecords: StructuredAddressRecord[] = [];

  const appendMetaValue = (key: string, value: string | null | undefined) => {
    const normalizedValue = normalizeStructuredField(value);
    if (!normalizedValue) {
      return;
    }

    const existing = metaValues.get(key) ?? [];
    if (!existing.includes(normalizedValue)) {
      existing.push(normalizedValue);
      metaValues.set(key, existing);
    }
  };

  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const attributes = parseTagAttributes(match[0]);
    const key = (attributes.property ?? attributes.name ?? attributes.itemprop ?? "").toLowerCase();
    if (!key) {
      continue;
    }

    appendMetaValue(key, attributes.content);
  }

  const streetAddresses = [
    ...(metaValues.get("og:street_address") ?? []),
    ...(metaValues.get("streetaddress") ?? []),
  ];
  const localities = [
    ...(metaValues.get("og:locality") ?? []),
    ...(metaValues.get("addresslocality") ?? []),
  ];
  const placenames = [...(metaValues.get("geo.placename") ?? [])];
  const postalCodes = [
    ...(metaValues.get("og:postal_code") ?? []),
    ...(metaValues.get("postalcode") ?? []),
  ];
  const regions = [
    ...(metaValues.get("og:region") ?? []),
    ...(metaValues.get("addressregion") ?? []),
  ];
  const countries = [
    ...(metaValues.get("og:country_name") ?? []),
    ...(metaValues.get("addresscountry") ?? []),
  ];

  streetAddresses.forEach((streetAddress) => {
    structuredRecords.push({
      country: countries[0] ?? null,
      locality: localities[0] ?? null,
      placename: placenames[0] ?? null,
      postalCode: postalCodes[0] ?? null,
      region: regions[0] ?? null,
      streetAddress,
    });
  });

  placenames.forEach((placename) => {
    structuredRecords.push({
      country: countries[0] ?? null,
      locality: localities[0] ?? null,
      placename,
      postalCode: postalCodes[0] ?? null,
      region: regions[0] ?? null,
      streetAddress: null,
    });
  });

  for (const match of html.matchAll(
    /<script\b[^>]*type=(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const payload = match[1]?.trim();
    if (!payload) {
      continue;
    }

    try {
      collectJsonStructuredAddressRecords(JSON.parse(payload), structuredRecords);
    } catch {
      continue;
    }
  }

  return dedupeAddressCandidates(
    structuredRecords.flatMap((record) => buildStructuredAddressCandidates(record)),
  );
};
