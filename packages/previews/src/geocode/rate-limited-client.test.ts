import assert from "node:assert/strict";
import test from "node:test";

import { createBudget } from "../net/budget";
import { unlimitedBudget } from "../testing";
import { createRateLimitedClient, parseRetryAfter, SerialQueue } from "./rate-limited-client";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, ...init });

/** A virtual clock: sleeping advances time instantly, so tests are fast and deterministic. */
const createClock = () => {
  let current = 1_000_000;
  const sleeps: number[] = [];
  return {
    now: () => current,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      current += ms;
    },
    sleeps,
  };
};

test("parseRetryAfter understands seconds and HTTP dates and rejects junk", () => {
  assert.equal(parseRetryAfter("7", 0), 7000);
  assert.equal(parseRetryAfter(" 0 ", 0), 0);
  assert.equal(parseRetryAfter(new Date(5000).toUTCString(), 2000), 3000);
  assert.equal(parseRetryAfter(new Date(1000).toUTCString(), 9000), 0);
  assert.equal(parseRetryAfter("soon", 0), null);
  assert.equal(parseRetryAfter(null, 0), null);
});

test("SerialQueue never overlaps tasks and keeps going after a failure", async () => {
  const queue = new SerialQueue();
  const log: string[] = [];
  const task = (name: string, ms: number, fail = false) =>
    queue.run(async () => {
      log.push(`start ${name}`);
      await new Promise((resolve) => setTimeout(resolve, ms));
      log.push(`end ${name}`);
      if (fail) {
        throw new Error(name);
      }
      return name;
    });

  const results = await Promise.allSettled([task("a", 20), task("b", 1, true), task("c", 1)]);

  assert.deepEqual(log, ["start a", "end a", "start b", "end b", "start c", "end c"]);
  assert.deepEqual(
    results.map((result) => result.status),
    ["fulfilled", "rejected", "fulfilled"],
  );
});

test("concurrent callers are spaced by the minimum interval", async () => {
  const clock = createClock();
  const starts: number[] = [];
  const client = createRateLimitedClient({
    fetch: (async () => {
      starts.push(clock.now());
      return jsonResponse([]);
    }) as typeof fetch,
    minIntervalMs: 1100,
    now: clock.now,
    sleep: clock.sleep,
    userAgent: "test/1",
  });

  await Promise.all([1, 2, 3].map((n) => client.getJson(`https://geo.test/?q=${n}`, unlimitedBudget())));

  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 1100);
  assert.ok(starts[2] - starts[1] >= 1100);
});

test("sends the configured honest User-Agent and does not follow redirects", async () => {
  const seen: Array<{ headers: HeadersInit | undefined; redirect: RequestRedirect | undefined }> = [];
  const client = createRateLimitedClient({
    fetch: (async (_url: unknown, init?: RequestInit) => {
      seen.push({ headers: init?.headers, redirect: init?.redirect });
      return jsonResponse({ ok: true });
    }) as typeof fetch,
    minIntervalMs: 0,
    userAgent: "arch-competition-ops-previews/0.1 (+contact: me@example.org)",
  });

  const outcome = await client.getJson("https://geo.test/?q=1", unlimitedBudget());

  assert.deepEqual(outcome, { json: { ok: true }, kind: "ok" });
  assert.equal(
    (seen[0].headers as Record<string, string>)["user-agent"],
    "arch-competition-ops-previews/0.1 (+contact: me@example.org)",
  );
  assert.equal(seen[0].redirect, "error");
});

test("429 with Retry-After waits that long, retries once and succeeds", async () => {
  const clock = createClock();
  let calls = 0;
  const client = createRateLimitedClient({
    fetch: (async () => {
      calls += 1;
      return calls === 1
        ? new Response("slow down", { headers: { "retry-after": "5" }, status: 429 })
        : jsonResponse([{ lat: "1", lon: "2" }]);
    }) as typeof fetch,
    minIntervalMs: 0,
    now: clock.now,
    sleep: clock.sleep,
    userAgent: "t",
  });

  const outcome = await client.getJson("https://geo.test/?q=1", unlimitedBudget());

  assert.equal(outcome.kind, "ok");
  assert.equal(calls, 2);
  assert.ok(clock.sleeps.some((ms) => ms >= 5000), `slept ${clock.sleeps.join(",")}`);
});

test("a Retry-After beyond the cap fails fast without sleeping or retrying", async () => {
  const clock = createClock();
  let calls = 0;
  const client = createRateLimitedClient({
    fetch: (async () => {
      calls += 1;
      return new Response("", { headers: { "retry-after": "3600" }, status: 429 });
    }) as typeof fetch,
    maxRetryAfterMs: 30_000,
    minIntervalMs: 0,
    now: clock.now,
    sleep: clock.sleep,
    userAgent: "t",
  });

  const first = await client.getJson("https://geo.test/?q=1", unlimitedBudget());
  const second = await client.getJson("https://geo.test/?q=2", unlimitedBudget());

  assert.deepEqual(first, { kind: "failed", reason: "http-429" });
  assert.deepEqual(second, { kind: "failed", reason: "rate-limited" });
  assert.equal(calls, 1, "the provider is not hammered while it is blocking us");
  assert.deepEqual(clock.sleeps, []);
});

test("5xx, network errors, bad JSON and oversized bodies are failures, not empty answers", async () => {
  const responses: Array<() => Response | Promise<Response>> = [
    () => new Response("oops", { status: 500 }),
    () => new Response("oops", { status: 404 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () => new Response("<html>", { status: 200 }),
    () => jsonResponse({ big: "x".repeat(2000) }),
  ];
  let index = 0;
  const client = createRateLimitedClient({
    fetch: (async () => responses[index++]()) as typeof fetch,
    maxBytes: 100,
    minIntervalMs: 0,
    userAgent: "t",
  });

  const outcomes = [];
  for (let i = 0; i < responses.length; i += 1) {
    outcomes.push(await client.getJson(`https://geo.test/?q=${i}`, unlimitedBudget()));
  }

  assert.deepEqual(
    outcomes.map((outcome) => (outcome.kind === "failed" ? outcome.reason : "ok")),
    ["http-500", "http-404", "network", "invalid-body", "invalid-body"],
  );
});

test("an exhausted budget refuses the request without calling fetch", async () => {
  let calls = 0;
  const client = createRateLimitedClient({
    fetch: (async () => {
      calls += 1;
      return jsonResponse([]);
    }) as typeof fetch,
    minIntervalMs: 0,
    userAgent: "t",
  });
  const budget = createBudget({ maxRequests: 1, totalMs: 60_000 });

  assert.equal((await client.getJson("https://geo.test/?q=1", budget)).kind, "ok");
  assert.deepEqual(await client.getJson("https://geo.test/?q=2", budget), {
    kind: "failed",
    reason: "budget-exhausted",
  });
  assert.equal(calls, 1);
});
