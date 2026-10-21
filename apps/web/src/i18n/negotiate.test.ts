import assert from "node:assert/strict";
import test from "node:test";

import { localeToRemember, negotiateLocale, parseAcceptLanguage, resolveLocaleRedirect } from "./negotiate";

test("the locale cookie beats Accept-Language", () => {
  assert.equal(negotiateLocale({ acceptLanguage: "en-US,en;q=0.9", cookieLocale: "zh" }), "zh");
});

test("an invalid cookie is ignored and q-values order Accept-Language", () => {
  assert.equal(negotiateLocale({ acceptLanguage: "zh;q=0.4, en-GB;q=0.8", cookieLocale: "fr" }), "en");
  assert.equal(negotiateLocale({ acceptLanguage: "zh-CN,zh;q=0.9,en;q=0.5" }), "zh");
});

test("malformed ranges are skipped and the default applies", () => {
  assert.deepEqual(parseAcceptLanguage("en;q=banana, *, ;q=0.5"), []);
  assert.equal(negotiateLocale({ acceptLanguage: "fr-FR,de;q=0.8" }), "zh");
  assert.equal(negotiateLocale({}), "zh");
});

test("bare and unsupported paths redirect to the negotiated locale and keep the query", () => {
  const input = { acceptLanguage: "en-US", cookieLocale: null };
  assert.equal(resolveLocaleRedirect({ ...input, pathname: "/" }), "/en/discover");
  assert.equal(
    resolveLocaleRedirect({ ...input, pathname: "/discover", search: "?search=school" }),
    "/en/discover?search=school",
  );
  assert.equal(resolveLocaleRedirect({ ...input, pathname: "/fr/ops" }), "/en/ops");
  assert.equal(resolveLocaleRedirect({ ...input, pathname: "/en-GB/discover" }), "/en/discover");
  assert.equal(resolveLocaleRedirect({ ...input, pathname: "/zh" }), "/zh/discover");
});

test("legacy detail URLs map to /opportunities and re-encode the slug once", () => {
  const input = { acceptLanguage: "zh", cookieLocale: null };
  assert.equal(resolveLocaleRedirect({ ...input, pathname: "/competitions/a%20b" }), "/zh/opportunities/a%20b");
  assert.equal(resolveLocaleRedirect({ ...input, pathname: "/en/competitions/a b" }), "/en/opportunities/a%20b");
});

test("localized pages, API routes, Next internals and static files are not redirected", () => {
  const input = { acceptLanguage: "en", cookieLocale: null };
  for (const pathname of ["/en/discover", "/zh/opportunities/x", "/api/watchlists", "/_next/static/a.js", "/robots.txt"]) {
    assert.equal(resolveLocaleRedirect({ ...input, pathname }), null, pathname);
  }
});

test("a path with doubled slashes never becomes a protocol-relative redirect", () => {
  const target = resolveLocaleRedirect({ acceptLanguage: "en", pathname: "//evil.example/x" });
  assert.ok(target?.startsWith("/en/"), String(target));
});

test("the visited locale is remembered, except from prefetches or when already stored", () => {
  assert.equal(localeToRemember({ cookieLocale: "zh", isPrefetch: false, pathname: "/en/discover" }), "en");
  assert.equal(localeToRemember({ cookieLocale: "zh", isPrefetch: true, pathname: "/en/discover" }), null);
  assert.equal(localeToRemember({ cookieLocale: "en", isPrefetch: false, pathname: "/en/discover" }), null);
  assert.equal(localeToRemember({ cookieLocale: null, isPrefetch: false, pathname: "/api/x" }), null);
});
