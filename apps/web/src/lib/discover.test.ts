import assert from "node:assert/strict";
import test from "node:test";

import { countActiveDiscoverFilters, readDiscoverFilters } from "./discover";

test("readDiscoverFilters keeps repeated project and building filter params as arrays", () => {
  const filters = readDiscoverFilters({
    projectType: ["urban_planning", "environment_design", "invalid_value"],
    buildingCategory: ["education", "healthcare"],
    includeExpired: "true",
    search: " school ",
  });

  assert.deepEqual(filters.projectTypes, ["urban_planning", "environment_design"]);
  assert.deepEqual(filters.buildingCategories, ["education", "healthcare"]);
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
    includeExpired: true,
    sort: "latest",
  });

  assert.equal(total, 7);
});
