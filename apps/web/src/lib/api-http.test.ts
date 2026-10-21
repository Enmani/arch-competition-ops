import assert from "node:assert/strict";
import test from "node:test";

import { StorageBusyError } from "@arch-competition/storage";
import { seedOpportunity } from "@arch-competition/storage/testing";

import { assertFormRequest, assertSameOrigin } from "./api/csrf";
import { HttpError } from "./api/http";
import { createOpportunitiesHandlers } from "./api/opportunities";
import { createWatchlistHandlers } from "./api/watchlists";
import { buildRequest, createApiTestContext, readError, type ApiTestContext } from "./api-test-support";
import { isAdminEmail, parseAdminEmails } from "./auth";
import { buildLoginRedirect, sanitizeReturnPath } from "./return-path";
import { readCookie, serializeClearedSessionCookie, serializeSessionCookie, sessionCookieName } from "./session-cookie";

const withContext = async (run: (context: ApiTestContext) => Promise<void>) => {
  const context = createApiTestContext();
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

const request = (method: string, headers: Record<string, string>) =>
  new Request("https://app.example.test/api/x", { headers, method });

test("assertSameOrigin: safe methods pass, matching origins pass, everything else is rejected", () => {
  assert.doesNotThrow(() => assertSameOrigin(request("GET", {})));
  assert.doesNotThrow(() => assertSameOrigin(request("POST", { origin: "https://app.example.test" })));
  assert.doesNotThrow(() => assertSameOrigin(request("POST", { origin: "http://app.example.test" })), "scheme is ignored behind TLS termination");
  assert.doesNotThrow(() => assertSameOrigin(request("DELETE", { host: "app.example.test", origin: "https://app.example.test" })));
  assert.doesNotThrow(() => assertSameOrigin(request("PATCH", { "sec-fetch-site": "same-origin" })));
  assert.doesNotThrow(() => assertSameOrigin(request("POST", { referer: "https://app.example.test/en/login" })));

  for (const headers of <Array<Record<string, string>>>[
    { origin: "https://evil.example" },
    { origin: "https://app.example.test.evil.example" },
    { origin: "null" },
    { origin: "not a url" },
    { "sec-fetch-site": "cross-site" },
    { "sec-fetch-site": "same-site" },
    { referer: "https://evil.example/page" },
    {},
  ]) {
    assert.throws(() => assertSameOrigin(request("POST", headers)), (error) => error instanceof HttpError && error.status === 403, JSON.stringify(headers));
  }
});

test("assertSameOrigin trusts the forwarded host behind a proxy", () => {
  assert.doesNotThrow(() => assertSameOrigin(request("POST", { "x-forwarded-host": "public.example", origin: "https://public.example" })));
  assert.throws(() => assertSameOrigin(request("POST", { "x-forwarded-host": "public.example", origin: "https://app.example.test" })));
});

test("assertFormRequest only accepts browser form encodings", () => {
  assert.doesNotThrow(() => assertFormRequest(request("POST", { "content-type": "application/x-www-form-urlencoded; charset=UTF-8" })));
  assert.doesNotThrow(() => assertFormRequest(request("POST", { "content-type": "multipart/form-data; boundary=x" })));
  assert.throws(() => assertFormRequest(request("POST", { "content-type": "application/json" })), (error) => error instanceof HttpError && error.status === 415);
  assert.throws(() => assertFormRequest(request("POST", {})));
});

test("the public opportunities API validates and bounds its query and sets a short shared cache", async () => {
  await withContext(async (context) => {
    for (let index = 0; index < 130; index += 1) {
      seedOpportunity(context.test.raw, { id: `row-${index}`, title: `Row ${index}` });
    }
    const { GET } = createOpportunitiesHandlers(context.deps);
    const ask = (query: string) => GET(buildRequest(`/api/opportunities${query}`));

    const defaults = await ask("");
    assert.equal(defaults.status, 200);
    assert.match(defaults.headers.get("cache-control") ?? "", /s-maxage=60/);
    const body = (await defaults.json()) as { filters: Record<string, unknown>; opportunities: unknown[]; total: number };
    assert.equal(body.opportunities.length, 24);
    assert.equal(body.total, 130);
    assert.deepEqual(body.filters, { limit: 24, offset: 0, sort: "deadline" });

    assert.equal(((await (await ask("?limit=5000")).json()) as { opportunities: unknown[] }).opportunities.length, 100);
    assert.equal(((await (await ask("?limit=0")).json()) as { opportunities: unknown[] }).opportunities.length, 1);
    assert.equal(((await (await ask("?offset=-3&limit=2")).json()) as { filters: { offset: number } }).filters.offset, 0);
    assert.equal((await ask("?publishedWithinDays=1000000000")).status, 200);

    for (const invalid of ["?deadlineBefore=soon", "?projectType=castle", "?sort=random", "?includeExpired=perhaps", "?limit=abc"]) {
      const response = await ask(invalid);
      assert.equal(response.status, 400, invalid);
      assert.equal((await readError(response)).code, "invalid_request");
      assert.equal(response.headers.get("cache-control"), "no-store");
    }
  });
});

test("search terms with LIKE wildcards are matched literally through the API", async () => {
  await withContext(async (context) => {
    seedOpportunity(context.test.raw, { id: "a", title: "100% funded" });
    seedOpportunity(context.test.raw, { id: "b", title: "Plain" });
    const { GET } = createOpportunitiesHandlers(context.deps);
    const body = (await (await GET(buildRequest("/api/opportunities?search=%25"))).json()) as { opportunities: Array<{ title: string }> };
    assert.deepEqual(body.opportunities.map((item) => item.title), ["100% funded"]);
  });
});

test("a busy database is reported as 503 + Retry-After, never as an empty list", async () => {
  const { GET } = createOpportunitiesHandlers({
    getStorage: async () => {
      throw new StorageBusyError("locked");
    },
  });
  const original = console.warn;
  console.warn = () => undefined;
  try {
    const response = await GET(buildRequest("/api/opportunities"));
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "5");
    assert.equal((await readError(response)).code, "storage_unavailable");
  } finally {
    console.warn = original;
  }
});

