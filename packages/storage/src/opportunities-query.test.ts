import assert from "node:assert/strict";
import test from "node:test";

import { buildFacetStatements } from "./opportunities/facets";
import { buildCountStatement, buildPageStatement, normalizeQuery } from "./opportunities/query";
import { createTestStorage, seedOpportunity, type TestStorage } from "./testing";

const withStorage = async (run: (context: TestStorage) => Promise<void>) => {
  const context = createTestStorage();
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

const titles = (items: Array<{ title: string }>) => items.map((item) => item.title);

test("deadline sort puts undated records last and paging happens in SQL with a separate total", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "a", title: "A", deadline_at: "2026-06-01" });
    seedOpportunity(raw, { id: "b", title: "B", deadline_at: "2026-05-01" });
    seedOpportunity(raw, { id: "c", title: "C", deadline_at: "2026-07-01" });
    seedOpportunity(raw, { id: "d", title: "D" });

    const firstPage = await storage.opportunities.discover({ limit: 2, offset: 0 });
    assert.deepEqual(titles(firstPage.opportunities), ["B", "A"]);
    assert.equal(firstPage.total, 4);

    const secondPage = await storage.opportunities.discover({ limit: 2, offset: 2 });
    assert.deepEqual(titles(secondPage.opportunities), ["C", "D"]);
    assert.equal(secondPage.total, 4);

    const beyondEnd = await storage.opportunities.discover({ limit: 2, offset: 50 });
    assert.deepEqual(beyondEnd.opportunities, []);
    assert.equal(beyondEnd.total, 4);
  });
});

test("limit defaults to 24 and is capped at 100; negative or absurd paging values are clamped", async () => {
  await withStorage(async ({ raw, storage }) => {
    for (let index = 0; index < 130; index += 1) {
      seedOpportunity(raw, { id: `row-${String(index).padStart(3, "0")}`, title: `Row ${index}` });
    }

    assert.equal((await storage.opportunities.feed()).length, 24);
    assert.equal((await storage.opportunities.feed({ limit: 1000 })).length, 100);
    assert.equal((await storage.opportunities.feed({ limit: 0 })).length, 1);
    assert.equal((await storage.opportunities.feed({ limit: 5, offset: -10 })).length, 5);
    const { total } = await storage.opportunities.discover({ limit: 1, offset: 1e12 });
    assert.equal(total, 130);
  });
});

test("publishedWithinDays and numeric bounds cannot trigger RangeError or break SQL", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "recent", title: "Recent", discovered_at: "2026-04-18T00:00:00.000Z" });
    seedOpportunity(raw, { id: "old", title: "Old", discovered_at: "2020-01-01T00:00:00.000Z" });

    assert.deepEqual(titles(await storage.opportunities.feed({ publishedWithinDays: 1e9 })), ["Old", "Recent"].sort());
    assert.deepEqual(titles(await storage.opportunities.feed({ publishedWithinDays: 7 })), ["Recent"]);
    assert.equal((await storage.opportunities.feed({ minEstimatedValueEur: Number.NaN })).length, 2);
  });
});

test("search escapes LIKE wildcards and matches non-ASCII text regardless of typed case", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "pct", title: "Rate 100% funded school" });
    seedOpportunity(raw, { id: "under", title: "Hall_A pavilion" });
    seedOpportunity(raw, { id: "plain", title: "Hallway extension" });
    seedOpportunity(raw, { id: "austria", title: "Neubau", authority_name: "Land Österreich" });
    seedOpportunity(raw, { id: "backslash", title: "Path C:\\temp competition" });

    assert.deepEqual(titles(await storage.opportunities.feed({ search: "100%" })), ["Rate 100% funded school"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ search: "Hall_A" })), ["Hall_A pavilion"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ search: "%" })), ["Rate 100% funded school"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ search: "österreich" })), ["Neubau"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ search: "ÖSTERREICH".toLowerCase() })), ["Neubau"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ search: "c:\\temp" })), ["Path C:\\temp competition"]);
  });
});

test("search also reaches the publishing platform name and the official notice id", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "one", title: "One", source_name: "ANAC BDNCP", official_notice_id: "N-2026-77" });
    seedOpportunity(raw, { id: "two", title: "Two" });

    assert.deepEqual(titles(await storage.opportunities.feed({ search: "anac" })), ["One"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ search: "2026-77" })), ["One"]);
  });
});

