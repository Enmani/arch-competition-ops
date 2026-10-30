// The locator placeholder: a neutral SVG that shows the country outline and, when the record's
// coordinates are known, a marker on it. It is what the image route answers whenever no prebuilt
// image exists, so it must be cheap and runtime-agnostic (Workers): no d3, no topojson, no atlas.
// Outlines are precomputed by scripts/build-country-outlines.mjs into data/country-outlines.json.
import countryOutlines from "../../data/country-outlines.json";
import { getOpportunityJurisdictionCode, pickOpportunityDisplayLocality } from "../location";
import { normalizeJurisdictionKey } from "../text/normalize";
import type { PreviewOpportunity } from "../types";

export type OpportunityPlaceholderInput = Pick<
  PreviewOpportunity,
  "authorityName" | "jurisdictionKey" | "jurisdictionLabel" | "locationLabel" | "title"
> & { geoLat?: number | null; geoLng?: number | null };

export type OpportunityPlaceholderOverride = {
  geoLat?: number | null;
  geoLng?: number | null;
  locationLabel?: string | null;
};

type CountryOutline = {
  centroid: number[] | null;
  name: string;
  path: string;
  scale: number;
  translate: number[];
};

type CountryOutlineModel = {
  centroidX: number;
  centroidY: number;
  pathData: string;
  project: (longitude: number, latitude: number) => [number, number] | null;
};

const outlinesByKey = countryOutlines.countries as Record<string, CountryOutline>;

/** Spherical Mercator exactly as d3.geoMercator() with the stored scale and translate. */
const buildOutlineModel = (outline: CountryOutline): CountryOutlineModel => {
  const [translateX, translateY] = outline.translate;
  const [centroidX, centroidY] = outline.centroid ?? [345, 290];
  return {
    centroidX,
    centroidY,
    pathData: outline.path,
    project: (longitude, latitude) => {
      const phi = (latitude * Math.PI) / 180;
      const x = translateX + outline.scale * ((longitude * Math.PI) / 180);
      const y = translateY - outline.scale * Math.log(Math.tan(Math.PI / 4 + phi / 2));
      return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
    },
  };
};

const outlineModelByKey = new Map<string, CountryOutlineModel>();

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

const normalizeKey = normalizeJurisdictionKey;

const resolveOutline = (opportunity: OpportunityPlaceholderInput | null | undefined) => {
  const jurisdictionKey = normalizeKey(opportunity?.jurisdictionKey);
  const outline = jurisdictionKey ? outlinesByKey[jurisdictionKey] : undefined;
  if (!jurisdictionKey || !outline) {
    return null;
  }
  let model = outlineModelByKey.get(jurisdictionKey);
  if (!model) {
    model = buildOutlineModel(outline);
    outlineModelByKey.set(jurisdictionKey, model);
  }
  return model;
};

const isProjectedPointInLocatorBounds = ([x, y]: [number, number]) =>
  x >= 82 && x <= 638 && y >= 82 && y <= 566;

const resolveLocationAnchor = (
  outline: CountryOutlineModel | null,
  opportunity: OpportunityPlaceholderInput | null | undefined,
) => {
  const fallback = {
    isProjected: false,
    x: outline?.centroidX ?? 470,
    y: outline?.centroidY ?? 300,
  };

  if (
    !outline ||
    opportunity?.geoLat === null ||
    opportunity?.geoLat === undefined ||
    opportunity?.geoLng === null ||
    opportunity?.geoLng === undefined
  ) {
    return fallback;
  }

  const projected = outline.project(opportunity.geoLng, opportunity.geoLat);
  if (!projected || !isProjectedPointInLocatorBounds(projected)) {
    return fallback;
  }

  return {
    isProjected: true,
    x: projected[0],
    y: projected[1],
  };
};

