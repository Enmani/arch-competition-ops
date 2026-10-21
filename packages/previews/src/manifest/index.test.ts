import assert from "node:assert/strict";
import test from "node:test";

import {
  buildPreviewFileName,
  createEmptyManifest,
  isSafeImageFileName,
  parsePreviewManifest,
  sanitizePreviewSlug,
} from "./index";

const validEntry = {
  algorithmVersion: "v1",
  attribution: "Imagery",
  file: "a-0123456789.jpg",
  generatedAt: "2026-10-21T00:00:00.000Z",
  kind: "satellite",
  sourceHash: "0123456789abcdef",
};

test("file names are content-addressed per record and sanitised", () => {
  assert.equal(buildPreviewFileName("slug/with spaces & ümlauts", "abcdef0123456789"), "slug_with_spaces_mlauts-abcdef0123.jpg");
  assert.equal(sanitizePreviewSlug("a".repeat(300)).length, 120);
});

test("only plain .jpg file names are accepted", () => {
  for (const good of ["a.jpg", "road-work-0123456789.jpg", "A_b.c-d.jpg"]) {
    assert.equal(isSafeImageFileName(good), true, good);
  }
  for (const bad of ["../a.jpg", "a/b.jpg", "a\b.jpg", ".hidden.jpg", "a.png", "a..jpg", "", "a.jpg/"]) {
    assert.equal(isSafeImageFileName(bad), false, bad);
  }
});

test("a valid manifest round-trips and optional fields are kept", () => {
  const manifest = {
    ...createEmptyManifest(new Date("2026-10-21T00:00:00Z")),
    entries: {
      one: { ...validEntry, locator: { label: "Maur", lat: 47.3, lng: 8.6, precision: "city" } },
      two: { ...validEntry, attribution: null, file: null, kind: "none" },
    },
  };

  assert.deepEqual(parsePreviewManifest(JSON.parse(JSON.stringify(manifest))), manifest);
});

test("anything that is not a manifest of this schema is rejected", () => {
  for (const input of [null, "x", [], {}, { schemaVersion: 2, entries: {} }, { schemaVersion: 1 }, { schemaVersion: 1, entries: [] }]) {
    assert.equal(parsePreviewManifest(input), null, JSON.stringify(input));
  }
});

test("individually broken entries are dropped without losing the rest", () => {
  const parsed = parsePreviewManifest({
    entries: {
      bad_kind: { ...validEntry, kind: "weird" },
      bad_path: { ...validEntry, file: "../../secret.jpg" },
      bad_type: { ...validEntry, sourceHash: 12 },
      bad_locator: { ...validEntry, locator: { lat: "x", lng: 1, precision: "city" } },
      fine: validEntry,
    },
    generatedAt: "t",
    schemaVersion: 1,
  });

  assert.deepEqual(Object.keys(parsed?.entries ?? {}).sort(), ["bad_locator", "fine"]);
  assert.equal(parsed?.entries.bad_locator.locator, undefined);
});
