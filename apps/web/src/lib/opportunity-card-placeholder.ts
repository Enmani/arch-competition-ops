import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";
import countriesAtlas from "world-atlas/countries-50m.json";
import { geoArea, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";

import {
  getOpportunityJurisdictionCode,
  pickOpportunityExplicitCity,
} from "./opportunity-location";

type OpportunityPlaceholderInput = Pick<
  StoredOpportunityFeedItem,
  "authorityName" | "jurisdictionKey" | "jurisdictionLabel" | "title"
>;

type CountryFeature = {
  geometry?: {
    coordinates?: unknown;
    type?: string;
  };
  id?: number | string;
  properties?: {
    name?: string;
  };
  type?: string;
};

type CountryOutlineModel = {
  centroidX: number;
  centroidY: number;
  pathData: string;
};

const atlasCountryNameByJurisdiction: Record<string, string> = {
  bulgaria: "Bulgaria",
  canada: "Canada",
  france: "France",
  germany: "Germany",
  italy: "Italy",
  new_zealand: "New Zealand",
  norway: "Norway",
  spain: "Spain",
  slovenia: "Slovenia",
  switzerland: "Switzerland",
  "united-kingdom": "United Kingdom",
  united_kingdom: "United Kingdom",
};

const polygonCountByJurisdiction: Record<string, number> = {
  canada: 2,
  france: 1,
  italy: 3,
  new_zealand: 2,
  "united-kingdom": 2,
  united_kingdom: 2,
};

const countryFeatureCollection = feature(
  countriesAtlas as never,
  (countriesAtlas as { objects: { countries: unknown } }).objects.countries as never,
) as unknown as {
  features: CountryFeature[];
};

const countryFeatureByName = new Map(
  countryFeatureCollection.features.map((countryFeature) => [
    String(countryFeature.properties?.name ?? ""),
    countryFeature,
  ]),
);

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const clampLabel = (value: string | null, maxLength: number) => {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
};

const normalizeKey = (value: string | null | undefined) => value?.trim().toLowerCase() ?? null;

const selectPrimaryGeometry = (countryFeature: CountryFeature, polygonCount: number) => {
  if (countryFeature.geometry?.type !== "MultiPolygon" || !Array.isArray(countryFeature.geometry.coordinates)) {
    return countryFeature;
  }

  const polygons = (countryFeature.geometry.coordinates as unknown[])
    .map((polygonCoordinates) => ({
      area: geoArea({
        coordinates: polygonCoordinates as never,
        type: "Polygon",
      } as never),
      coordinates: polygonCoordinates,
    }))
    .sort((left, right) => right.area - left.area)
    .slice(0, polygonCount);

  if (polygons.length === 0) {
    return countryFeature;
  }

  if (polygons.length === 1) {
    return {
      ...countryFeature,
      geometry: {
        coordinates: polygons[0].coordinates,
        type: "Polygon",
      },
    };
  }

  return {
    ...countryFeature,
    geometry: {
      coordinates: polygons.map((polygon) => polygon.coordinates),
      type: "MultiPolygon",
    },
  };
};

const buildCountryOutlineModel = (jurisdictionKey: string): CountryOutlineModel | null => {
  const atlasName = atlasCountryNameByJurisdiction[jurisdictionKey];
  if (!atlasName) {
    return null;
  }

  const sourceFeature = countryFeatureByName.get(atlasName);
  if (!sourceFeature) {
    return null;
  }

  const countryFeature = selectPrimaryGeometry(
    sourceFeature,
    polygonCountByJurisdiction[jurisdictionKey] ?? 1,
  );
  const projection = geoMercator();
  projection.fitExtent(
    [
      [140, 110],
      [550, 470],
    ],
    countryFeature as never,
  );

  const pathBuilder = geoPath(projection);
  const pathData = pathBuilder(countryFeature as never);
  if (!pathData) {
    return null;
  }

  const centroid = pathBuilder.centroid(countryFeature as never);
  const [centroidX, centroidY] = centroid.every((value) => Number.isFinite(value))
    ? centroid
    : [345, 290];

  return {
    centroidX,
    centroidY,
    pathData,
  };
};

const countryOutlineModelByJurisdiction = new Map(
  Object.keys(atlasCountryNameByJurisdiction).map((jurisdictionKey) => [
    jurisdictionKey,
    buildCountryOutlineModel(jurisdictionKey),
  ]),
);

const resolveOutline = (opportunity: OpportunityPlaceholderInput | null | undefined) => {
  const jurisdictionKey = normalizeKey(opportunity?.jurisdictionKey);
  if (!jurisdictionKey) {
    return null;
  }

  return countryOutlineModelByJurisdiction.get(jurisdictionKey) ?? null;
};

export const buildOpportunityLocatorPlaceholderSvg = (
  opportunity?: OpportunityPlaceholderInput | null,
) => {
  const outline = resolveOutline(opportunity);
  const jurisdictionKey = normalizeKey(opportunity?.jurisdictionKey) ?? "unknown";
  const jurisdictionCode = getOpportunityJurisdictionCode({
    jurisdictionKey: opportunity?.jurisdictionKey ?? null,
    jurisdictionLabel: opportunity?.jurisdictionLabel ?? null,
  });
  const countryLabel = clampLabel(opportunity?.jurisdictionLabel ?? null, 20);
  const cityLabel = clampLabel(opportunity ? pickOpportunityExplicitCity(opportunity) : null, 24);
  const markerLabelY = cityLabel ? 610 : 628;
  const labelConnectorY = markerLabelY - 28;
  const anchorX = outline?.centroidX ?? 470;
  const anchorY = outline?.centroidY ?? 300;
  const gridCellOpacity = outline ? "0.038" : "0.09";
  const gridFrameOpacity = outline ? "0.1" : "0.18";
  const guideOpacity = outline ? "0.06" : "0.12";
  const horizonOpacity = outline ? "0.035" : "0.08";

  const cityText = cityLabel
    ? `<text x="82" y="${markerLabelY}" fill="#f1efe3" font-family="'Arial Narrow', Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="0.04em">${escapeXml(
        cityLabel.toUpperCase(),
      )}</text>`
    : "";
  const countryText = countryLabel
    ? `<text x="82" y="648" fill="#d1d0c4" fill-opacity="0.82" font-family="Arial, sans-serif" font-size="18" letter-spacing="0.18em">${escapeXml(
        countryLabel.toUpperCase(),
      )}</text>`
    : "";
  const outlineMarkup = outline
    ? `
  <path d="${outline.pathData}" fill="#13120f" fill-opacity="0.3" stroke="#13120f" stroke-opacity="0.46" stroke-width="12" stroke-linejoin="round" stroke-linecap="round" />
  <path id="country-outline" data-country-key="${escapeXml(jurisdictionKey)}" data-outline-source="world-atlas" d="${outline.pathData}" fill="#2c4036" fill-opacity="0.66" stroke="#8fb4a0" stroke-opacity="0.94" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round" />
`
    : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" role="img" aria-label="Opportunity location placeholder">
  <defs>
    <pattern id="locator-grid" width="72" height="72" patternUnits="userSpaceOnUse">
      <path d="M 72 0 L 0 0 0 72" fill="none" stroke="#d1d0c4" stroke-opacity="${gridCellOpacity}" stroke-width="1" />
    </pattern>
    <linearGradient id="locator-wash" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#2b2923" />
      <stop offset="100%" stop-color="#191813" />
    </linearGradient>
  </defs>

  <rect width="720" height="720" fill="#21201b" />
  <rect x="52" y="52" width="616" height="616" fill="url(#locator-wash)" stroke="#d1d0c4" stroke-opacity="0.68" stroke-width="2" />
  <rect x="82" y="82" width="556" height="484" fill="url(#locator-grid)" stroke="#d1d0c4" stroke-opacity="${gridFrameOpacity}" stroke-width="1" />
  <path d="M82 243H638 M82 404H638 M221 82V566 M499 82V566" fill="none" stroke="#d1d0c4" stroke-opacity="${guideOpacity}" stroke-width="1.4" />
  <path d="M82 120H638 M82 528H638" fill="none" stroke="#d1d0c4" stroke-opacity="${horizonOpacity}" stroke-width="1" />

  ${outlineMarkup}

  <g transform="translate(${anchorX} ${anchorY})">
    <rect x="-54" y="-54" width="108" height="108" fill="none" stroke="#285f47" stroke-opacity="0.34" stroke-width="2" />
    <circle r="44" fill="none" stroke="#285f47" stroke-opacity="0.34" stroke-width="2" />
    <circle r="11" fill="#285f47" />
    <circle r="20" fill="none" stroke="#285f47" stroke-width="4" />
    <path d="M0 -68V-24 M0 24V68 M-68 0H-24 M24 0H68" fill="none" stroke="#285f47" stroke-width="4" stroke-linecap="square" />
  </g>

  <path d="M${anchorX} ${anchorY} C ${anchorX - 28} ${anchorY + 68}, 178 ${labelConnectorY}, 82 ${labelConnectorY}" fill="none" stroke="#285f47" stroke-width="3" />
  <path d="M82 ${labelConnectorY}H266" fill="none" stroke="#285f47" stroke-width="3" />

  <rect x="82" y="82" width="118" height="54" fill="#f1efe3" fill-opacity="0.94" />
  <text x="96" y="120" fill="#21201b" font-family="'Arial Narrow', Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="0.12em">${escapeXml(
    jurisdictionCode,
  )}</text>

  ${cityText}
  ${countryText}
</svg>
`.trim();
};
