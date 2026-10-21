// The one place that decides what may be cached after a provider call.
import type { GeocodeResult, SatellitePreviewPrecision } from "../types";
import type { GeocodeCache } from "./cache";

export type LookupOutcome =
  | { status: "hit"; result: GeocodeResult }
  /** The provider answered and has nothing acceptable. Cached as a negative entry with a TTL. */
  | { status: "empty" }
  /** Timeout, network error, non-2xx, 429, budget refusal. Never cached. */
  | { status: "failed" };

export const cachedLookup = (
  cache: GeocodeCache,
  key: string,
  fallbackPrecision: SatellitePreviewPrecision,
  load: () => Promise<LookupOutcome>,
): Promise<GeocodeResult | null> => {
  const cached = cache.lookup(key);
  if (cached.hit) {
    return Promise.resolve(
      cached.place
        ? {
            lat: cached.place.lat,
            lng: cached.place.lng,
            precision: cached.place.precision ?? fallbackPrecision,
          }
        : null,
    );
  }

  return cache.dedupe(key, async () => {
    const outcome = await load();
    if (outcome.status === "hit") {
      cache.storeHit(key, outcome.result);
      return outcome.result;
    }
    if (outcome.status === "empty") {
      cache.storeEmpty(key);
    }
    return null;
  });
};
