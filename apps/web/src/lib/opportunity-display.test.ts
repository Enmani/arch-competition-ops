import assert from "node:assert/strict";
import test from "node:test";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import { dictionaries } from "../i18n/dictionaries";
import {
  formatTaxonomyList,
  getOpportunityDisplayMeta,
  pickCardLocationLine,
  pickDisplayTitle,
} from "./opportunity-display";

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

test("pickDisplayTitle prefers the title in the reader's language, then the cleaned title", () => {
  const titles: { displayTitle: string; displayTitleEn: string | null; displayTitleZh: string | null } = {
    displayTitle: "Cleaned",
    displayTitleEn: "English",
    displayTitleZh: "中文",
  };
  const item = (overrides: Partial<typeof titles>) =>
    ({ ...base, ...titles, title: "Source", ...overrides }) as unknown as StoredOpportunityFeedItem;

  assert.equal(pickDisplayTitle("en", item({})), "English");
  assert.equal(pickDisplayTitle("zh", item({})), "中文");
  assert.equal(pickDisplayTitle("zh", item({ displayTitleZh: null })), "Cleaned");
  assert.equal(pickDisplayTitle("en", item({ displayTitleEn: null })), "Cleaned");
});

test("a card caption reads the place as city and country code, and falls back to the country alone", () => {
  const place = (locationLabel: string | null, jurisdictionKey = "france", jurisdictionLabel = "France") =>
    ({ ...base, locationLabel, jurisdictionKey, jurisdictionLabel }) as unknown as StoredOpportunityFeedItem;

  assert.equal(pickCardLocationLine(place(null)), "France");
  assert.equal(pickCardLocationLine(place("New York")), "New York, FR");
  assert.equal(pickCardLocationLine(place("Tours")), "Tours, FR");
  // A street address is not a city: the next comma-separated segment is used instead.
  assert.equal(pickCardLocationLine(place("12 Rue de la Paix, Paris")), "Paris, FR");
  // Even when the locator refuses the label as an address, the caption keeps its city segment.
  assert.equal(pickCardLocationLine(place("230 Milson Line, Palmerston North")), "Palmerston North, FR");
  // A Chinese address is shortened to its leading administrative city, never to the street.
  assert.equal(
    pickCardLocationLine(place("柳州市鸡喇路1号（广西壮族自治区脑科医院内）", "china", "China")),
    "柳州市, CN",
  );
  // A locality that is too long to caption falls back to the country name.
  assert.equal(pickCardLocationLine(place("Taihape Memorial Park and Riverside Recreation Reserve")), "France");
});

test("a record from a multi-country source shows the country its own text names, not Global or EU", () => {
  const record = (jurisdictionKey: string, jurisdictionLabel: string, locationLabel: string | null, title: string) =>
    ({ ...base, jurisdictionKey, jurisdictionLabel, locationLabel, title }) as unknown as StoredOpportunityFeedItem;
  const ivory = record("eu", "Eu", "Côte d'Ivoire", "France – Survey services");
  const austria = record("eu", "Eu", "Bad Ischl", "Austria – Works for complete or part construction");
  const uganda = record("global", "Global", "Arua and Mbale, Uganda", "Establishment of Regional Oncology Centers");
  const unknown = record("global", "Global", "Fatih Sultan Mehmet Training & Research Hospital", "Disaster-Resilient Health");

  assert.equal(pickCardLocationLine(ivory, "Côte d'Ivoire"), "Côte d'Ivoire, CI");
  assert.equal(getOpportunityDisplayMeta(dictionaries.en, "en", ivory).jurisdictionLabel, "Côte d'Ivoire");
  assert.equal(getOpportunityDisplayMeta(dictionaries.zh, "zh", ivory).jurisdictionLabel, "科特迪瓦");
  assert.equal(getOpportunityDisplayMeta(dictionaries.en, "en", austria).locationLineLabel, "Bad Ischl, AT");
  assert.equal(getOpportunityDisplayMeta(dictionaries.zh, "zh", uganda).jurisdictionLabel, "乌干达");
  assert.equal(getOpportunityDisplayMeta(dictionaries.en, "en", uganda).locationLineLabel, "Arua and Mbale, UG");
  // Nothing in the record names a country: the generic label stays, as it is the truth.
  assert.equal(getOpportunityDisplayMeta(dictionaries.en, "en", unknown).jurisdictionLabel, "Global");
  // A jurisdiction the dictionary knows is never overridden by text.
  assert.equal(
    getOpportunityDisplayMeta(dictionaries.zh, "zh", record("germany", "Germany", "Paris", "Paris – Étude")).jurisdictionLabel,
    "德国",
  );
});

