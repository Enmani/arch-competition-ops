import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

import { createManifestLoader } from "@arch-competition/previews/serve";
import { createFilesystemSource } from "@arch-competition/previews/serve/fs";

import {
  ASSET_CACHE,
  IMMUTABLE_CACHE,
  MISSING_CACHE,
  PLACEHOLDER_CACHE,
  createOpportunityImageHandler,
  type OpportunityImageDeps,
} from "./opportunity-image-response";

const REVISION = "v7";
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
let directory = "";

const entry = (file: string | null, algorithmVersion = REVISION, extra: object = {}) => ({
  algorithmVersion,
  attribution: "Imagery (c) test",
  file,
  generatedAt: "2026-10-21T00:00:00.000Z",
  kind: file ? "satellite" : "none",
  sourceHash: "0123456789abcdef",
  ...extra,
});

before(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "image-handler-"));
  await mkdir(path.join(directory, "images"));
  await writeFile(path.join(directory, "images", "current-0123456789.jpg"), jpeg);
  await writeFile(path.join(directory, "images", "stale-0123456789.jpg"), jpeg);
  await writeFile(
    path.join(directory, "manifest.json"),
    JSON.stringify({
      entries: {
        current: entry("current-0123456789.jpg"),
        escape: entry("../../etc/passwd"),
        "locator only": entry(null, REVISION, {
          kind: "locator",
          locator: { label: "Maur", lat: 47.3407, lng: 8.671, precision: "city" },
        }),
        stale: entry("stale-0123456789.jpg", "v0-old"),
        "with space": entry("current-0123456789.jpg"),
      },
      generatedAt: "2026-10-21T00:00:00.000Z",
      schemaVersion: 1,
    }),
  );
});

after(() => rm(directory, { force: true, recursive: true }));

const opportunity = {
  authorityName: "Gemeinde Maur",
  geoLat: null,
  geoLng: null,
  jurisdictionKey: "switzerland",
  jurisdictionLabel: "Switzerland",
  locationLabel: "Maur",
  title: "Looren",
};

const call = (
  slug: string,
  query = "",
  overrides: Partial<OpportunityImageDeps> & { opportunities?: Record<string, typeof opportunity> } = {},
) => {
  const source = createFilesystemSource(() => directory);
  const lookedUp: string[] = [];
  const handler = createOpportunityImageHandler({
    development: false,
    getOpportunity: async (value) => {
      lookedUp.push(value);
      return overrides.opportunities?.[value] ?? null;
    },
    getPreviewSource: async () => ({ loader: createManifestLoader(source), source }),
    revision: REVISION,
    ...overrides,
  });
  return handler(new Request(`http://localhost:3400/api/opportunities/x/image${query}`), slug).then(
    (response) => ({ lookedUp, response }),
  );
};

test("a prebuilt image is served without touching the database", async () => {
  const { lookedUp, response } = await call("current", `?rev=${REVISION}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/jpeg");
  assert.equal(response.headers.get("x-arch-image-source"), "asset");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), jpeg);
  assert.deepEqual(lookedUp, []);
});

test("a request carrying the current revision is cached forever", async () => {
  const { response } = await call("current", `?rev=${REVISION}`);

  assert.equal(response.headers.get("cache-control"), IMMUTABLE_CACHE);
  assert.equal(IMMUTABLE_CACHE, "public, max-age=31536000, immutable");
});

test("a request without or with another revision is only cached for a while", async () => {
  for (const query of ["", "?rev=other"]) {
    const { response } = await call("current", query);
    assert.equal(response.headers.get("cache-control"), ASSET_CACHE, query);
  }
});

test("an image made by an older algorithm version is never marked immutable", async () => {
  const { response } = await call("stale", `?rev=${REVISION}`);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), ASSET_CACHE);
});

test("development never caches", async () => {
  const { response } = await call("current", `?rev=${REVISION}`, { development: true });

  assert.equal(response.headers.get("cache-control"), "no-store, max-age=0");
});

test("a percent-encoded slug resolves to the same manifest entry", async () => {
  const { response } = await call("with%20space", `?rev=${REVISION}`);

  assert.equal(response.headers.get("x-arch-image-source"), "asset");
});

test("without a prebuilt image the locator placeholder is returned with a short cache", async () => {
  const { response } = await call("unknown-but-real", "", { opportunities: { "unknown-but-real": opportunity } });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("x-arch-image-source"), "placeholder");
  assert.equal(response.headers.get("cache-control"), PLACEHOLDER_CACHE);
  assert.match(await response.text(), /country-outline/);
});

test("an unknown record gets a neutral 404 placeholder", async () => {
  const { response } = await call("does-not-exist");

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("cache-control"), MISSING_CACHE);
  assert.match(await response.text(), />OPS</);
});

test("a locator-only manifest entry places the marker on the placeholder", async () => {
  const { response } = await call("locator only", "", { opportunities: { "locator only": opportunity } });

  assert.match(await response.text(), /data-marker-source="geo-coordinates"/);
});

test("a manifest file name that tries to leave the images directory is never read", async () => {
  const { response } = await call("escape", "", { opportunities: { escape: opportunity } });

  assert.equal(response.headers.get("x-arch-image-source"), "placeholder");
});

test("the route and its handler stay free of everything forbidden in the request path", async () => {
  const sources = await Promise.all(
    [
      new URL("../app/api/opportunities/[slug]/image/route.ts", import.meta.url),
      new URL("./opportunity-image-response.ts", import.meta.url),
    ].map((url) => readFile(url, "utf8")),
  );

  for (const source of sources) {
    for (const forbidden of [/["']sharp["']/, /child_process/, /pdftotext/, /\bfetch\(/, /nominatim/i]) {
      assert.doesNotMatch(source, forbidden);
    }
  }
});
