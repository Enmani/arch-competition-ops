import assert from "node:assert/strict";
import test from "node:test";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import { dictionaries } from "../i18n/dictionaries";
import { formatTaxonomyList, getOpportunityDisplayMeta } from "./opportunity-display";

// Only the fields the formatter reads; the rest of the read model is irrelevant here.
const base = {
  authorityName: "",
  briefPdfUrl: null,
  buildingCategories: [],
  deadlineAt: null,
  discoveredAt: "2026-10-01T08:00:00Z",
  documentsPortalUrl: null,
  estimatedContractValueEur: null,
  estimatedContractValueText: null,
  evidenceLevelKey: "official_notice",
  evidenceLevelLabel: "Official notice",
  implementationPathKey: null,
  implementationPathLabel: "Unknown",
  jurisdictionKey: "italy",
  jurisdictionLabel: "Italy",
  locationLabel: null,
  officialUrl: null,
  opportunityTypeKey: "tender",
  opportunityTypeLabel: "Tender",
  prizeSummary: null,
  procedureTypeKey: null,
  procedureTypeLabel: "Unknown",
  projectTypeKey: null,
  registrationFeeEur: null,
  sourceUrl: "https://example.org/notice",
  statusKey: "open",
  statusLabel: "Open",
  submissionFeeEur: null,
  title: "Library",
  updatedAt: "2026-10-02T08:00:00Z",
} as unknown as StoredOpportunityFeedItem;

test("an unknown organizer reads as not published, in both locales", () => {
  assert.equal(getOpportunityDisplayMeta(dictionaries.en, "en", base).authorityLabel, "Organizer not published");
  assert.equal(getOpportunityDisplayMeta(dictionaries.zh, "zh", base).authorityLabel, "未公布采购人");
  const known = { ...base, authorityName: "Comune di Roma" };
  assert.equal(getOpportunityDisplayMeta(dictionaries.en, "en", known).authorityLabel, "Comune di Roma");
});

test("a missing fee, value and deadline stay pending instead of looking free or zero", () => {
  const meta = getOpportunityDisplayMeta(dictionaries.en, "en", base);
  assert.equal(meta.participationCostLabel, "Fee pending");
  assert.equal(meta.valueLabel, "Value pending");
  assert.equal(meta.deadlineLabel, "Deadline pending");
  assert.equal(meta.officialPageLink, null);
});

test("an explicit zero fee is the only way to read as free", () => {
  const meta = getOpportunityDisplayMeta(dictionaries.en, "en", { ...base, registrationFeeEur: 0, submissionFeeEur: 0 });
  assert.equal(meta.participationCostLabel, "No participation fee");
});

test("empty vocabulary lists read as unstated and unknown values are title-cased", () => {
  assert.equal(formatTaxonomyList(dictionaries.en, "regions", []), "Unstated");
  assert.equal(formatTaxonomyList(dictionaries.en, "audiences", ["some_new_value"]), "Some New Value");
});
