// Typed views over the JSON word lists in packages/previews/data. Keyword tables live in JSON so
// that adding a country or a marker is a data change, not a code change.
import geocodeAcceptance from "../data/geocode-acceptance.json";
import pageContextMarkers from "../data/page-context-markers.json";
import streetNoiseTokens from "../data/street-noise-tokens.json";

export const streetComparisonNoiseTokens = new Set<string>(streetNoiseTokens);

export const rejectedGeocodeAddressTypes = new Set<string>(geocodeAcceptance.rejectedAddressTypes);
export const acceptedExactGeocodeAddressTypes = new Set<string>(
  geocodeAcceptance.acceptedExactAddressTypes,
);
export const acceptedBroadGeocodeAddressTypes = new Set<string>(
  geocodeAcceptance.acceptedBroadAddressTypes,
);
export const acceptedGeocodeCategories = new Set<string>(geocodeAcceptance.acceptedCategories);
export const acceptedSiteGeocodeCategories = new Set<string>(
  geocodeAcceptance.acceptedSiteCategories,
);
export const acceptedLocalityGeocodeCategories = new Set<string>(
  geocodeAcceptance.acceptedLocalityCategories,
);

export const pageContactContextMarkers: string[] = pageContextMarkers.contact;
export const pagePlanNoiseMarkers: string[] = pageContextMarkers.planNoise;
export const pageChromeContextMarkers: string[] = pageContextMarkers.chrome;
export const projectContextMarkers: string[] = pageContextMarkers.project;
