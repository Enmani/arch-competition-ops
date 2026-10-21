import assert from "node:assert/strict";
import test from "node:test";

import {
  createAssetsBindingSource,
  createManifestLoader,
  lookupPreview,
  type PreviewAssetSource,
} from "./index";

const entry = (file: string | null) => ({
  algorithmVersion: "v1",
  attribution: null,
  file,
  generatedAt: "2026-10-21T00:00:00.000Z",
  kind: file ? "satellite" : "none",
  sourceHash: "0123456789abcdef",
});

const memorySource = (files: Record<string, string | Uint8Array>) => {
  const reads: string[] = [];
  const source: PreviewAssetSource = {
    readBinary: async (path) => {
      reads.push(path);
      const value = files[path];
      return value === undefined ? null : typeof value === "string" ? new TextEncoder().encode(value) : value;
    },
    readText: async (path) => {
      reads.push(path);
      const value = files[path];
      return typeof value === "string" ? value : null;
    },
  };
  return { reads, source };
};

const manifestJson = JSON.stringify({
  entries: { has: entry("has-0123456789.jpg"), none: entry(null), hostile: entry("../x.jpg") },
  generatedAt: "t",
  schemaVersion: 1,
});

test("the assets binding source asks the binding by path, never a public URL", async () => {
  const requested: string[] = [];
  const source = createAssetsBindingSource({
    fetch: async (request) => {
      requested.push(new URL(request.url).pathname);
      return request.url.endsWith("manifest.json")
        ? new Response("{}", { status: 200 })
        : new Response("missing", { status: 404 });
    },
  });

  assert.equal(await source.readText("manifest.json"), "{}");
  assert.equal(await source.readBinary("images/nope.jpg"), null);
  assert.deepEqual(requested, ["/previews/manifest.json", "/previews/images/nope.jpg"]);
});

test("a thrown binding error is treated as a missing asset", async () => {
  const source = createAssetsBindingSource({
    fetch: async () => {
      throw new Error("boom");
    },
  });

  assert.equal(await source.readText("manifest.json"), null);
});

test("the manifest is parsed once per TTL window", async () => {
  const { reads, source } = memorySource({ "manifest.json": manifestJson });
  let now = 0;
  const load = createManifestLoader(source, { now: () => now, ttlMs: 1000 });

  await Promise.all([load(), load(), load()]);
  now = 500;
  await load();
  assert.equal(reads.filter((path) => path === "manifest.json").length, 1);

  now = 1500;
  await load();
  assert.equal(reads.filter((path) => path === "manifest.json").length, 2);
});

test("a missing or corrupt manifest means no previews, retried soon", async () => {
  for (const text of [undefined, "not json", '{"schemaVersion":9}']) {
    const { source } = memorySource(text === undefined ? {} : { "manifest.json": text });
    const load = createManifestLoader(source);
    assert.equal(await load(), null);
    assert.equal(await lookupPreview(load, source, "has"), null);
  }
});

test("lookup returns the image, a locator-only entry, or nothing", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const { source } = memorySource({ "manifest.json": manifestJson, "images/has-0123456789.jpg": bytes });
  const load = createManifestLoader(source);

  assert.deepEqual((await lookupPreview(load, source, "has"))?.image, bytes);
  assert.equal((await lookupPreview(load, source, "none"))?.image, null);
  assert.equal(await lookupPreview(load, source, "absent"), null);
  assert.equal(await lookupPreview(load, source, "constructor"), null, "prototype keys are not records");
  assert.equal(await lookupPreview(load, source, "hostile"), null, "unsafe entries were dropped at parse time");
});
