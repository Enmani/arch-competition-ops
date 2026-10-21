import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { loadPreviewConfig } from "../config";
import { unlimitedBudget } from "../testing";
import type { AddressCandidate } from "../types";
import { buildProviderGeocodeCacheKey } from "./cache";
import { geocodeViaAmap, geocodeViaBaidu, geocodeViaNominatim } from "./providers";
import { createGeocodingServices } from "./services";

const candidate: AddressCandidate = {
  address: "Milano",
  kind: "locality",
  localityHint: null,
  source: "title",
};
const milan = {
  addresstype: "city",
  boundingbox: ["45.4600", "45.5200", "9.1200", "9.2000"],
  category: "place",
  lat: "45.4642",
  lon: "9.19",
  type: "city",
};

const harness = async (
  respond: (url: string) => Response | Promise<Response>,
  env: NodeJS.ProcessEnv = {},
) => {
  const directory = await mkdtemp(path.join(tmpdir(), "previews-geocode-"));
  const urls: string[] = [];
  const services = createGeocodingServices({
    cacheDirectory: directory,
    config: loadPreviewConfig(env),
    fetch: (async (url: string) => {
      urls.push(url);
      return respond(url);
    }) as unknown as typeof fetch,
    sleep: async () => undefined,
  });
  return {
    context: { budget: unlimitedBudget(), services },
    directory,
    done: () => rm(directory, { force: true, recursive: true }),
    key: (query: string) => buildProviderGeocodeCacheKey("nominatim", query),
    services,
    urls,
  };
};

test("a Nominatim hit is returned and cached with its precision", async () => {
  const h = await harness(() => Response.json([milan]));
  try {
    const result = await geocodeViaNominatim(h.context, candidate, ["Milano, Italy"], "it");

    assert.ok(result);
    assert.equal(result.lat, 45.4642);
    assert.equal(h.urls.length, 1);
    assert.match(h.urls[0], /countrycodes=it/);
    assert.equal(h.services.cache.lookup(h.key("Milano, Italy")).hit, true);

    assert.deepEqual(await geocodeViaNominatim(h.context, candidate, ["Milano, Italy"], "it"), result);
    assert.equal(h.urls.length, 1, "the second call is answered from the cache");
  } finally {
    await h.done();
  }
});

test("rate limits, server errors and network failures are never stored as negative cache entries", async () => {
  for (const respond of [
    () => new Response("", { headers: { "retry-after": "3600" }, status: 429 }),
    () => new Response("", { status: 503 }),
    () => new Response("", { status: 500 }),
    () => {
      throw new TypeError("fetch failed");
    },
    () => new Response("<html>gateway</html>", { status: 200 }),
  ]) {
    const h = await harness(respond);
    try {
      const result = await geocodeViaNominatim(h.context, candidate, ["Milano, Italy"], "it");

      assert.equal(result, null);
      assert.deepEqual(h.services.cache.lookup(h.key("Milano, Italy")), { hit: false });
      await h.services.cache.flush();
    } finally {
      await h.done();
    }
  }
});

test("a definitive empty answer is cached negatively so it is not asked again", async () => {
  const h = await harness(() => Response.json([]));
  try {
    assert.equal(await geocodeViaNominatim(h.context, candidate, ["Nowhere"], undefined), null);
    assert.deepEqual(h.services.cache.lookup(h.key("Nowhere")), { hit: true, place: null });

    assert.equal(await geocodeViaNominatim(h.context, candidate, ["Nowhere"], undefined), null);
    assert.equal(h.urls.length, 1);
  } finally {
    await h.done();
  }
});

test("concurrent lookups of one query share a single request", async () => {
  const h = await harness(() => Response.json([milan]));
  try {
    const results = await Promise.all([
      geocodeViaNominatim(h.context, candidate, ["Milano, Italy"], "it"),
      geocodeViaNominatim(h.context, candidate, ["Milano, Italy"], "it"),
      geocodeViaNominatim(h.context, candidate, ["Milano, Italy"], "it"),
    ]);

    assert.equal(h.urls.length, 1);
    assert.ok(results.every((result) => result?.lat === 45.4642));
  } finally {
    await h.done();
  }
});

test("the keyed Chinese providers do nothing without credentials", async () => {
  const h = await harness(() => Response.json({}));
  try {
    assert.equal(await geocodeViaBaidu(h.context, candidate, "黄冈师范学院"), null);
    assert.equal(await geocodeViaAmap(h.context, candidate, "黄冈师范学院"), null);
    assert.equal(h.urls.length, 0);
  } finally {
    await h.done();
  }
});

test("Baidu and Amap failures are not cached either, but a rejected answer is", async () => {
  const h = await harness(
    (url) =>
      url.includes("baidu")
        ? new Response("", { status: 500 })
        : Response.json({ geocodes: [], status: "1" }),
    {
      ARCH_SATELLITE_AMAP_KEY: "amap-key",
      ARCH_SATELLITE_BAIDU_AK: "baidu-ak",
      ARCH_SATELLITE_BAIDU_GEOCODER_URL: "https://baidu.test/geocoding/v3/",
    },
  );
  try {
    assert.equal(await geocodeViaBaidu(h.context, candidate, "某地"), null);
    assert.deepEqual(h.services.cache.lookup(buildProviderGeocodeCacheKey("baidu", "某地")), { hit: false });

    assert.equal(await geocodeViaAmap(h.context, candidate, "某地"), null);
    assert.deepEqual(h.services.cache.lookup(buildProviderGeocodeCacheKey("amap", "某地")), {
      hit: true,
      place: null,
    });
  } finally {
    await h.done();
  }
});