test("a malformed Cookie header or session token is treated as anonymous", async () => {
  await withContext(async (context) => {
    const { GET } = createWatchlistHandlers(context.deps);
    for (const cookie of ["garbage", `${sessionCookieName(false)}=`, `${sessionCookieName(false)}=${"x".repeat(1000)}`, `${sessionCookieName(true)}=abc`]) {
      assert.equal((await GET(buildRequest("/api/watchlists", { cookie }))).status, 401, cookie);
    }
  });
});

test("session cookie helpers: names, parsing and attributes", () => {
  assert.equal(sessionCookieName(true), "__Host-arch_competition_ops_session");
  assert.equal(sessionCookieName(false), "arch_competition_ops_session");
  assert.equal(readCookie("a=1; arch_competition_ops_session=tok; b=2", "arch_competition_ops_session"), "tok");
  assert.equal(readCookie(null, "x"), null);
  assert.equal(readCookie("x=", "x"), null);

  const expires = new Date(Date.now() + 3600_000).toISOString();
  const production = serializeSessionCookie("tok", expires, true);
  assert.deepEqual(
    ["__Host-arch_competition_ops_session=tok", "Path=/", "HttpOnly", "SameSite=Lax", "Secure"].filter((part) => !production.includes(part)),
    [],
  );
  assert.ok(!/Domain=/i.test(production));
  const development = serializeSessionCookie("tok", expires, false);
  assert.ok(!development.includes("Secure") && !development.includes("__Host-"));
  assert.match(serializeClearedSessionCookie(true), /Max-Age=0/);
});

test("return paths: only locale-prefixed same-site paths survive; login redirects keep the destination", () => {
  assert.equal(sanitizeReturnPath("/en/ops", "zh"), "/en/ops");
  assert.equal(sanitizeReturnPath("//evil.example", "zh"), "/zh/dashboard");
  assert.equal(sanitizeReturnPath("/other/path", "en"), "/en/dashboard");
  assert.equal(sanitizeReturnPath(undefined, "en"), "/en/dashboard");
  assert.equal(buildLoginRedirect("zh", "/zh/dashboard"), "/zh/login?next=%2Fzh%2Fdashboard");
  assert.equal(buildLoginRedirect("en", "https://evil.example"), "/en/login?next=%2Fen%2Fdashboard");
});

test("administrators come only from ARCH_OPS_ADMIN_EMAILS, case-insensitively", () => {
  assert.deepEqual([...parseAdminEmails(" A@x.com, b@X.com;c@x.com ")].sort(), ["a@x.com", "b@x.com", "c@x.com"]);
  assert.equal(isAdminEmail("B@x.COM", { ARCH_OPS_ADMIN_EMAILS: "a@x.com,b@x.com" }), true);
  assert.equal(isAdminEmail("nobody@x.com", { ARCH_OPS_ADMIN_EMAILS: "a@x.com" }), false);
  assert.equal(isAdminEmail("a@x.com", {}), false);
  assert.equal(isAdminEmail("a@x.com", { ARCH_OPS_ADMIN_EMAILS: "" }), false);
});
