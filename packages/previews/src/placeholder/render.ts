// The locator placeholder: a neutral SVG that shows the country outline and, when the record's
// coordinates are known, a marker on it. It is what the image route answers whenever no prebuilt
// image exists, so it must be cheap and runtime-agnostic (Workers): no d3, no topojson, no atlas.
// Outlines are precomputed by scripts/build-country-outlines.mjs into data/country-outlines.json,
// fitted to the whole 616px square.
//
// The drawing is edge to edge and carries no labels: the country and city are already set in type
// under the image, so a caption inside the picture would only repeat them and shrink the map.
import countryOutlines from "../../data/country-outlines.json";
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

// The paper panel itself (x/y 52..668). The map is fitted to this whole square, so the image has
// no outer margin and the card shows the locator edge to edge.
const PANEL_START = 52;
const PANEL_END = 668;
const PANEL_SIZE = PANEL_END - PANEL_START;

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
  x >= PANEL_START && x <= PANEL_END && y >= PANEL_START && y <= PANEL_END;

const resolveLocationAnchor = (
  outline: CountryOutlineModel | null,
  opportunity: OpportunityPlaceholderInput | null | undefined,
) => {
  const fallback = {
    isProjected: false,
    x: outline?.centroidX ?? PANEL_START + PANEL_SIZE / 2,
    y: outline?.centroidY ?? PANEL_START + PANEL_SIZE / 2,
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
  const anchor = resolveLocationAnchor(outline, placeholderOpportunity);
  const anchorX = anchor.x;
  const anchorY = anchor.y;
  // Without an outline the grid has to carry the texture on its own.
  const gridCellOpacity = outline ? "0.05" : "0.1";
  const guideOpacity = outline ? "0.08" : "0.14";
  const outlineMarkup = outline
    ? `
  <path id="country-outline" data-country-key="${escapeXml(jurisdictionKey)}" data-outline-source="world-atlas" d="${outline.pathData}" fill="#21201b" fill-opacity="0.07" stroke="#21201b" stroke-opacity="0.78" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
`
    : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="52 52 ${PANEL_SIZE} ${PANEL_SIZE}" role="img" aria-label="Opportunity location placeholder">
  <defs>
    <pattern id="locator-grid" x="${PANEL_START}" y="${PANEL_START}" width="72" height="72" patternUnits="userSpaceOnUse">
      <path d="M 72 0 L 0 0 0 72" fill="none" stroke="#21201b" stroke-opacity="${gridCellOpacity}" stroke-width="1" />
    </pattern>
  </defs>

  <rect x="${PANEL_START}" y="${PANEL_START}" width="${PANEL_SIZE}" height="${PANEL_SIZE}" fill="#f4f2ea" />
  <rect x="${PANEL_START}" y="${PANEL_START}" width="${PANEL_SIZE}" height="${PANEL_SIZE}" fill="url(#locator-grid)" />
  <path d="M${PANEL_START} 243H${PANEL_END} M${PANEL_START} 404H${PANEL_END} M221 ${PANEL_START}V${PANEL_END} M499 ${PANEL_START}V${PANEL_END}" fill="none" stroke="#21201b" stroke-opacity="${guideOpacity}" stroke-width="1.2" />

  ${outlineMarkup}

  <g transform="translate(${anchorX} ${anchorY})" data-marker-source="${anchor.isProjected ? "geo-coordinates" : "country-centroid"}">
    <rect x="-54" y="-54" width="108" height="108" fill="none" stroke="#285f47" stroke-opacity="0.34" stroke-width="2" />
    <circle r="44" fill="none" stroke="#285f47" stroke-opacity="0.34" stroke-width="2" />
    <circle r="11" fill="#285f47" />
    <circle r="20" fill="none" stroke="#285f47" stroke-width="4" />
    <path d="M0 -68V-24 M0 24V68 M-68 0H-24 M24 0H68" fill="none" stroke="#285f47" stroke-width="4" stroke-linecap="square" />
  </g>
</svg>
`.trim();
};