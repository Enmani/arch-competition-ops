// Everything the geocoding code needs, bundled so it can be built once per run and faked in tests.
import { join } from "node:path";

import type { PreviewConfig } from "../config";
import type { RunBudget } from "../net/budget";
import { GeocodeCache } from "./cache";
import { createRateLimitedClient, type RateLimitedClient } from "./rate-limited-client";

export type GeocodingServices = {
  amap: RateLimitedClient;
  baidu: RateLimitedClient;
  cache: GeocodeCache;
  config: PreviewConfig;
  log: (event: string, details?: Record<string, unknown>) => void;
  nominatim: RateLimitedClient;
  photon: RateLimitedClient;
};

export type GeocodingContext = {
  budget: RunBudget;
  services: GeocodingServices;
};

export type CreateGeocodingServicesOptions = {
  cacheDirectory: string;
  config: PreviewConfig;
  fetch?: typeof fetch;
  log?: GeocodingServices["log"];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

// Public Nominatim allows at most one request per second; Photon asks for similar restraint.
// The Chinese providers are keyed APIs with their own QPS limits, so they get a smaller gap.
const NOMINATIM_MIN_INTERVAL_MS = 1100;
const PHOTON_MIN_INTERVAL_MS = 700;
const KEYED_PROVIDER_MIN_INTERVAL_MS = 250;

export const createGeocodingServices = ({
  cacheDirectory,
  config,
  fetch: fetchImpl = fetch,
  log = () => undefined,
  now,
  sleep,
}: CreateGeocodingServicesOptions): GeocodingServices => {
  const client = (minIntervalMs: number) =>
    createRateLimitedClient({
      fetch: fetchImpl,
      minIntervalMs,
      now,
      onEvent: log,
      sleep,
      userAgent: config.userAgent,
    });
  return {
    amap: client(KEYED_PROVIDER_MIN_INTERVAL_MS),
    baidu: client(KEYED_PROVIDER_MIN_INTERVAL_MS),
    cache: new GeocodeCache({ filePath: join(cacheDirectory, "geocode-cache.json"), now }),
    config,
    log,
    nominatim: client(NOMINATIM_MIN_INTERVAL_MS),
    photon: client(PHOTON_MIN_INTERVAL_MS),
  };
};
