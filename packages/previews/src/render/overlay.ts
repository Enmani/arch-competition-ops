// SVG overlay that marks the geocoded precision on the satellite image.
import { satelliteImageSize } from "./constants";
import { getPrecisionCircleRadiusPx } from "./projection";
import type { SatellitePreviewPrecision } from "../types";

export const buildPrecisionCircleOverlay = (precision: SatellitePreviewPrecision) => {
  const radius = getPrecisionCircleRadiusPx(precision);
  const center = satelliteImageSize / 2;
  const haloRadius = radius + 18;
  const label =
    precision === "city"
      ? "CITY"
      : precision === "locality"
        ? "LOCALITY"
        : precision === "square"
          ? "SQUARE"
          : precision === "site"
            ? "SITE"
            : precision === "street"
              ? "STREET"
              : "ADDRESS";

  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${satelliteImageSize}" height="${satelliteImageSize}" viewBox="0 0 ${satelliteImageSize} ${satelliteImageSize}">
      <defs>
        <filter id="ring-shadow" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="0" dy="0" stdDeviation="5" flood-color="#09110d" flood-opacity="0.28" />
        </filter>
      </defs>
      <circle cx="${center}" cy="${center}" r="${haloRadius}" fill="#d9f2de" fill-opacity="0.06" />
      <circle cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="#f3f1e6" stroke-opacity="0.96" stroke-width="3.5" filter="url(#ring-shadow)" />
      <circle cx="${center}" cy="${center}" r="${Math.max(radius - 18, 10)}" fill="none" stroke="#2f7f5a" stroke-opacity="0.82" stroke-width="1.75" stroke-dasharray="10 8" />
      <circle cx="${center}" cy="${center}" r="4.5" fill="#f3f1e6" />
      <rect x="${center - 58}" y="${center + radius + 20}" width="116" height="28" rx="4" fill="#0e1813" fill-opacity="0.72" />
      <text x="${center}" y="${center + radius + 39}" fill="#f3f1e6" font-family="Arial, sans-serif" font-size="11" font-weight="700" letter-spacing="0.18em" text-anchor="middle">${label}</text>
    </svg>`,
  );
};
