import assert from "node:assert/strict";
import test from "node:test";

import type { PreviewOpportunity } from "../types";
import { readStoredLocator } from "./resolve-record";

const base: PreviewOpportunity = {
  authorityName: "",
  briefPdfUrl: null,
  documentsPortalUrl: null,
  geoConfidence: 0.78,
  geoLat: 61.0987561,
  geoLng: 7.4825328,
  geoSource: "nominatim",
  jurisdictionKey: "norway",
  jurisdictionLabel: "Norway",
  locationLabel: "Lærdalsøyri",
  officialUrl: null,
  slug: "laerdalsoyri",
  sourceUrl: null,
  title: "Flood protection area plan",
};

test("a stored precise point becomes the locator without geocoding again", () => {
  assert.deepEqual(readStoredLocator(base), {
    label: "Lærdalsøyri",
    lat: 61.0987561,
    lng: 7.4825328,
    precision: "locality",
  });
  // An area-level point (a Chinese district) is still a usable place, with the country as fallback label.
  assert.deepEqual(readStoredLocator({ ...base, geoSource: "nominatim:area", geoConfidence: 0.6, locationLabel: null }), {
    label: "Norway",
    lat: 61.0987561,
    lng: 7.4825328,
    precision: "locality",
  });
});

test("a country centroid, missing coordinates or low confidence never become a locator", () => {
  assert.equal(readStoredLocator({ ...base, geoSource: "nominatim:country", geoConfidence: 0.25 }), null);
  assert.equal(readStoredLocator({ ...base, geoLat: null }), null);
  assert.equal(readStoredLocator({ ...base, geoLng: undefined }), null);
  assert.equal(readStoredLocator({ ...base, geoConfidence: 0.4 }), null);
  assert.equal(readStoredLocator({ ...base, geoLat: Number.NaN }), null);
});