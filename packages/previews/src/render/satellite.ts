// Compose one satellite preview: the tiles and nothing else. The imagery credit is not drawn into
// the picture; it travels in the manifest and the site prints it next to the image as text.
import sharp from "sharp";

import type { AddressCandidate, SatellitePreviewPrecision } from "../types";
import { satelliteImageSize } from "./constants";
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
    .sharpen()
    .jpeg({ mozjpeg: true, quality: 84 })
    .toBuffer();
};
