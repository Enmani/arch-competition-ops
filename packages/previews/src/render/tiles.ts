// Fetch the map tiles that cover one preview image.
import type { PreviewConfig } from "../config";
import type { RunBudget } from "../net/budget";
import { satelliteImageSize, satelliteTileSize } from "./constants";
import { projectToWorldPixels } from "./projection";

export type TileContext = {
  budget: RunBudget;
  config: PreviewConfig;
  fetch: typeof fetch;
  log: (event: string, details?: Record<string, unknown>) => void;
};

export type TilePlacement = { left: number; top: number; tileX: number; tileY: number; wrappedTileX: number };

const TILE_TIMEOUT_MS = 8000;
const TILE_MAX_BYTES = 1024 * 1024;
const TILE_CONCURRENCY = 4;

export const buildSatelliteTileUrl = (
  template: string,
  zoom: number,
  tileY: number,
  tileX: number,
) =>
  template
    .replace("{z}", String(zoom))
    .replace("{y}", String(tileY))
    .replace("{x}", String(tileX));

/** The tile grid that covers a `satelliteImageSize` square centred on the coordinate. */
export const planTiles = (latitude: number, longitude: number, zoom: number): TilePlacement[] => {
  const center = projectToWorldPixels(latitude, longitude, zoom);
  const half = satelliteImageSize / 2;
  const minX = center.x - half;
  const minY = center.y - half;
  const perAxis = 2 ** zoom;
  const placements: TilePlacement[] = [];

  for (let tileX = Math.floor(minX / satelliteTileSize); tileX <= Math.floor((center.x + half) / satelliteTileSize); tileX += 1) {
    for (let tileY = Math.floor(minY / satelliteTileSize); tileY <= Math.floor((center.y + half) / satelliteTileSize); tileY += 1) {
      if (tileY < 0 || tileY >= perAxis) {
        continue;
      }
      placements.push({
        left: Math.round(tileX * satelliteTileSize - minX),
        tileX,
        tileY,
        top: Math.round(tileY * satelliteTileSize - minY),
        wrappedTileX: ((tileX % perAxis) + perAxis) % perAxis,
      });
    }
  }
  return placements;
};

const fetchTile = async (context: TileContext, zoom: number, placement: TilePlacement) => {
  if (!context.budget.spend()) {
    return null;
  }
  const url = buildSatelliteTileUrl(
    context.config.tileUrlTemplate,
    zoom,
    placement.tileY,
    placement.wrappedTileX,
  );
  try {
    const response = await context.fetch(url, {
      headers: {
        accept: "image/avif,image/webp,image/apng,image/*;q=0.8",
        "user-agent": context.config.userAgent,
      },
      signal: AbortSignal.timeout(TILE_TIMEOUT_MS),
    });
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!response.ok || !contentType.startsWith("image/")) {
      context.log("tile-miss", { status: response.status, zoom });
      return null;
    }
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > TILE_MAX_BYTES) {
      return null;
    }
    const payload = Buffer.from(await response.arrayBuffer());
    return payload.length > 0 && payload.length <= TILE_MAX_BYTES ? payload : null;
  } catch {
    context.log("tile-error", { zoom });
    return null;
  }
};

/** Fetches the planned tiles with bounded concurrency; failed tiles are simply absent. */
export const fetchTiles = async (
  context: TileContext,
  zoom: number,
  placements: TilePlacement[],
): Promise<Array<{ input: Buffer; left: number; top: number }>> => {
  const results: Array<{ input: Buffer; left: number; top: number } | null> = new Array(
    placements.length,
  ).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < placements.length) {
      const index = next;
      next += 1;
      const placement = placements[index];
      const input = await fetchTile(context, zoom, placement);
      if (input) {
        results[index] = { input, left: placement.left, top: placement.top };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(TILE_CONCURRENCY, placements.length) }, worker));
  return results.flatMap((entry) => (entry ? [entry] : []));
};
