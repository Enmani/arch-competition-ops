import assert from "node:assert/strict";
import test from "node:test";

import { createLogger, describeParticipationFee } from "@arch-competition/core";

import { createTestStorage, seedOpportunity, type TestStorage } from "./testing";

const withStorage = async (run: (context: TestStorage) => Promise<void>, options?: Parameters<typeof createTestStorage>[0]) => {
  const context = createTestStorage(options);
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

test("NULL fees read as pending and only an explicit 0 reads as no participation fee", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "unknown", title: "Unknown fee" });
    seedOpportunity(raw, { id: "free", title: "Free", registration_fee_eur: 0, submission_fee_eur: 0 });
    seedOpportunity(raw, { id: "paid", title: "Paid", registration_fee_eur: 50, submission_fee_eur: null });
    seedOpportunity(raw, { id: "half", title: "Half known", registration_fee_eur: 0, submission_fee_eur: null });

    const bySlug = async (slug: string) => storage.opportunities.getBySlug(slug);
    assert.equal((await bySlug("unknown"))?.feeLabel, "Fee pending");
    assert.equal((await bySlug("unknown"))?.registrationFeeEur, null);
    assert.equal((await bySlug("free"))?.feeLabel, "No participation fee");
    assert.equal((await bySlug("paid"))?.feeLabel, "EUR 50 registration");
    assert.equal((await bySlug("half"))?.feeLabel, "EUR 0 registration");
  });
});

test("describeParticipationFee is the single fee rule", () => {
  assert.deepEqual(describeParticipationFee(null, null), { kind: "pending" });
  assert.deepEqual(describeParticipationFee(undefined, undefined), { kind: "pending" });
  assert.deepEqual(describeParticipationFee(0, 0), { kind: "free" });
  assert.deepEqual(describeParticipationFee(0, null), { kind: "amounts", registrationEur: 0, submissionEur: null });
  assert.deepEqual(describeParticipationFee(null, 25), { kind: "amounts", registrationEur: null, submissionEur: 25 });
});

test("the buyer is authority_name, then organizer; the publishing platform is never presented as the buyer", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "both", title: "Both", authority_name: "Comune di Roma", organizer: "Roma Capitale", source_name: "ANAC BDNCP", source_id: "anac" });
    seedOpportunity(raw, { id: "organizer-only", title: "Organizer only", organizer: "Region Lazio" });
    seedOpportunity(raw, { id: "unknown", title: "Unknown buyer", organizer: "", source_name: "TED Europa" });

    const both = await storage.opportunities.getBySlug("both");
    assert.equal(both?.authorityName, "Comune di Roma");
    assert.equal(both?.organizerName, "Roma Capitale");
    assert.equal(both?.sourceName, "ANAC BDNCP");
    assert.equal(both?.sourceId, "anac");

    assert.equal((await storage.opportunities.getBySlug("organizer-only"))?.authorityName, "Region Lazio");

    const unknown = await storage.opportunities.getBySlug("unknown");
    assert.equal(unknown?.authorityName, "");
    assert.equal(unknown?.organizerName, null);
    assert.equal(unknown?.sourceName, "TED Europa");
    assert.ok(!unknown?.subtitle.includes("TED Europa"));
  });
});

test("officialUrl is null unless the worker stored one", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "with", title: "With", official_url: "https://official.example/notice" });
    seedOpportunity(raw, { id: "without", title: "Without", official_url: "" });

    assert.equal((await storage.opportunities.getBySlug("with"))?.officialUrl, "https://official.example/notice");
    const without = await storage.opportunities.getBySlug("without");
    assert.equal(without?.officialUrl, null);
    assert.equal(without?.sourceUrl, "https://example.org/notice");
  });
});

