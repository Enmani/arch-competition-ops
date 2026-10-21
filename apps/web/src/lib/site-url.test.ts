import assert from "node:assert/strict";
import test from "node:test";

import { resolveSiteOrigin } from "./site-url";

test("a configured SITE_URL wins and is reduced to its origin", () => {
  assert.equal(
    resolveSiteOrigin({ configured: "https://ops.example.com/some/path", host: "evil.test" }),
    "https://ops.example.com",
  );
});

test("a malformed or non-http SITE_URL falls back to the host", () => {
  assert.equal(
    resolveSiteOrigin({ configured: "javascript:alert(1)", host: "ops.example.com" }),
    "https://ops.example.com",
  );
  assert.equal(resolveSiteOrigin({ configured: "not a url", host: "ops.example.com" }), "https://ops.example.com");
});

test("localhost stays on http and the forwarded protocol is honoured", () => {
  assert.equal(resolveSiteOrigin({ host: "localhost:3400" }), "http://localhost:3400");
  assert.equal(resolveSiteOrigin({ forwardedProto: "http", host: "intranet.example" }), "http://intranet.example");
  assert.equal(
    resolveSiteOrigin({ forwardedProto: "https, http", host: "ops.example.com" }),
    "https://ops.example.com",
  );
});

test("hosts that do not look like hostnames are rejected", () => {
  for (const host of ["", "evil.com/path", "a b", "evil.com@x", "<script>", "x.com:99999999"]) {
    assert.equal(resolveSiteOrigin({ host }), null, host);
  }
  assert.equal(resolveSiteOrigin({}), null);
});