test("expired notices are hidden by default, undated ones stay, includeExpired opts in, archived never shows by default", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "future", title: "Future", deadline_at: "2026-05-01" });
    seedOpportunity(raw, { id: "today", title: "Today", deadline_at: "2026-04-19" });
    seedOpportunity(raw, { id: "expired", title: "Expired", deadline_at: "2026-03-01" });
    seedOpportunity(raw, { id: "undated", title: "Undated" });
    seedOpportunity(raw, { id: "archived", title: "Archived", status: "archived", deadline_at: "2026-06-01" });
    seedOpportunity(raw, { id: "discarded", title: "Discarded", status: "discarded" });

    assert.deepEqual(
      titles(await storage.opportunities.feed({ sort: "latest" })).sort(),
      ["Future", "Today", "Undated"],
    );
    assert.deepEqual(
      titles(await storage.opportunities.feed({ includeExpired: true })).sort(),
      ["Archived", "Expired", "Future", "Today", "Undated"],
    );
  });
});

test("deadline filters validate dates; deadlineBefore includes timestamps on that day; past deadlineAfter cannot resurrect expired notices", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "stamp", title: "Stamp", deadline_at: "2026-05-10T18:00:00Z" });
    seedOpportunity(raw, { id: "later", title: "Later", deadline_at: "2026-06-30" });
    seedOpportunity(raw, { id: "expired", title: "Expired", deadline_at: "2026-03-01" });

    assert.deepEqual(titles(await storage.opportunities.feed({ deadlineBefore: "2026-05-10" })), ["Stamp"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ deadlineAfter: "2026-06-01" })), ["Later"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ deadlineAfter: "2020-01-01" })).sort(), ["Later", "Stamp"]);
    // Malformed dates are dropped by the schema instead of reaching SQL.
    assert.equal((await storage.opportunities.feed({ deadlineBefore: "2026-02-31" })).length, 2);
    assert.equal((await storage.opportunities.feed({ deadlineAfter: "yesterday" })).length, 2);
  });
});

test("value bounds ignore unknown contract values instead of treating them as zero", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "small", title: "Small", estimated_contract_value_eur: 100_000 });
    seedOpportunity(raw, { id: "big", title: "Big", estimated_contract_value_eur: 5_000_000 });
    seedOpportunity(raw, { id: "unknown", title: "Unknown" });

    assert.deepEqual(titles(await storage.opportunities.feed({ maxEstimatedValueEur: 200_000 })), ["Small"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ minEstimatedValueEur: 1_000_000 })), ["Big"]);
    assert.deepEqual(
      titles(await storage.opportunities.feed({ sort: "highest_value" })),
      ["Big", "Small", "Unknown"],
    );
  });
});

test("jurisdiction, qualification score, licensed-architect and procedure alias filters run in SQL", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "it", title: "IT", jurisdiction: "italy", qualification_score: 80, licensed_architect_required: 1, procedure_type: "Procédure Adaptée" });
    seedOpportunity(raw, { id: "fr", title: "FR", jurisdiction: "france", qualification_score: 30, licensed_architect_required: 0, procedure_type: "adapted_procedure" });
    seedOpportunity(raw, { id: "de", title: "DE", jurisdiction: "germany", procedure_type: "secondary_discovery_listing" });

    assert.deepEqual(titles(await storage.opportunities.feed({ jurisdiction: "italy" })), ["IT"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ minQualificationScore: 50 })), ["IT"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ licensedArchitectRequired: true })), ["IT"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ procedureType: "adapted_procedure" })).sort(), ["FR", "IT"]);
    assert.deepEqual(await storage.opportunities.feed({ procedureType: "secondary_discovery_listing" }), []);
  });
});

test("classification filters read the stored columns through json_each and tolerate a corrupted row", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "school", title: "School", project_types: '["building_project"]', building_categories: '["education"]', design_scopes: '["scheme"]', project_modes: '["new_build"]' });
    seedOpportunity(raw, { id: "park", title: "Park", project_types: '["environment_design"]' });
    seedOpportunity(raw, { id: "broken", title: "Broken", project_types: "not json", building_categories: "{" });

    assert.deepEqual(titles(await storage.opportunities.feed({ projectTypes: ["building_project", "urban_planning"] })), ["School"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ buildingCategories: ["education"] })), ["School"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ designScopes: ["scheme"] })), ["School"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ projectModes: ["new_build"] })), ["School"]);
    assert.deepEqual(titles(await storage.opportunities.feed({ projectTypes: ["environment_design"] })), ["Park"]);
  });
});

