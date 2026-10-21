// Run-wide services and the per-record context built from them.
import type { PreviewConfig } from "../config";
import { createGeocodingServices, type GeocodingServices } from "../geocode/services";
import { createBudget, type BudgetLimits, type RunBudget } from "../net/budget";
import { createSafeFetcher, type SafeFetcher } from "../net/safe-fetch";

export type PipelineServices = {
  config: PreviewConfig;
  /** SSRF-guarded fetcher for third-party documents. */
  documentFetcher: SafeFetcher;
  /** Plain fetch, used only for the fixed tile and geocoder endpoints. */
  fetch: typeof fetch;
  geocoding: GeocodingServices;
  log: (event: string, details?: Record<string, unknown>) => void;
};

export type RecordContext = PipelineServices & { budget: RunBudget };

/** What one record may spend: bounded wall time and a bounded number of outgoing requests. */
export const DEFAULT_RECORD_LIMITS: BudgetLimits = { maxRequests: 100, totalMs: 120_000 };

export const createPipelineServices = (options: {
  cacheDirectory: string;
  config: PreviewConfig;
  fetch?: typeof fetch;
  log?: PipelineServices["log"];
  /** Test seams for the geocoder rate limiter; production uses the real clock. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}): PipelineServices => {
  const log = options.log ?? (() => undefined);
  const fetchImpl = options.fetch ?? fetch;
  return {
    config: options.config,
    documentFetcher: createSafeFetcher({ onEvent: log, userAgent: options.config.userAgent }),
    fetch: fetchImpl,
    geocoding: createGeocodingServices({
      cacheDirectory: options.cacheDirectory,
      config: options.config,
      fetch: fetchImpl,
      log,
      now: options.now,
      sleep: options.sleep,
    }),
    log,
  };
};

export const createRecordContext = (
  services: PipelineServices,
  limits: BudgetLimits = DEFAULT_RECORD_LIMITS,
): RecordContext => ({ ...services, budget: createBudget(limits) });