export const buildOpportunityLocatorPlaceholderSvg = (
  opportunity?: OpportunityPlaceholderInput | null,
  override?: OpportunityPlaceholderOverride | null,
) => {
  const placeholderOpportunity =
    opportunity && override
      ? {
          ...opportunity,
          geoLat: override.geoLat ?? opportunity.geoLat,
          geoLng: override.geoLng ?? opportunity.geoLng,
          locationLabel: override.locationLabel ?? opportunity.locationLabel,
        }
      : opportunity;
  const outline = resolveOutline(placeholderOpportunity);
  const jurisdictionKey = normalizeKey(placeholderOpportunity?.jurisdictionKey) ?? "unknown";
  const jurisdictionCode = getOpportunityJurisdictionCode({
    jurisdictionKey: placeholderOpportunity?.jurisdictionKey ?? null,
    jurisdictionLabel: placeholderOpportunity?.jurisdictionLabel ?? null,
  });
  const countryLabel = clampLabel(placeholderOpportunity?.jurisdictionLabel ?? null, 20);
  const cityLabel = clampLabel(
    placeholderOpportunity ? pickOpportunityDisplayLocality(placeholderOpportunity) : null,
    24,
  );
  const markerLabelY = cityLabel ? 610 : 628;
  const anchor = resolveLocationAnchor(outline, placeholderOpportunity);
  const anchorX = anchor.x;
  const anchorY = anchor.y;
  const gridCellOpacity = outline ? "0.05" : "0.1";
  const gridFrameOpacity = outline ? "0.16" : "0.24";
  const guideOpacity = outline ? "0.08" : "0.14";
  const horizonOpacity = outline ? "0.05" : "0.1";

  const cityText = cityLabel
    ? `<text x="82" y="${markerLabelY}" fill="#21201b" font-family="'Arial Narrow', Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="0.04em">${escapeXml(
        cityLabel.toUpperCase(),
      )}</text>`
    : "";
  const countryText = countryLabel
    ? `<text x="82" y="648" fill="#5d5b50" font-family="Arial, sans-serif" font-size="18" letter-spacing="0.18em">${escapeXml(
        countryLabel.toUpperCase(),
      )}</text>`
    : "";
  const outlineMarkup = outline
    ? `
  <path id="country-outline" data-country-key="${escapeXml(jurisdictionKey)}" data-outline-source="world-atlas" d="${outline.pathData}" fill="#21201b" fill-opacity="0.07" stroke="#21201b" stroke-opacity="0.78" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
`
    : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 720" role="img" aria-label="Opportunity location placeholder">
  <defs>
    <pattern id="locator-grid" width="72" height="72" patternUnits="userSpaceOnUse">
      <path d="M 72 0 L 0 0 0 72" fill="none" stroke="#21201b" stroke-opacity="${gridCellOpacity}" stroke-width="1" />
    </pattern>
  </defs>

  <rect width="720" height="720" fill="#ece9de" />
  <rect x="52" y="52" width="616" height="616" fill="#f4f2ea" stroke="#21201b" stroke-opacity="0.4" stroke-width="1.5" />
  <rect x="82" y="82" width="556" height="484" fill="url(#locator-grid)" stroke="#21201b" stroke-opacity="${gridFrameOpacity}" stroke-width="1" />
  <path d="M82 243H638 M82 404H638 M221 82V566 M499 82V566" fill="none" stroke="#21201b" stroke-opacity="${guideOpacity}" stroke-width="1.2" />
  <path d="M82 120H638 M82 528H638" fill="none" stroke="#21201b" stroke-opacity="${horizonOpacity}" stroke-width="1" />

  ${outlineMarkup}

  <g transform="translate(${anchorX} ${anchorY})" data-marker-source="${anchor.isProjected ? "geo-coordinates" : "country-centroid"}">
    <rect x="-54" y="-54" width="108" height="108" fill="none" stroke="#285f47" stroke-opacity="0.34" stroke-width="2" />
    <circle r="44" fill="none" stroke="#285f47" stroke-opacity="0.34" stroke-width="2" />
    <circle r="11" fill="#285f47" />
    <circle r="20" fill="none" stroke="#285f47" stroke-width="4" />
    <path d="M0 -68V-24 M0 24V68 M-68 0H-24 M24 0H68" fill="none" stroke="#285f47" stroke-width="4" stroke-linecap="square" />
  </g>

  <rect x="82" y="82" width="118" height="54" fill="#21201b" />
  <text x="96" y="120" fill="#f4f2ea" font-family="'Arial Narrow', Arial, sans-serif" font-size="34" font-weight="700" letter-spacing="0.12em">${escapeXml(
    jurisdictionCode,
  )}</text>

  ${cityText}
  ${countryText}
</svg>
`.trim();
};
