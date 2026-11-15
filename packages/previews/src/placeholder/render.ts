// The locator placeholder: a neutral SVG that shows the country outline and, when the record's
// coordinates are known, a marker on it. It is what the image route answers whenever no prebuilt
// image exists, so it must be cheap and runtime-agnostic (Workers): no d3, no topojson, no atlas.
// Outlines are precomputed by scripts/build-country-outlines.mjs into data/country-outlines.json,
// fitted to the panel with a 40px inset.
//
// The card's drawing keeps its paper square so the card stands apart from the page. The small
// inset map has no backing at all: it sits over a photograph, so it is drawn in fixed light
// strokes with a soft shadow instead of the theme palette.
//
// Colours live in a <style> block, with a dark palette under prefers-color-scheme. An SVG shown
// through <img> follows the embedding page's `color-scheme` (the site sets it from its theme
// button), so the placeholder darkens with the page and needs no second URL. The dark paper is a
// step lighter than the dark page (#11110d) so the square still reads as a card.
//
// The drawing is edge to edge and carries no labels: the country and city are already set in type
// under the image, so a caption inside the picture would only repeat them and shrink the map.
import countryOutlines from "../../data/country-outlines.json";
import { resolveOpportunityCountry } from "../countries";
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

const PLACEHOLDER_STYLE = `
    .paper { fill: #f4f2ea; }
    .ink { stroke: #21201b; }
    .ink-fill { fill: #21201b; }
    .mark { stroke: #285f47; }
    .mark-fill { fill: #285f47; }
    @media (prefers-color-scheme: dark) {
      .paper { fill: #24231e; }
      .ink { stroke: #dfded6; }
      .ink-fill { fill: #dfded6; }
      .mark { stroke: #8ac998; }
      .mark-fill { fill: #8ac998; }
    }`;

const normalizeKey = normalizeJurisdictionKey;

/** The country a record is about: its jurisdiction when that is a country, else what its text names. */
const resolveCountryKey = (opportunity: OpportunityPlaceholderInput | null | undefined) =>
  opportunity ? resolveOpportunityCountry(opportunity) : null;