test("filter options are aggregated in SQL, scoped to the current slice and keep the selected values", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "a", title: "A", jurisdiction: "italy", procedure_type: "open_procedure", implementation_path: "unknown", project_types: '["building_project"]', building_categories: '["healthcare","education"]' });
    seedOpportunity(raw, { id: "b", title: "B", jurisdiction: "france", procedure_type: "Procédure Adaptée", project_types: '["urban_planning"]', design_scopes: '["planning"]', project_modes: '["renovation"]' });
    seedOpportunity(raw, { id: "c", title: "C", jurisdiction: "germany", status: "archived", project_types: '["interior_project"]' });

    const everything = await storage.opportunities.discover({});
    assert.deepEqual(everything.filterOptions.jurisdictions, ["france", "italy"]);
    assert.deepEqual(everything.filterOptions.procedureTypes, ["adapted_procedure", "open"]);
    assert.deepEqual(everything.filterOptions.projectTypes, ["urban_planning", "building_project"]);
    assert.deepEqual(everything.filterOptions.buildingCategories, ["education", "healthcare"]);
    assert.deepEqual(everything.filterOptions.designScopes, ["planning"]);
    assert.deepEqual(everything.filterOptions.projectModes, ["renovation"]);
    assert.deepEqual(everything.filterOptions.implementationPaths, ["unknown"]);

    const scoped = await storage.opportunities.discover({ jurisdiction: "france" });
    assert.deepEqual(scoped.filterOptions.jurisdictions, ["france"]);
    assert.deepEqual(scoped.filterOptions.projectTypes, ["urban_planning"]);
    assert.equal(scoped.total, 1);

    const nothing = await storage.opportunities.discover({ jurisdiction: "spain" });
    assert.equal(nothing.total, 0);
    assert.deepEqual(nothing.filterOptions.jurisdictions, ["spain"]);
  });
});

test("slug lookup is a primary-key read that accepts percent-encoded non-ASCII ids", async () => {
  await withStorage(async ({ raw, storage }) => {
    const id = "区域-更新-设计__ggzy-42__abc123";
    seedOpportunity(raw, { id, title: "非ASCII 项目" });
    seedOpportunity(raw, { id: "plain-slug", title: "Plain" });

    assert.equal((await storage.opportunities.getBySlug(id))?.title, "非ASCII 项目");
    assert.equal((await storage.opportunities.getBySlug(encodeURIComponent(id)))?.id, id);
    assert.equal((await storage.opportunities.getBySlug("plain-slug"))?.title, "Plain");
    assert.equal(await storage.opportunities.getBySlug("%E0%A4%A"), undefined);
    assert.equal(await storage.opportunities.getBySlug("missing"), undefined);
  });
});

test("getByIds batches lookups beyond the bound-parameter limit and keeps request order", async () => {
  await withStorage(async ({ raw, storage }) => {
    const ids = Array.from({ length: 200 }, (_, index) => `id-${String(index).padStart(3, "0")}`);
    for (const id of ids) {
      seedOpportunity(raw, { id, title: id });
    }
    const requested = [...ids].reverse().slice(0, 150);
    const items = await storage.opportunities.getByIds([...requested, "unknown-id", requested[0]]);

    assert.deepEqual(items.map((item) => item.id), requested);
  });
});

test("every discover statement stays inside Cloudflare D1 limits (compound SELECT terms, bound parameters)", () => {
  const clock = { now: () => new Date("2026-04-19T12:00:00Z") };
  const worstCase = normalizeQuery({
    buildingCategories: ["education", "healthcare", "housing", "civic_public", "sport_leisure", "culture_heritage", "transport_infrastructure"],
    deadlineAfter: "2026-05-01",
    deadlineBefore: "2026-12-31",
    designScopes: ["interior_design", "architectural_design", "scheme", "preliminary", "construction_docs", "planning", "design_service"],
    implementationPath: "unknown",
    jurisdiction: "italy",
    licensedArchitectRequired: true,
    maxEstimatedValueEur: 1e9,
    minEstimatedValueEur: 1,
    minQualificationScore: 10,
    procedureType: "open",
    projectModes: ["new_build", "renovation", "extension"],
    projectTypes: ["urban_regeneration", "environment_design", "urban_planning", "interior_project", "building_project"],
    publishedWithinDays: 30,
    search: "school",
  });

  const statements = [buildCountStatement(worstCase, clock), buildPageStatement(worstCase, clock), ...buildFacetStatements(worstCase, clock)];
  for (const statement of statements) {
    assert.ok((statement.parameters ?? []).length <= 100, `bound parameters: ${(statement.parameters ?? []).length}`);
    assert.ok((statement.sql.match(/UNION ALL/g) ?? []).length + 1 <= 5, "D1 allows at most 5 compound SELECT terms");
  }
  assert.equal(buildFacetStatements(worstCase, clock).length, 2);
});
