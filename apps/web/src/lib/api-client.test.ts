import assert from "node:assert/strict";
import test from "node:test";

import { dictionaries } from "../i18n/dictionaries";
import { classifyApiFailure, describeApiFailure, requestJson, sendJson } from "./api-client";

test("401, 403 and 429 are classified from the status alone", () => {
  assert.equal(classifyApiFailure(401, null).kind, "unauthenticated");
  assert.equal(classifyApiFailure(403, null).kind, "forbidden");
  assert.equal(classifyApiFailure(429, null).kind, "rate_limited");
});

test("the error code refines a status the proxy may have rewritten", () => {
  assert.equal(classifyApiFailure(500, "forbidden").kind, "forbidden");
  assert.equal(classifyApiFailure(403, "csrf_rejected").kind, "forbidden");
  assert.equal(classifyApiFailure(503, "storage_unavailable").kind, "unavailable");
  assert.equal(classifyApiFailure(415, "unsupported_media_type").kind, "invalid_request");
  assert.equal(classifyApiFailure(500, "internal_error").kind, "generic");
});

test("Retry-After is kept for 429 and 503 only, and only when it is a positive number", () => {
  assert.equal(classifyApiFailure(429, null, "30").retryAfterSeconds, 30);
  assert.equal(classifyApiFailure(503, null, "2.2").retryAfterSeconds, 3);
  assert.equal(classifyApiFailure(429, null, "Wed, 21 Oct 2026 07:28:00 GMT").retryAfterSeconds, null);
  assert.equal(classifyApiFailure(401, null, "30").retryAfterSeconds, null);
});

test("messages are localized and never echo server text", () => {
  const zh = dictionaries.zh.common.apiErrors;
  const en = dictionaries.en.common.apiErrors;
  assert.equal(describeApiFailure(en, classifyApiFailure(401, null)), en.unauthenticated);
  assert.equal(describeApiFailure(zh, classifyApiFailure(403, null)), zh.forbidden);
  assert.equal(
    describeApiFailure(en, classifyApiFailure(429, null, "12")),
    "Too many requests. Try again in 12 seconds.",
  );
  assert.equal(describeApiFailure(en, classifyApiFailure(429, null)), en.rateLimited);
  assert.equal(describeApiFailure(zh, { kind: "network", retryAfterSeconds: null, status: 0 }), zh.network);
});

const withFetch = async (impl: typeof fetch, run: () => Promise<void>) => {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
};

test("requestJson returns data on success and a classified failure otherwise", async () => {
  await withFetch(
    async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }),
    async () => {
      assert.deepEqual(await requestJson("/x"), { data: { ok: 1 }, ok: true });
    },
  );
  await withFetch(
    async () =>
      new Response(JSON.stringify({ error: { code: "rate_limited", message: "x" } }), {
        headers: { "retry-after": "7" },
        status: 429,
      }),
    async () => {
      const result = await requestJson("/x");
      assert.equal(result.ok, false);
      assert.deepEqual(!result.ok && result.failure, { kind: "rate_limited", retryAfterSeconds: 7, status: 429 });
    },
  );
});

test("a network error and a non-JSON error body are both handled", async () => {
  await withFetch(
    async () => {
      throw new TypeError("Failed to fetch");
    },
    async () => {
      const result = await requestJson("/x");
      assert.equal(!result.ok && result.failure.kind, "network");
    },
  );
  await withFetch(
    async () => new Response("<html>bad gateway</html>", { status: 502 }),
    async () => {
      const result = await requestJson("/x");
      assert.equal(!result.ok && result.failure.kind, "generic");
    },
  );
});

test("sendJson posts a JSON body with the content type the API requires", async () => {
  let seen: RequestInit | undefined;
  await withFetch(
    async (_url, init) => {
      seen = init;
      return new Response("{}", { status: 201 });
    },
    async () => {
      await sendJson("/api/watchlists", "POST", { opportunityId: "a" });
    },
  );
  assert.equal(seen?.method, "POST");
  assert.equal(seen?.body, JSON.stringify({ opportunityId: "a" }));
  assert.equal((seen?.headers as Record<string, string>)["content-type"], "application/json");
});
