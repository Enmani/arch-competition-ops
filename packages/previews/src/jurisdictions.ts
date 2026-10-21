// The one registry of jurisdictions the preview code knows by key (`competitions.jurisdiction`).
//
// It replaces three hand-kept maps: the display country code (location), the atlas name and polygon
// count for the placeholder outline, and the country names used to compare geocoder results, plus
// the ISO code passed to Nominatim. Keys use the underscore form; spellings such as the
// hyphenated `united-kingdom` that old rows carry are normalised by `normalizeJurisdictionKey`,
// so no country is listed twice.
//
// Adding a country: add one entry to data/jurisdictions.json. `atlasName` (Natural Earth name)
// gives it a placeholder outline after `npm run build:outlines -w @arch-competition/previews`.
import jurisdictions from "../data/jurisdictions.json";
import { normalizeJurisdictionKey } from "./text/normalize";

export type JurisdictionEntry = {
  atlasName?: string;
  /** Short code shown on the placeholder, e.g. "CH" ("UK" for the United Kingdom). */
  code: string;
  /** Lower-case, accent-free names that identify the country inside an address string. */
  comparisonNames: readonly string[];
  /** ISO 3166-1 alpha-2, lower case, for the Nominatim `countrycodes` filter. */
  geocoderCountryCode?: string;
  /** How many of the largest landmass polygons to draw when the country has islands or exclaves. */
  polygonCount?: number;
};

export const jurisdictionRegistry: Readonly<Record<string, JurisdictionEntry>> = jurisdictions;

export const getJurisdictionEntry = (value: string | null | undefined): JurisdictionEntry | null => {
  const key = normalizeJurisdictionKey(value);
  return key && Object.hasOwn(jurisdictionRegistry, key) ? jurisdictionRegistry[key] : null;
};
