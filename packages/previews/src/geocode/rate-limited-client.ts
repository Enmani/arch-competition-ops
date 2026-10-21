// One politely-behaved JSON client per geocoding provider.
//
// - Requests go through a serialized promise queue, so concurrent callers can never overlap and a
//   minimum interval between request starts is enforced (the old timestamp check did nothing under
//   concurrency: 36 cards fired 36 requests at once).
// - 429/503 answers honour `Retry-After`; at most `maxRetries` retries, each bounded by
//   `maxRetryAfterMs` and by the caller's budget. Nothing is retried without bound.
// - The result distinguishes "the provider answered" from "we did not get an answer". Callers must
//   only persist negative cache entries for the former (a rate limit is not "address not found").
import type { RunBudget } from "../net/budget";

export type JsonOutcome =
  | { kind: "ok"; json: unknown }
  | { kind: "failed"; reason: string };

export type RateLimitedClientOptions = {
  fetch: typeof fetch;
  userAgent: string;
  minIntervalMs: number;
  maxBytes?: number;
  maxRetries?: number;
  maxRetryAfterMs?: number;
  timeoutMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onEvent?: (event: string, details: Record<string, unknown>) => void;
};

export type RateLimitedClient = {
  getJson: (url: string, budget: RunBudget) => Promise<JsonOutcome>;
};

/** Runs tasks strictly one after another, in call order, whatever happens to earlier ones. */
export class SerialQueue {
  private tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task, task);
    this.tail = result.catch(() => undefined);
    return result;
  }
}

/** Parses a Retry-After header (delta-seconds or HTTP date) into milliseconds, or null. */
export const parseRetryAfter = (value: string | null, nowMs: number): number | null => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? null : Math.max(0, at - nowMs);
};

const readJsonCapped = async (response: Response, maxBytes: number): Promise<unknown> => {
  const reader = response.body?.getReader();
  if (!reader) {
    return JSON.parse(await response.text());
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      throw new Error("response too large");
    }
    chunks.push(value);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
};

const discardBody = async (response: Response) => {
  try {
    await response.body?.cancel();
  } catch {
    // nothing to release
  }
};

export const createRateLimitedClient = ({
  fetch: fetchImpl,
  maxBytes = 512 * 1024,
  maxRetries = 1,
  maxRetryAfterMs = 30_000,
  minIntervalMs,
  now = Date.now,
  onEvent,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 12_000,
  userAgent,
}: RateLimitedClientOptions): RateLimitedClient => {
  const queue = new SerialQueue();
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  let blockedUntil = 0;
  const failed = (reason: string, url: string): JsonOutcome => {
    onEvent?.("geocoder-request-failed", { reason, host: new URL(url).host });
    return { kind: "failed", reason };
  };

  const attemptLoop = async (url: string, budget: RunBudget): Promise<JsonOutcome> => {
    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
      const waitMs = Math.max(0, lastStartedAt + minIntervalMs - now(), blockedUntil - now());
      if (waitMs > maxRetryAfterMs || waitMs > budget.remainingMs()) {
        return failed("rate-limited", url);
      }
      if (waitMs > 0) {
        await sleep(waitMs);
      }
      if (!budget.spend()) {
        return failed("budget-exhausted", url);
      }

      lastStartedAt = now();
      let response: Response;
      try {
        response = await fetchImpl(url, {
          headers: { accept: "application/json", "user-agent": userAgent },
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        return failed("network", url);
      }

      if (response.status === 429 || response.status === 503) {
        const retryAfterMs =
          parseRetryAfter(response.headers.get("retry-after"), now()) ?? 2000 * (attempt + 1);
        blockedUntil = now() + retryAfterMs;
        await discardBody(response);
        if (attempt < maxRetries && retryAfterMs <= maxRetryAfterMs) {
          continue;
        }
        return failed(`http-${response.status}`, url);
      }

      if (!response.ok) {
        await discardBody(response);
        return failed(`http-${response.status}`, url);
      }

      try {
        return { json: await readJsonCapped(response, maxBytes), kind: "ok" };
      } catch {
        return failed("invalid-body", url);
      }
    }
    return failed("exhausted", url);
  };

  return { getJson: (url, budget) => queue.run(() => attemptLoop(url, budget)) };
};
