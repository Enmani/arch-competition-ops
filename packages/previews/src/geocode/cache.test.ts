import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { GEOCODE_CACHE_VERSION, GeocodeCache } from "./cache";

const withDirectory = async (run: (directory: string) => Promise<void>) => {
  const directory = await mkdtemp(path.join(tmpdir(), "previews-cache-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
};

test("entries survive a flush and reload, and the write leaves no temporary file behind", async () => {
  await withDirectory(async (directory) => {
    const filePath = path.join(directory, "geocode-cache.json");
    const first = new GeocodeCache({ filePath, flushDelayMs: 5 });
    first.storeHit("nominatim:a", { lat: 1, lng: 2, precision: "street" });
    first.storeEmpty("nominatim:b");
    await first.flush();

    assert.deepEqual(await readdir(directory), ["geocode-cache.json"]);
    const reloaded = new GeocodeCache({ filePath });
    await reloaded.load();
    assert.deepEqual(reloaded.lookup("nominatim:a"), {
      hit: true,
      place: { lat: 1, lng: 2, precision: "street" },
    });
    assert.deepEqual(reloaded.lookup("nominatim:b"), { hit: true, place: null });
    assert.deepEqual(reloaded.lookup("nominatim:c"), { hit: false });
  });
});

test("writes are debounced: many stores inside the delay produce one consistent file", async () => {
  await withDirectory(async (directory) => {
    const filePath = path.join(directory, "geocode-cache.json");
    const cache = new GeocodeCache({ filePath, flushDelayMs: 40 });
    for (let index = 0; index < 50; index += 1) {
      cache.storeHit(`k${index}`, { lat: index, lng: index });
    }
    await assert.rejects(readFile(filePath), "nothing is written before the debounce elapses");

    await cache.flush();
    const payload = JSON.parse(await readFile(filePath, "utf8"));
    assert.equal(Object.keys(payload.entries).length, 50);
    assert.equal(payload.version, GEOCODE_CACHE_VERSION);
  });
});

test("negative entries expire after their TTL, positive ones last longer", async () => {
  await withDirectory(async (directory) => {
    let now = 0;
    const cache = new GeocodeCache({
      filePath: path.join(directory, "c.json"),
      negativeTtlMs: 1000,
      now: () => now,
      positiveTtlMs: 10_000,
    });
    cache.storeEmpty("empty");
    cache.storeHit("hit", { lat: 1, lng: 1 });

    now = 999;
    assert.equal(cache.lookup("empty").hit, true);
    now = 1001;
    assert.equal(cache.lookup("empty").hit, false);
    assert.equal(cache.lookup("hit").hit, true);
    now = 10_001;
    assert.equal(cache.lookup("hit").hit, false);
    await cache.flush();
  });
});

test("a cache file from another version is ignored", async () => {
  await withDirectory(async (directory) => {
    const filePath = path.join(directory, "c.json");
    await writeFile(
      filePath,
      JSON.stringify({ entries: { old: { at: Date.now(), place: null } }, version: "0-ancient" }),
    );
    const cache = new GeocodeCache({ filePath });
    await cache.load();
    assert.equal(cache.lookup("old").hit, false);
  });
});

test("dedupe shares one in-flight promise per key and forgets it afterwards", async () => {
  const cache = new GeocodeCache({ filePath: path.join(tmpdir(), "unused-geocode-cache.json") });
  let calls = 0;
  const loader = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return calls;
  };

  const [a, b] = await Promise.all([cache.dedupe("k", loader), cache.dedupe("k", loader)]);
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(await cache.dedupe("k", loader), 2);
});
