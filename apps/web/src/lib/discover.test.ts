import assert from "node:assert/strict";
import test from "node:test";

import { serializeSearchParams } from "../i18n/config";
import {
  buildDiscoverPageSearchParams,
  collectDiscoverSearchParams,
  countActiveDiscoverFilters,
  DISCOVER_MAX_LOADED,
  DISCOVER_PAGE_SIZE,
  readDiscoverFilters,
  readDiscoverPageState,
} from "./discover";

test("readDiscoverFilters keeps repeated project and building filter params as arrays", () => {
  const filters = readDiscoverFilters({
    projectType: ["urban_planning", "environment_design", "interior_project", "invalid_value"],
    buildingCategory: ["education", "healthcare"],
    designScope: ["scheme", "construction_docs", "invalid_value"],
    projectMode: ["renovation", "new_build", "invalid_value"],
    includeExpired: "true",
    search: " school ",
  });

  assert.deepEqual(filters.projectTypes, ["urban_planning", "environment_design", "interior_project"]);
  assert.deepEqual(filters.buildingCategories, ["education", "healthcare"]);
  assert.deepEqual(filters.designScopes, ["scheme", "construction_docs"]);
  assert.deepEqual(filters.projectModes, ["renovation", "new_build"]);
  assert.equal(filters.includeExpired, true);
  assert.equal(filters.search, "school");
});

test("readDiscoverFilters accepts the finer building category values used by multi-select filters", () => {
  const filters = readDiscoverFilters({
    buildingCategory: ["housing", "sport_leisure", "culture_heritage", "transport_infrastructure"],
  });

  assert.deepEqual(filters.buildingCategories, [
    "housing",
    "sport_leisure",
    "culture_heritage",
    "transport_infrastructure",
  ]);
});

test("countActiveDiscoverFilters counts multi-select values individually", () => {
  const total = countActiveDiscoverFilters({
    projectTypes: ["urban_planning", "environment_design"],
    buildingCategories: ["education", "healthcare", "housing"],
    designScopes: ["scheme", "preliminary"],
    projectModes: ["renovation"],
    includeExpired: true,
    sort: "latest",
  });

  assert.equal(total, 10);
});

const roundTrip = (query: string) => {
  const { filters, loaded } = readDiscoverPageState(collectDiscoverSearchParams(new URLSearchParams(query)));
  return { filters, loaded, query: serializeSearchParams(buildDiscoverPageSearchParams(filters, loaded)) };
};

test("every filter the form submits survives a parse and serialize round trip", () => {
  const query =
    "search=school&jurisdiction=italy&publishedWithinDays=30&deadlineBefore=2027-01-31&deadlineAfter=2026-12-01" +
    "&projectType=urban_planning&buildingCategory=education&designScope=scheme&projectMode=renovation" +
    "&minEstimatedValueEur=10000&maxEstimatedValueEur=500000&licensedArchitectRequired=true&includeExpired=true" +
    "&procedureType=open&implementationPath=direct_award&minQualificationScore=60&sort=latest";
  const result = roundTrip(query);

  assert.equal(result.filters.procedureType, "open");
  assert.equal(result.filters.implementationPath, "direct_award");
  assert.equal(result.filters.minQualificationScore, 60);
  assert.deepEqual([...new URLSearchParams(result.query)].sort(), [...new URLSearchParams(query)].sort());
});

test("the default sort and an empty form leave the URL clean", () => {
  assert.equal(roundTrip("sort=deadline&search=").query, "");
});

test("limit and offset belong to the API: the page ignores them and uses loaded instead", () => {
  const { filters, loaded } = readDiscoverPageState({ limit: "5", offset: "40", search: "x" });
  assert.equal(filters.limit, undefined);
  assert.equal(filters.offset, undefined);
  assert.equal(loaded, DISCOVER_PAGE_SIZE);
});

test("loaded is clamped between one page and the restore cap, and omitted when default", () => {
  assert.equal(readDiscoverPageState({ loaded: "3" }).loaded, DISCOVER_PAGE_SIZE);
  assert.equal(readDiscoverPageState({ loaded: "99999" }).loaded, DISCOVER_MAX_LOADED);
  assert.equal(readDiscoverPageState({ loaded: "abc" }).loaded, DISCOVER_PAGE_SIZE);
  assert.equal(readDiscoverPageState({ loaded: ["72", "5"] }).loaded, 72);
  assert.equal(roundTrip("loaded=72&search=a").query, "?search=a&loaded=72");
  assert.equal(roundTrip("loaded=36&search=a").query, "?search=a");
});

test("invalid values in an old bookmark are dropped instead of failing the page", () => {
  const { filters } = readDiscoverPageState({
    deadlineBefore: "2026-13-45",
    minQualificationScore: "lots",
    sort: "nope",
  });
  assert.equal(filters.deadlineBefore, undefined);
  assert.equal(filters.minQualificationScore, undefined);
  assert.equal(filters.sort, "deadline");
});
