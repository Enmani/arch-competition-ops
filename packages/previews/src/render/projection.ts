// Web-Mercator projection and per-precision zoom and ring sizes.
import {
  satelliteTileSize,
  satelliteZoomWithLocality,
  satelliteZoomWithStreetNumber,
  satelliteZoomWithoutStreetNumber,
} from "./constants";
import { hasStreetNumber } from "../address/compare";
import type { AddressCandidate, SatellitePreviewPrecision } from "../types";

export const clampLatitude = (value: number) =>
  Math.min(85.05112878, Math.max(-85.05112878, value));

export const projectToWorldPixels = (latitude: number, longitude: number, zoom: number) => {
  const scale = satelliteTileSize * 2 ** zoom;
  const lat = clampLatitude(latitude) * (Math.PI / 180);
  const x = ((longitude + 180) / 360) * scale;
  const y =
    (0.5 - Math.log((1 + Math.sin(lat)) / (1 - Math.sin(lat))) / (4 * Math.PI)) * scale;

  return { x, y };
};

export const getPrecisionZoom = (
  candidate: AddressCandidate,
  precision: SatellitePreviewPrecision,
) => {
  if (precision === "city") {
    return 13;
  }

  if (precision === "locality") {
    return satelliteZoomWithLocality;
  }

  if (precision === "square") {
    return 16;
  }

  if (precision === "site") {
    return 16;
  }

  if (precision === "street") {
    return 16;
  }

  return hasStreetNumber(candidate.address)
    ? satelliteZoomWithStreetNumber
    : satelliteZoomWithoutStreetNumber;
};

export const getPrecisionCircleRadiusPx = (precision: SatellitePreviewPrecision) => {
  switch (precision) {
    case "city":
      return 118;
    case "locality":
      return 92;
    case "square":
      return 58;
    case "site":
      return 52;
    case "street":
      return 40;
    default:
      return 28;
  }
};
