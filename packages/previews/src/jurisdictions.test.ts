import assert from "node:assert/strict";
import test from "node:test";

import { getJurisdictionEntry, jurisdictionRegistry } from "./jurisdictions";
import { getOpportunityJurisdictionCode } from "./location";
import { normalizeJurisdictionKey } from "./text/normalize";

test("spellings of one key resolve to one entry", () => {
  for (const spelling of ["united_kingdom", "united-kingdom", "United Kingdom", " UNITED-KINGDOM "]) {
    assert.equal(getJurisdictionEntry(spelling)?.code, "UK", spelling);
  }
  assert.equal(normalizeJurisdictionKey(null), null);
  assert.equal(getJurisdictionEntry("atlantis"), null);
});

test("every entry has a two-letter code and at least one comparison name", () => {
  for (const [key, entry] of Object.entries(jurisdictionRegistry)) {
    assert.match(entry.code, /^[A-Z]{2}$/, key);
    assert.ok(entry.comparisonNames.length > 0, key);
    assert.equal(key, normalizeJurisdictionKey(key), `${key} must be stored in normalised form`);
  }
});

test("the display code uses the registry and falls back to initials for unknown places", () => {
  assert.equal(getOpportunityJurisdictionCode({ jurisdictionKey: "germany", jurisdictionLabel: "Germany" }), "DE");
  assert.equal(getOpportunityJurisdictionCode({ jurisdictionKey: "atlantis", jurisdictionLabel: "Lost City" }), "LC");
  assert.equal(getOpportunityJurisdictionCode({ jurisdictionKey: null, jurisdictionLabel: "" }), "OPS");
});