test("feed items expose normalized keys, stored classification and complete detail fields", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, {
      id: "full",
      title: "Hospital extension",
      procedure_type: "Procédure Ouverte",
      implementation_path: "winner_or_winners_progress_to_negotiated_service_award",
      opportunity_type: "public_design_contest",
      evidence_level: "official_listing",
      status: "shortlisted",
      deadline_at: "2026-06-30",
      estimated_contract_value_eur: 2_500_000,
      licensed_architect_required: 1,
      local_partner_required: 0,
      project_types: '["building_project","urban_planning"]',
      building_categories: '["healthcare","bogus"]',
      design_scopes: '["scheme"]',
      project_modes: '["extension"]',
      competition_types: '["healthcare","public_building"]',
      cpv_codes: '["71200000"]',
      geo_lat: 41.9,
      geo_lng: 12.5,
      location_label: "Rome",
    });

    const item = await storage.opportunities.getBySlug("full");
    assert.ok(item);
    assert.equal(item.procedureTypeKey, "open");
    assert.equal(item.procedureTypeLabel, "Open procedure");
    assert.equal(item.opportunityTypeLabel, "Public design contest");
    assert.equal(item.statusKey, "shortlisted");
    assert.equal(item.statusLabel, "Shortlisted");
    assert.equal(item.evidenceLevelKey, "official_listing");
    assert.equal(item.sourceTierLabel, "Primary official source");
    assert.equal(item.deadlineLabel, "Closes 30 Jun 2026");
    assert.equal(item.contractValueLabel, "Estimated service value EUR 2.50M");
    assert.equal(item.qualificationLabel, "Licensed architect required");
    assert.equal(item.licensedArchitectRequired, true);
    assert.equal(item.localPartnerRequired, false);
    assert.deepEqual(item.projectTypes, ["urban_planning", "building_project"]);
    assert.equal(item.projectTypeKey, "urban_planning");
    assert.deepEqual(item.buildingCategories, ["healthcare"]);
    assert.deepEqual(item.designScopes, ["scheme"]);
    assert.deepEqual(item.projectModes, ["extension"]);
    assert.deepEqual(item.tags, ["Healthcare", "Public Building", "71200000"]);
    assert.equal(item.geoLat, 41.9);
    assert.equal(item.locationLabel, "Rome");
    assert.equal(item.slug, item.id);
  });
});

test("missing optional facts stay pending instead of being invented", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "bare", title: "Bare record", evidence_level: "secondary", jurisdiction: null });
    const item = await storage.opportunities.getBySlug("bare");

    assert.equal(item?.deadlineLabel, "Deadline pending");
    assert.equal(item?.contractValueLabel, "Commercial value pending");
    assert.equal(item?.qualificationLabel, "Qualification pending");
    assert.equal(item?.procedureTypeLabel, "Procedure pending");
    assert.equal(item?.procedureTypeKey, null);
    assert.equal(item?.sourceTierLabel, "Secondary source");
    assert.equal(item?.estimatedContractValueEur, null);
    assert.equal(item?.licensedArchitectRequired, null);
  });
});

test("raw contract value text and prize summary are used when no EUR amount exists", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "text", title: "Text", estimated_contract_value_text: "approx. EUR 1-2 million" });
    seedOpportunity(raw, { id: "prize", title: "Prize", prize_summary: "First prize EUR 10,000" });

    assert.equal((await storage.opportunities.getBySlug("text"))?.contractValueLabel, "approx. EUR 1-2 million");
    assert.equal((await storage.opportunities.getBySlug("prize"))?.contractValueLabel, "First prize EUR 10,000");
  });
});

test("a malformed JSON column is rendered empty and leaves a warning with the record id", async () => {
  const warnings: string[] = [];
  const logger = createLogger("test", {
    debug: () => undefined,
    error: () => undefined,
    info: () => undefined,
    warn: (line: string) => warnings.push(line),
  });
  await withStorage(
    async ({ raw, storage }) => {
      seedOpportunity(raw, { id: "broken", title: "Broken", regions: "not-json" });
      const item = await storage.opportunities.getBySlug("broken");

      assert.deepEqual(item?.regions, []);
      assert.equal(warnings.length, 1);
      assert.match(warnings[0], /malformed_json_column/);
      assert.match(warnings[0], /"rowId":"broken"/);
    },
    { logger },
  );
});

test("a missing database file yields empty results, never demo records", async () => {
  await withStorage(async ({ storage }) => {
    assert.deepEqual(await storage.opportunities.feed(), []);
    const surface = await storage.opportunities.discover();
    assert.equal(surface.total, 0);
    assert.deepEqual(surface.opportunities, []);
  });
});
