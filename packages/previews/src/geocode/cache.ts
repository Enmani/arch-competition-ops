// Persistent geocode cache with TTLs, in-flight de-duplication and debounced atomic writes.
//
// Only definitive provider answers are stored: a coordinate, or an empty/rejected result (negative
// entry, expires). Transport failures, 429 and 5xx never reach this class (see cachedLookup), so a
// rate limit can no longer turn an address into a permanent "not found" (audit P6).
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SatellitePreviewPrecision } from "../types";
import { normalizeComparisonText } from "../text/normalize";

/** Bump when the acceptance rules change in a way that makes stored answers wrong. */
export const GEOCODE_CACHE_VERSION = "1";

const DAY_MS = 86_400_000;

export type CachedPlace = {
  lat: number;
  lng: number;
  precision?: SatellitePreviewPrecision;
};

type StoredEntry = { at: number; place: CachedPlace | null };

export type CacheLookup = { hit: true; place: CachedPlace | null } | { hit: false };

export type GeocodeCacheOptions = {
  filePath: string;
  flushDelayMs?: number;
  negativeTtlMs?: number;
  positiveTtlMs?: number;
  now?: () => number;
};

export const buildProviderGeocodeCacheKey = (provider: string, query: string) =>
  `${provider}:${normalizeComparisonText(query).replace(/[^\p{L}\p{N}]+/gu, " ").trim()}`;

export class GeocodeCache {
  private readonly entries = new Map<string, StoredEntry>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly now: () => number;
  private readonly flushDelayMs: number;
  private readonly negativeTtlMs: number;
  private readonly positiveTtlMs: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;
  private writing: Promise<void> = Promise.resolve();
  private writeCounter = 0;
  private loaded = false;

  constructor(private readonly options: GeocodeCacheOptions) {
    this.now = options.now ?? Date.now;
    this.flushDelayMs = options.flushDelayMs ?? 500;
    this.negativeTtlMs = options.negativeTtlMs ?? 14 * DAY_MS;
    this.positiveTtlMs = options.positiveTtlMs ?? 365 * DAY_MS;
  }

  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    try {
      const payload = JSON.parse(await readFile(this.options.filePath, "utf8")) as {
        entries?: Record<string, StoredEntry>;
        version?: string;
      };
      if (payload.version !== GEOCODE_CACHE_VERSION || !payload.entries) {
        return;
      }
      for (const [key, entry] of Object.entries(payload.entries)) {
        if (typeof entry?.at === "number") {
          this.entries.set(key, entry);
        }
      }
    } catch {
      // A missing or unreadable cache is just a cold start.
    }
  }

  lookup(key: string): CacheLookup {
    const entry = this.entries.get(key);
    if (!entry) {
      return { hit: false };
    }
    const ttl = entry.place ? this.positiveTtlMs : this.negativeTtlMs;
    if (this.now() - entry.at > ttl) {
      this.entries.delete(key);
      return { hit: false };
    }
    return { hit: true, place: entry.place };
  }

  storeHit(key: string, place: CachedPlace): void {
    this.entries.set(key, { at: this.now(), place });
    this.scheduleFlush();
  }

  /** Only for a definitive "the provider has nothing acceptable for this query". */
  storeEmpty(key: string): void {
    this.entries.set(key, { at: this.now(), place: null });
    this.scheduleFlush();
  }

  /** Runs `loader` once per key at a time; concurrent callers share the same promise. */
  dedupe<T>(key: string, loader: () => Promise<T>): Promise<T> {
    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) {
      return running;
    }
    const promise = loader().finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }

  /** Writes any pending changes now and waits for the write to finish. */
  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.dirty) {
      this.writing = this.writing.then(() => this.write());
    }
    await this.writing;
  }

  private scheduleFlush(): void {
    this.dirty = true;
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      this.writing = this.writing.then(() => this.write());
    }, this.flushDelayMs);
    this.timer.unref?.();
  }

  private async write(): Promise<void> {
    if (!this.dirty) {
      return;
    }
    this.dirty = false;
    const { filePath } = this.options;
    const temporaryPath = `${filePath}.${process.pid}.${(this.writeCounter += 1)}.tmp`;
    try {
      await mkdir(path.dirname(filePath), { recursive: true });
      const payload = { entries: Object.fromEntries(this.entries), version: GEOCODE_CACHE_VERSION };
      await writeFile(temporaryPath, `${JSON.stringify(payload)}\n`, "utf8");
      await rename(temporaryPath, filePath);
    } catch {
      this.dirty = true; // keep the data; the next flush retries
      await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }
}