const resolveOutline = (opportunity: OpportunityPlaceholderInput | null | undefined) => {
  const jurisdictionKey = resolveCountryKey(opportunity);
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

const resolveLocator = (
  opportunity: OpportunityPlaceholderInput | null | undefined,
  override: OpportunityPlaceholderOverride | null | undefined,
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
  return {
    anchor: resolveLocationAnchor(outline, placeholderOpportunity),
    jurisdictionKey:
      resolveCountryKey(placeholderOpportunity) ?? normalizeKey(placeholderOpportunity?.jurisdictionKey) ?? "unknown",
    locationText: placeholderOpportunity?.locationLabel ?? null,
    outline,
  };
};

/**
 * The small inset map shown in a corner of a card while its satellite image is up: the country
 * outline and one dot where the project is. Only drawn when the position is really known (a
 * coordinate inside the outline); a country centroid would claim a place the notice never gave,
 * so then there is no inset (null) and the card simply shows no corner map.
 */
export const buildOpportunityLocatorInsetSvg = (
  opportunity?: OpportunityPlaceholderInput | null,
  override?: OpportunityPlaceholderOverride | null,
) => {
  const { anchor, outline } = resolveLocator(opportunity, override);
  if (!outline || !anchor.isProjected) {
    return null;
  }
  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="52 52 ${PANEL_SIZE} ${PANEL_SIZE}" role="img" aria-label="Project location">
  <defs>
    <filter id="inset-shadow" x="-10%" y="-10%" width="120%" height="120%">
      <feDropShadow dx="0" dy="0" stdDeviation="7" flood-color="#09110d" flood-opacity="0.6" />
    </filter>
  </defs>
  <g filter="url(#inset-shadow)">
    <path d="${outline.pathData}" fill="#f3f1e6" fill-opacity="0.18" stroke="#f3f1e6" stroke-opacity="0.95" stroke-width="5" stroke-linejoin="round" stroke-linecap="round" />
    <circle cx="${anchor.x}" cy="${anchor.y}" r="22" fill="#8ac998" stroke="#0e1813" stroke-opacity="0.55" stroke-width="5" />
  </g>
</svg>
`.trim();
};

const LABEL_LINE_CHARS = 14;
const LABEL_MAX_LINES = 3;
const LABEL_LINE_HEIGHT = 56;

/** Breaks a place name into at most three centred lines; Han text breaks anywhere, the rest at spaces. */
const wrapLabel = (text: string) => {
  const clean = text.replace(/\s+/g, " ").trim();
  const lines: string[] = [];
  if (/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(clean)) {
    const size = Math.ceil(LABEL_LINE_CHARS * 0.7);
    for (let index = 0; index < clean.length; index += size) {
      lines.push(clean.slice(index, index + size));
    }
  } else {
    let line = "";
    for (const word of clean.split(" ")) {
      if (line && `${line} ${word}`.length > LABEL_LINE_CHARS) {
        lines.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) {
      lines.push(line);
    }
  }
  const shown = lines.slice(0, LABEL_MAX_LINES);
  if (lines.length > LABEL_MAX_LINES) {
    shown[LABEL_MAX_LINES - 1] = `${shown[LABEL_MAX_LINES - 1].slice(0, -1)}…`;
  }
  return shown;
};

export const buildOpportunityLocatorPlaceholderSvg = (
  opportunity?: OpportunityPlaceholderInput | null,
  override?: OpportunityPlaceholderOverride | null,
) => {
  const { anchor, jurisdictionKey, locationText, outline } = resolveLocator(opportunity, override);
  const anchorX = anchor.x;
  const anchorY = anchor.y;
  // Without an outline the grid has to carry the texture on its own.
  const gridCellOpacity = outline ? "0.05" : "0.1";
  const guideOpacity = outline ? "0.08" : "0.14";
  const outlineMarkup = outline
    ? `
  <path id="country-outline" data-country-key="${escapeXml(jurisdictionKey)}" data-outline-source="world-atlas" d="${outline.pathData}" class="ink-fill ink" fill-opacity="0.07" stroke-opacity="0.78" stroke-width="2.4" stroke-linejoin="round" stroke-linecap="round" />
`
    : "";

  // With an outline the marker shows where the record is. Without one there is no country to put it
  // on, and a crosshair in the middle of an empty grid would claim a place nobody stated, so the
  // card shows the place name instead (nothing at all when the record names none).
  const markerMarkup = `<g transform="translate(${anchorX} ${anchorY})" data-marker-source="${anchor.isProjected ? "geo-coordinates" : "country-centroid"}">
    <rect x="-54" y="-54" width="108" height="108" class="mark" fill="none" stroke-opacity="0.34" stroke-width="2" />
    <circle r="44" class="mark" fill="none" stroke-opacity="0.34" stroke-width="2" />
    <circle r="11" class="mark-fill" />
    <circle r="20" class="mark" fill="none" stroke-width="4" />
    <path d="M0 -68V-24 M0 24V68 M-68 0H-24 M24 0H68" class="mark" fill="none" stroke-width="4" stroke-linecap="square" />
  </g>`;
  const labelLines = locationText ? wrapLabel(locationText) : [];
  const firstLineY = 360 - ((labelLines.length - 1) * LABEL_LINE_HEIGHT) / 2;
  const labelMarkup = labelLines.length
    ? `<g data-label-source="location" font-family="system-ui, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif" font-size="40" font-weight="600" text-anchor="middle" class="ink-fill" fill-opacity="0.8">
    ${labelLines.map((line, index) => `<text x="360" y="${firstLineY + index * LABEL_LINE_HEIGHT}">${escapeXml(line)}</text>`).join("")}
  </g>`
    : "";

  return `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="52 52 ${PANEL_SIZE} ${PANEL_SIZE}" role="img" aria-label="Opportunity location placeholder">
  <defs>
    <style>${PLACEHOLDER_STYLE}
    </style>
    <pattern id="locator-grid" x="${PANEL_START}" y="${PANEL_START}" width="72" height="72" patternUnits="userSpaceOnUse">
      <path d="M 72 0 L 0 0 0 72" class="ink" fill="none" stroke-opacity="${gridCellOpacity}" stroke-width="1" />
    </pattern>
  </defs>

  <rect x="${PANEL_START}" y="${PANEL_START}" width="${PANEL_SIZE}" height="${PANEL_SIZE}" class="paper" />
  <rect x="${PANEL_START}" y="${PANEL_START}" width="${PANEL_SIZE}" height="${PANEL_SIZE}" fill="url(#locator-grid)" />
  <path d="M${PANEL_START} 243H${PANEL_END} M${PANEL_START} 404H${PANEL_END} M221 ${PANEL_START}V${PANEL_END} M499 ${PANEL_START}V${PANEL_END}" class="ink" fill="none" stroke-opacity="${guideOpacity}" stroke-width="1.2" />

  ${outlineMarkup}

  ${outline ? markerMarkup : labelMarkup}
</svg>
`.trim();
};