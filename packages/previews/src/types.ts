// Shared types for address extraction, geocoding and rendering.

/**
 * The fields of an opportunity the preview code reads. The Web feed item and the CLI's own SQLite
 * reader both satisfy it structurally, so this package depends on neither the storage package nor
 * on a database driver.
 */
export type PreviewOpportunity = {
  authorityName: string;
  briefPdfUrl: string | null;
  documentsPortalUrl: string | null;
  geoLat?: number | null;
  geoLng?: number | null;
  jurisdictionKey: string | null;
  jurisdictionLabel: string;
  locationLabel: string | null;
  officialUrl: string | null;
  slug: string;
  sourceUrl: string | null;
  title: string;
};

export type AddressCandidateKind = "street_address" | "street" | "locality" | "site";

export type AddressCandidate = {
  address: string;
  kind: AddressCandidateKind;
  localityHint: string | null;
  source: "page" | "title";
};

export type OpportunityPageLocationSignals = {
  pdfCandidates: Array<{ score: number; url: string }>;
  structuredCandidates: AddressCandidate[];
  textCandidates: AddressCandidate[];
};

export type StructuredAddressRecord = {
  country: string | null;
  locality: string | null;
  placename: string | null;
  postalCode: string | null;
  region: string | null;
  streetAddress: string | null;
};

export type GeocodeResult = {
  lat: number;
  lng: number;
  precision: SatellitePreviewPrecision;
};

export type SatellitePreviewPrecision = "address" | "street" | "site" | "square" | "locality" | "city";

export type NominatimSearchResult = {
  address?: Record<string, string>;
  addresstype?: string;
  boundingbox?: string[];
  category?: string;
  display_name?: string;
  lat?: string;
  lon?: string;
  type?: string;
};

export type PhotonFeature = {
  geometry?: {
    coordinates?: number[];
  };
  properties?: {
    city?: string;
    country?: string;
    county?: string;
    district?: string;
    housenumber?: string;
    locality?: string;
    name?: string;
    state?: string;
    street?: string;
  };
};

export type PhotonSearchResult = {
  features?: PhotonFeature[];
};

export type BaiduGeocodeResult = {
  analys_level?: string;
  confidence?: number | string;
  comprehension?: number | string;
  level?: string;
  location?: {
    lat?: number | string;
    lng?: number | string;
  };
  precise?: number | string;
};

export type BaiduGeocodeResponse = {
  message?: string;
  result?: BaiduGeocodeResult | null;
  status?: number | string;
};

export type AmapGeocodeResult = {
  city?: string | string[];
  citycode?: string;
  district?: string;
  formatted_address?: string;
  level?: string;
  location?: string;
};

export type AmapGeocodeResponse = {
  count?: number | string;
  geocodes?: AmapGeocodeResult[];
  info?: string;
  status?: number | string;
};
