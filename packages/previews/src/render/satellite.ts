// Compose one satellite preview: tiles, precision ring and the imagery credit line.
import sharp from "sharp";

import type { AddressCandidate, SatellitePreviewPrecision } from "../types";
import { satelliteImageSize } from "./constants";
import { buildAttributionOverlay } from "./attribution";
import { buildPrecisionCircleOverlay } from "./overlay";
import { getPrecisionZoom } from "./projection";
import { fetchTiles, planTiles, type TileContext } from "./tiles";

/** Fewer tiles than this leaves visible holes in the image, so it is not worth keeping. */
const MIN_TILES = 6;

export const renderSatellitePreview = async (
  context: TileContext,
  latitude: number,
  longitude: number,
  candidate: AddressCandidate,
  precision: SatellitePreviewPrecision,
): Promise<Buffer | null> => {
  const zoom = getPrecisionZoom(candidate, precision);
  const composites = await fetchTiles(context, zoom, planTiles(latitude, longitude, zoom));
  if (composites.length < MIN_TILES) {
    context.log("render-insufficient-tiles", { tiles: composites.length, zoom });
    return null;
  }

  const base = await sharp({
    create: { background: "#dad5ca", channels: 3, height: satelliteImageSize, width: satelliteImageSize },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return sharp(base)
    .modulate({ brightness: 1.02, saturation: 1.04 })
    .composite([
      { input: buildPrecisionCircleOverlay(precision), left: 0, top: 0 },
      { input: buildAttributionOverlay(context.config.tileAttribution), left: 0, top: 0 },
    ])
    .sharpen()
    .jpeg({ mozjpeg: true, quality: 84 })
    .toBuffer();
};
