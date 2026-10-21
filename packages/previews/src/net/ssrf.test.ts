import assert from "node:assert/strict";
import test from "node:test";

import { isPrivateAddress, parsePublicHttpUrl, UnsafeUrlError } from "./ssrf";

const reason = (url: string) => {
  try {
    parsePublicHttpUrl(url);
    return null;
  } catch (error) {
    assert.ok(error instanceof UnsafeUrlError);
    return error.reason;
  }
};

test("public http and https URLs are accepted", () => {
  assert.equal(parsePublicHttpUrl("https://www.stadt-zuerich.ch/hochbau/de/index.html").hostname, "www.stadt-zuerich.ch");
  assert.equal(parsePublicHttpUrl("http://example.org:8080/a.pdf").port, "8080");
  assert.equal(parsePublicHttpUrl("/relative.pdf", "https://example.org/dir/").href, "https://example.org/relative.pdf");
});

test("non-http schemes, credentials and unusual ports are refused", () => {
  assert.equal(reason("file:///etc/passwd"), "scheme");
  assert.equal(reason("ftp://example.org/x"), "scheme");
  assert.equal(reason("javascript:alert(1)"), "scheme");
  assert.equal(reason("https://user:pw@example.org/"), "credentials");
  assert.equal(reason("http://example.org:22/"), "port");
  assert.equal(reason("not a url"), "unparseable");
});

test("loopback, private, link-local and metadata addresses are refused as literals", () => {
  for (const url of [
    "http://127.0.0.1/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f.0.0.1/",
    "http://10.0.0.5/",
    "http://172.16.0.1/",
    "http://192.168.1.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://100.64.0.1/",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[::]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[::ffff:7f00:1]/",
    "http://[64:ff9b::a00:1]/",
  ]) {
    assert.equal(reason(url), "private-address", url);
  }
  assert.equal(reason("http://93.184.216.34/"), null);
  assert.equal(reason("http://[2606:2800:220:1:248:1893:25c8:1946]/"), null);
});

test("internal host names and single-label hosts are refused", () => {
  for (const url of [
    "http://localhost/",
    "http://LOCALHOST:8080/",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://db.internal/",
    "http://intranet/",
    "http://router.home.arpa/",
  ]) {
    assert.equal(reason(url), "non-public-host", url);
  }
});

test("isPrivateAddress classifies boundaries correctly", () => {
  assert.equal(isPrivateAddress("172.15.255.255"), false);
  assert.equal(isPrivateAddress("172.16.0.0"), true);
  assert.equal(isPrivateAddress("172.31.255.255"), true);
  assert.equal(isPrivateAddress("172.32.0.0"), false);
  assert.equal(isPrivateAddress("100.63.255.255"), false);
  assert.equal(isPrivateAddress("8.8.8.8"), false);
  assert.equal(isPrivateAddress("224.0.0.1"), true);
  assert.equal(isPrivateAddress("2001:db8::1"), true);
  assert.equal(isPrivateAddress("2001:4860:4860::8888"), false);
  assert.equal(isPrivateAddress("garbage"), true);
});
