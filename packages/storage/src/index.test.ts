import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

const createTempDb = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-storage-"));
  const dbPath = path.join(directory, "competitions.sqlite");
  const database = new Database(dbPath);

  database.exec(`
    CREATE TABLE competitions (
      id TEXT PRIMARY KEY,
      dedup_key TEXT NOT NULL,
      title TEXT NOT NULL,
      organizer TEXT NOT NULL,
      authority_name TEXT,
      official_url TEXT,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      opportunity_type TEXT NOT NULL,
      jurisdiction TEXT,
      procedure_type TEXT,
      official_notice_id TEXT,
      regions TEXT NOT NULL,
      languages TEXT NOT NULL,
      competition_types TEXT NOT NULL,
      audience TEXT NOT NULL,
      cpv_codes TEXT NOT NULL,
      implementation_path TEXT,
      licensed_architect_required INTEGER,
      local_partner_required INTEGER,
      registration_fee_eur REAL,
      submission_fee_eur REAL,
      estimated_contract_value_eur REAL,
      estimated_contract_value_text TEXT,
      prize_summary TEXT,
      deadline_at TEXT,
      eligibility_summary TEXT,
      brief_pdf_url TEXT,
      documents_portal_url TEXT,
      extraction_confidence REAL NOT NULL,
      evidence_level TEXT NOT NULL,
      qualification_score REAL,
      evidence_note TEXT,
      last_verified_at TEXT,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  database.exec(`
    CREATE TABLE source_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT NOT NULL,
      source_name TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      completed_at TEXT,
      document_count INTEGER NOT NULL DEFAULT 0,
      upserted_count INTEGER NOT NULL DEFAULT 0,
      parse_failure_count INTEGER NOT NULL DEFAULT 0,
      duplicate_group_count INTEGER NOT NULL DEFAULT 0,
      max_duplicate_group_size INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    );

    CREATE TABLE source_health (
      source_id TEXT PRIMARY KEY,
      source_name TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      source_tier TEXT NOT NULL,
      last_status TEXT NOT NULL,
      last_run_started_at TEXT,
      last_run_completed_at TEXT,
      last_success_at TEXT,
      last_document_count INTEGER NOT NULL DEFAULT 0,
      last_upserted_count INTEGER NOT NULL DEFAULT 0,
      last_parse_failure_count INTEGER NOT NULL DEFAULT 0,
      duplicate_group_count INTEGER NOT NULL DEFAULT 0,
      max_duplicate_group_size INTEGER NOT NULL DEFAULT 0,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE ops_review_queue_items (
      queue_id TEXT PRIMARY KEY,
      origin TEXT NOT NULL DEFAULT 'worker_diagnostic',
      reason_code TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      priority INTEGER NOT NULL DEFAULT 0,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      evidence_note TEXT,
      source_id TEXT,
      competition_id TEXT,
      dedup_key TEXT,
      notice_id TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      is_active INTEGER NOT NULL DEFAULT 1,
      first_detected_at TEXT NOT NULL,
      last_detected_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE ops_review_decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      queue_id TEXT NOT NULL,
      decision TEXT NOT NULL,
      actor_label TEXT,
      note TEXT,
      created_at TEXT NOT NULL
    );
  `);

  const insert = database.prepare(`
    INSERT INTO competitions (
      id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
      opportunity_type, jurisdiction, procedure_type, official_notice_id, regions, languages,
      competition_types, audience, cpv_codes, implementation_path, licensed_architect_required,
      local_partner_required, registration_fee_eur, submission_fee_eur, estimated_contract_value_eur,
      estimated_contract_value_text, prize_summary, deadline_at, eligibility_summary, brief_pdf_url,
      documents_portal_url, extraction_confidence, evidence_level, qualification_score, evidence_note,
      last_verified_at, discovered_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    );
  `);

  const now = "2026-04-19T00:00:00+00:00";
  const recent = "2026-04-18T00:00:00+00:00";
  const older = "2026-02-01T00:00:00+00:00";
  insert.run(
    "italy-library",
    "italy-library",
    "Municipal Library Design Competition",
    "TED",
    "Comune Demo Nord",
    "https://example.com/italy",
    "https://example.com/italy",
    "verified",
    "public_design_contest",
    "italy",
    "design_contest",
    "TED-001",
    JSON.stringify(["europe", "italy"]),
    JSON.stringify(["en", "it"]),
    JSON.stringify(["architecture"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71230000"]),
    "winner_or_winners_progress_to_negotiated_service_award",
    1,
    0,
    0,
    0,
    1850000,
    null,
    null,
    "2026-06-30",
    "Architect registration required.",
    null,
    null,
    0.95,
    "official_notice",
    0.94,
    "High-confidence official notice.",
    older,
    recent,
    now,
  );
  insert.run(
    "france-hospital",
    "france-hospital",
    "Regional Hospital Campus Expansion Design Services",
    "BOAMP",
    "Agence Regionale Infrastructures",
    "https://example.com/france",
    "https://example.com/france",
    "shortlisted",
    "public_design_services_procurement",
    "france",
    "maitrise_d_oeuvre_procurement",
    "BOAMP-002",
    JSON.stringify(["europe", "france"]),
    JSON.stringify(["fr"]),
    JSON.stringify(["healthcare"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71240000"]),
    "service_contract_award_after_competitive_selection",
    1,
    1,
    0,
    0,
    4200000,
    null,
    null,
    "2026-07-15",
    "Healthcare references requested.",
    null,
    null,
    0.82,
    "official_listing",
    0.88,
    "Local partner likely required.",
    recent,
    recent,
    now,
  );
  insert.run(
    "switzerland-campus",
    "switzerland-campus",
    "Cantonal School Campus Planning Competition",
    "SIMAP",
    "Kanton Beispiel Bauamt",
    "https://example.com/switzerland",
    "https://example.com/switzerland",
    "discovered",
    "public_design_contest",
    "switzerland",
    "planning_competition",
    "SIMAP-003",
    JSON.stringify(["europe", "switzerland"]),
    JSON.stringify(["de", "fr"]),
    JSON.stringify(["education", "masterplan"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71230000"]),
    "winner_or_winners_progress_to_negotiated_service_award",
    1,
    0,
    0,
    0,
    980000,
    null,
    null,
    "2026-05-12",
    "Architect qualification required.",
    "https://example.com/switzerland/brief.pdf",
    "https://example.com/switzerland/documents",
    0.77,
    "official_notice",
    0.81,
    "Swiss planning competition notice.",
    older,
    older,
    older,
  );
  insert.run(
    "italy-expired",
    "italy-expired",
    "Expired Municipal Theatre Renewal Procurement",
    "SCP",
    "Comune Demo Sud",
    "https://example.com/italy-expired",
    "https://example.com/italy-expired",
    "discovered",
    "public_design_services_procurement",
    "italy",
    "public_design_services_tender",
    "SCP-004",
    JSON.stringify(["europe", "italy"]),
    JSON.stringify(["it"]),
    JSON.stringify(["public_building"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71240000"]),
    "service_contract_award_after_competitive_selection",
    1,
    0,
    0,
    0,
    650000,
    null,
    null,
    "2026-04-10",
    "Procurement already closed.",
    null,
    null,
    0.72,
    "official_notice",
    0.7,
    "Expired official notice kept for regression tests.",
    older,
    older,
    older,
  );
  insert.run(
    "germany-undated",
    "germany-undated",
    "Undated Framework Design Services Listing",
    "Municipal Portal",
    "Stadt Beispiel",
    "https://example.com/germany-undated",
    "https://example.com/germany-undated",
    "verified",
    "public_design_services_procurement",
    "germany",
    "open",
    "DE-005",
    JSON.stringify(["europe", "germany"]),
    JSON.stringify(["de"]),
    JSON.stringify(["architecture"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71240000"]),
    "service_contract_award_after_competitive_selection",
    1,
    0,
    0,
    0,
    null,
    "GBP 1,000,000",
    null,
    null,
    "Deadline not stated in source.",
    null,
    null,
    0.74,
    "official_listing",
    0.76,
    "Undated official listing kept visible by default.",
    recent,
    recent,
    now,
  );
  insert.run(
    "italy-regeneration",
    "italy-regeneration",
    "Historic Center Urban Regeneration and Adaptive Reuse Services",
    "SCP",
    "Comune Demo Centro",
    "https://example.com/italy-regeneration",
    "https://example.com/italy-regeneration",
    "verified",
    "public_design_services_procurement",
    "italy",
    "public_design_services_tender",
    "SCP-006",
    JSON.stringify(["europe", "italy"]),
    JSON.stringify(["it"]),
    JSON.stringify(["urban_design", "adaptive_reuse"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71240000"]),
    "service_contract_award_after_competitive_selection",
    1,
    0,
    0,
    0,
    2200000,
    null,
    null,
    "2026-06-20",
    "Urban regeneration programme with adaptive reuse scope.",
    null,
    null,
    0.83,
    "official_notice",
    0.86,
    "Future urban regeneration notice for classification tests.",
    recent,
    recent,
    now,
  );
  insert.run(
    "germany-landscape",
    "germany-landscape",
    "Waterfront Park and Public Realm Landscape Design",
    "Municipal Portal",
    "Stadt Gruen",
    "https://example.com/germany-landscape",
    "https://example.com/germany-landscape",
    "verified",
    "public_design_contest",
    "germany",
    "design_contest",
    "DE-007",
    JSON.stringify(["europe", "germany"]),
    JSON.stringify(["de", "en"]),
    JSON.stringify(["landscape"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71222000"]),
    "winner_or_winners_progress_to_negotiated_service_award",
    1,
    0,
    0,
    0,
    890000,
    null,
    null,
    "2026-08-01",
    "Landscape architecture and public realm design.",
    null,
    null,
    0.8,
    "official_listing",
    0.79,
    "Landscape notice for project-type filtering.",
    recent,
    recent,
    now,
  );
  insert.run(
    "france-housing",
    "france-housing",
    "Mixed-Use Housing Block and Street-Level Retail Design Services",
    "TED",
    "Ville Demo Habitat",
    "https://example.com/france-housing",
    "https://example.com/france-housing",
    "verified",
    "public_design_services_procurement",
    "france",
    "maitrise_d_oeuvre_procurement",
    "TED-008",
    JSON.stringify(["europe", "france"]),
    JSON.stringify(["fr"]),
    JSON.stringify(["architecture", "housing"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71200000"]),
    "service_contract_award_after_competitive_selection",
    1,
    0,
    0,
    0,
    2600000,
    null,
    null,
    "2026-08-12",
    "Housing-led block with mixed-use ground floor.",
    null,
    null,
    0.81,
    "official_notice",
    0.84,
    "Housing notice for building-category filtering.",
    recent,
    recent,
    now,
  );
  insert.run(
    "switzerland-sports",
    "switzerland-sports",
    "Extension du complexe sportif et de loisirs Looren",
    "SIMAP",
    "Commune Demo Loisirs",
    "https://example.com/switzerland-sports",
    "https://example.com/switzerland-sports",
    "verified",
    "public_design_contest",
    "switzerland",
    "design_contest",
    "SIMAP-009",
    JSON.stringify(["europe", "switzerland"]),
    JSON.stringify(["fr", "de"]),
    JSON.stringify(["architecture"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71200000"]),
    "winner_or_winners_progress_to_negotiated_service_award",
    1,
    0,
    0,
    0,
    1750000,
    null,
    null,
    "2026-08-18",
    "Sports and leisure complex extension.",
    null,
    null,
    0.8,
    "official_notice",
    0.82,
    "Sports notice for multi-select filtering.",
    recent,
    recent,
    now,
  );
  insert.run(
    "italy-heritage",
    "italy-heritage",
    "Archaeological Site Restoration and Museum Route Design Services",
    "SCP",
    "Comune Demo Patrimonio",
    "https://example.com/italy-heritage",
    "https://example.com/italy-heritage",
    "verified",
    "public_design_services_procurement",
    "italy",
    "public_design_services_tender",
    "SCP-010",
    JSON.stringify(["europe", "italy"]),
    JSON.stringify(["it"]),
    JSON.stringify(["architecture"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71200000"]),
    "service_contract_award_after_competitive_selection",
    1,
    0,
    0,
    0,
    1420000,
    null,
    null,
    "2026-08-24",
    "Heritage restoration and interpretation scope.",
    null,
    null,
    0.79,
    "official_notice",
    0.8,
    "Heritage notice for building-category filtering.",
    recent,
    recent,
    now,
  );
  insert.run(
    "germany-transport",
    "germany-transport",
    "Rail Station Tunnel Modernization and Passenger Access Planning",
    "TED",
    "Stadt Demo Verkehr",
    "https://example.com/germany-transport",
    "https://example.com/germany-transport",
    "verified",
    "public_design_services_procurement",
    "germany",
    "open",
    "TED-011",
    JSON.stringify(["europe", "germany"]),
    JSON.stringify(["de", "en"]),
    JSON.stringify(["masterplan", "architecture"]),
    JSON.stringify(["professionals"]),
    JSON.stringify(["71240000"]),
    "service_contract_award_after_competitive_selection",
    1,
    0,
    0,
    0,
    3300000,
    null,
    null,
    "2026-08-30",
    "Transport tunnel and station access planning.",
    null,
    null,
    0.84,
    "official_notice",
    0.87,
    "Transport notice for building-category filtering.",
    recent,
    recent,
    now,
  );

  database
    .prepare(`
      INSERT INTO source_health (
        source_id, source_name, source_kind, source_tier, last_status,
        last_run_started_at, last_run_completed_at, last_success_at,
        last_document_count, last_upserted_count, last_parse_failure_count,
        duplicate_group_count, max_duplicate_group_size, last_error, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "ted_design_notices",
      "TED Design and Procurement Notices",
      "official_procurement",
      "primary",
      "completed_with_failures",
      "2026-04-20T06:00:00+00:00",
      "2026-04-20T06:05:00+00:00",
      "2026-04-20T06:05:00+00:00",
      18,
      15,
      3,
      2,
      3,
      "Three payloads failed parser validation.",
      now,
    );
  database
    .prepare(`
      INSERT INTO source_health (
        source_id, source_name, source_kind, source_tier, last_status,
        last_run_started_at, last_run_completed_at, last_success_at,
        last_document_count, last_upserted_count, last_parse_failure_count,
        duplicate_group_count, max_duplicate_group_size, last_error, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "boamp_design_notices",
      "BOAMP Design Notices",
      "official_procurement",
      "primary",
      "success",
      "2026-04-19T05:00:00+00:00",
      "2026-04-19T05:02:00+00:00",
      "2026-04-19T05:02:00+00:00",
      10,
      10,
      0,
      0,
      0,
      null,
      now,
    );

  database
    .prepare(`
      INSERT INTO ops_review_queue_items (
        queue_id, origin, reason_code, status, priority, title, summary, evidence_note,
        source_id, competition_id, dedup_key, notice_id, payload_json, is_active,
        first_detected_at, last_detected_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "source-parse-failures:ted_design_notices",
      "worker_diagnostic",
      "source_parse_failures",
      "pending",
      90,
      "TED Design and Procurement Notices",
      "3 payloads failed parser validation in the latest run.",
      "Three payloads failed parser validation.",
      "ted_design_notices",
      null,
      null,
      null,
      JSON.stringify({ lastParseFailureCount: 3 }),
      1,
      "2026-04-20T06:05:00+00:00",
      "2026-04-20T06:05:00+00:00",
      now,
    );
  database
    .prepare(`
      INSERT INTO ops_review_queue_items (
        queue_id, origin, reason_code, status, priority, title, summary, evidence_note,
        source_id, competition_id, dedup_key, notice_id, payload_json, is_active,
        first_detected_at, last_detected_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "duplicate-cluster:italy-library",
      "worker_diagnostic",
      "duplicate_cluster",
      "pending",
      87,
      "Municipal Library Design Competition",
      "2 canonical records currently share the same dedup key.",
      null,
      null,
      "italy-library",
      "italy-library",
      "TED-001",
      JSON.stringify({ duplicateCount: 2, competitionIds: ["italy-library", "italy-library-copy"] }),
      1,
      "2026-04-19T00:00:00+00:00",
      "2026-04-20T06:05:00+00:00",
      now,
    );
  database
    .prepare(`
      INSERT INTO ops_review_queue_items (
        queue_id, origin, reason_code, status, priority, title, summary, evidence_note,
        source_id, competition_id, dedup_key, notice_id, payload_json, is_active,
        first_detected_at, last_detected_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "low-confidence:switzerland-campus",
      "worker_diagnostic",
      "low_confidence_record",
      "accepted",
      54,
      "Cantonal School Campus Planning Competition",
      "Extraction confidence 0.77 on a discovered canonical record.",
      "Swiss planning competition notice.",
      null,
      "switzerland-campus",
      "switzerland-campus",
      "SIMAP-003",
      JSON.stringify({ extractionConfidence: 0.77, status: "discovered" }),
      1,
      "2026-04-18T00:00:00+00:00",
      "2026-04-20T06:05:00+00:00",
      now,
    );
  database
    .prepare(`
      INSERT INTO ops_review_queue_items (
        queue_id, origin, reason_code, status, priority, title, summary, evidence_note,
        source_id, competition_id, dedup_key, notice_id, payload_json, is_active,
        first_detected_at, last_detected_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "evidence-conflict:france-hospital",
      "worker_diagnostic",
      "evidence_conflict",
      "rejected",
      92,
      "Regional Hospital Campus Expansion Design Services",
      "Evidence notes record an explicit conflict that needs operator review.",
      "Official source wins over aggregator conflict.",
      null,
      "france-hospital",
      "france-hospital",
      "BOAMP-002",
      JSON.stringify({ extractionConfidence: 0.82 }),
      0,
      "2026-04-18T00:00:00+00:00",
      "2026-04-18T00:00:00+00:00",
      now,
    );
  database
    .prepare(`
      INSERT INTO ops_review_decisions (
        queue_id, decision, actor_label, note, created_at
      ) VALUES (?, ?, ?, ?, ?);
    `)
    .run(
      "low-confidence:switzerland-campus",
      "accepted",
      "local_operator",
      "Reviewed against the official brief.",
      "2026-04-20T07:00:00+00:00",
    );

  database.close();

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath,
  };
};

const loadStorageModule = async () => {
  return import(`./index.ts?case=${Date.now()}-${Math.random()}`);
};

test("queryStoredOpportunities filters stored records by jurisdiction and qualification score", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { queryStoredOpportunities } = await loadStorageModule();
    const opportunities = queryStoredOpportunities({
      jurisdiction: "italy",
      licensedArchitectRequired: true,
      minQualificationScore: 0.9,
      limit: 10,
    });

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.id, "italy-library");
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("getStoredFilterOptions returns distinct selectable values from the database", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredFilterOptions } = await loadStorageModule();
    const options = getStoredFilterOptions();

    assert.deepEqual(options.jurisdictions, ["france", "germany", "italy", "switzerland"]);
    assert.deepEqual(options.procedureTypes, [
      "design_contest",
      "maitrise_d_oeuvre_procurement",
      "open",
      "planning_competition",
      "public_design_services_tender",
    ]);
    assert.deepEqual(options.implementationPaths, [
      "service_contract_award_after_competitive_selection",
      "winner_or_winners_progress_to_negotiated_service_award",
    ]);
    assert.deepEqual(options.projectTypes, [
      "urban_regeneration",
      "environment_design",
      "urban_planning",
      "building_project",
    ]);
    assert.deepEqual(options.buildingCategories, [
      "education",
      "healthcare",
      "housing",
      "civic_public",
      "sport_leisure",
      "culture_heritage",
      "transport_infrastructure",
    ]);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("getStoredFilterOptions scopes selectable values to the current discover slice", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredDiscoverSurfaceData, getStoredFilterOptions } = await loadStorageModule();
    const options = getStoredFilterOptions({
      includeExpired: true,
      search: "Cantonal School",
    });
    const discoverData = getStoredDiscoverSurfaceData({
      includeExpired: true,
      limit: 10,
      search: "Cantonal School",
    });

    assert.deepEqual(options.jurisdictions, ["switzerland"]);
    assert.deepEqual(options.procedureTypes, ["planning_competition"]);
    assert.deepEqual(options.implementationPaths, [
      "winner_or_winners_progress_to_negotiated_service_award",
    ]);
    assert.deepEqual(options.projectTypes, ["urban_planning"]);
    assert.deepEqual(options.buildingCategories, ["education"]);

    assert.equal(discoverData.opportunities.length, 1);
    assert.equal(discoverData.opportunities[0]?.id, "switzerland-campus");
    assert.deepEqual(discoverData.filterOptions, options);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpportunityFeed filters stored records by search, recent time window, deadline, and value", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { queryStoredOpportunityFeed } = await loadStorageModule();
    const opportunities = queryStoredOpportunityFeed({
      search: "hospital",
      publishedWithinDays: 30,
      deadlineBefore: "2026-07-31",
      minEstimatedValueEur: 3000000,
      limit: 10,
    });

    assert.equal(opportunities.length, 1);
    assert.equal(opportunities[0]?.id, "france-hospital");
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpportunityFeed exposes complete metadata for the waterfall feed", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { queryStoredOpportunityFeed } = await loadStorageModule();
    const opportunities = queryStoredOpportunityFeed({
      jurisdiction: "switzerland",
      limit: 10,
      sort: "highest_value",
    });

    assert.equal(opportunities.length, 2);
    assert.equal(opportunities[0]?.id, "switzerland-sports");

    const campusOpportunity = opportunities.find((opportunity) => opportunity.id === "switzerland-campus");
    assert.ok(campusOpportunity);
    assert.equal(campusOpportunity.officialNoticeId, "SIMAP-003");
    assert.equal(campusOpportunity.briefPdfUrl, "https://example.com/switzerland/brief.pdf");
    assert.equal(campusOpportunity.projectTypeKey, "urban_planning");
    assert.deepEqual(campusOpportunity.buildingCategories, ["education"]);
    assert.deepEqual(campusOpportunity.cpvCodes, ["71230000"]);
    assert.deepEqual(campusOpportunity.languages, ["de", "fr"]);
    assert.equal(campusOpportunity.estimatedContractValueEur, 980000);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpportunities exposes explicit English labels for normalized canonical keys", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { queryStoredOpportunities } = await loadStorageModule();
    const opportunity = queryStoredOpportunities({ search: "undated framework", limit: 5 })[0];

    assert.ok(opportunity);
    assert.equal(opportunity.opportunityTypeLabel, "Public design services procurement");
    assert.equal(opportunity.procedureTypeLabel, "Open procedure");
    assert.equal(
      opportunity.implementationPathLabel,
      "Service contract award after competitive selection",
    );
    assert.equal(opportunity.evidenceLevelLabel, "Official listing");
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpportunityFeed normalizes legacy procedure_type values before exposing labels", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  const database = new Database(dbPath);
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run("ANNOUNCEMENT_OF_COMPETITION", "germany-undated");
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run("secondary_discovery_listing", "italy-library");
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run('right;">', "switzerland-campus");
  database.close();

  try {
    const { getStoredFilterOptions, queryStoredOpportunityFeed } = await loadStorageModule();
    const opportunities = queryStoredOpportunityFeed({
      includeExpired: true,
      limit: 20,
      sort: "latest",
    });
    const filterOptions = getStoredFilterOptions({ includeExpired: true });

    const germanyUndated = opportunities.find((opportunity) => opportunity.id === "germany-undated");
    const italyLibrary = opportunities.find((opportunity) => opportunity.id === "italy-library");
    const switzerlandCampus = opportunities.find(
      (opportunity) => opportunity.id === "switzerland-campus",
    );

    assert.ok(germanyUndated);
    assert.equal(germanyUndated.procedureTypeKey, "public_design_services_tender");
    assert.equal(germanyUndated.procedureTypeLabel, "Public design services tender");

    assert.ok(italyLibrary);
    assert.equal(italyLibrary.procedureTypeKey, null);
    assert.equal(italyLibrary.procedureTypeLabel, "Procedure pending");

    assert.ok(switzerlandCampus);
    assert.equal(switzerlandCampus.procedureTypeKey, null);
    assert.equal(switzerlandCampus.procedureTypeLabel, "Procedure pending");

    assert.ok(filterOptions.procedureTypes.includes("public_design_services_tender"));
    assert.ok(!filterOptions.procedureTypes.includes("ANNOUNCEMENT_OF_COMPETITION"));
    assert.ok(!filterOptions.procedureTypes.includes("secondary_discovery_listing"));
    assert.ok(!filterOptions.procedureTypes.includes('right;">'));
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpportunityFeed filters legacy procedure aliases through canonical keys", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  const database = new Database(dbPath);
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run("selective", "switzerland-campus");
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run("Procédure Adaptée", "france-hospital");
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run("Procédure Négociée", "france-housing");
  database
    .prepare("UPDATE competitions SET procedure_type = ? WHERE id = ?")
    .run("AD3", "italy-library");
  database.close();

  try {
    const { queryStoredOpportunityFeed } = await loadStorageModule();

    const selective = queryStoredOpportunityFeed({
      procedureType: "selective",
      includeExpired: true,
      limit: 20,
    });
    const adapted = queryStoredOpportunityFeed({
      procedureType: "adapted_procedure",
      includeExpired: true,
      limit: 20,
    });
    const negotiated = queryStoredOpportunityFeed({
      procedureType: "negotiated_procedure",
      includeExpired: true,
      limit: 20,
    });
    const opaqueCode = queryStoredOpportunityFeed({
      procedureType: "AD3",
      includeExpired: true,
      limit: 20,
    });

    assert.deepEqual(selective.map((opportunity) => opportunity.id), ["switzerland-campus"]);
    assert.deepEqual(adapted.map((opportunity) => opportunity.id), ["france-hospital"]);
    assert.deepEqual(negotiated.map((opportunity) => opportunity.id), ["france-housing"]);
    assert.deepEqual(opaqueCode, []);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpportunityFeed filters records by multi-select project types and building categories", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;
  process.env.ARCH_COMPETITION_TODAY = "2026-04-19";

  try {
    const { queryStoredOpportunityFeed } = await loadStorageModule();

    const urbanRegeneration = queryStoredOpportunityFeed({
      projectTypes: ["urban_regeneration"],
      limit: 10,
    });
    assert.deepEqual(urbanRegeneration.map((opportunity) => opportunity.id), ["italy-regeneration"]);

    const planningAndEnvironment = queryStoredOpportunityFeed({
      projectTypes: ["urban_planning", "environment_design"],
      limit: 10,
    });
    assert.deepEqual(planningAndEnvironment.map((opportunity) => opportunity.id), [
      "switzerland-campus",
      "germany-landscape",
      "germany-transport",
    ]);

    const healthcareAndEducation = queryStoredOpportunityFeed({
      buildingCategories: ["education", "healthcare"],
      limit: 10,
    });
    assert.deepEqual(healthcareAndEducation.map((opportunity) => opportunity.id), [
      "switzerland-campus",
      "france-hospital",
    ]);

    const buildingProjects = queryStoredOpportunityFeed({
      projectTypes: ["building_project"],
      buildingCategories: ["housing", "sport_leisure", "culture_heritage"],
      limit: 10,
    });
    assert.deepEqual(buildingProjects.map((opportunity) => opportunity.id), [
      "france-housing",
      "switzerland-sports",
      "italy-heritage",
    ]);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    delete process.env.ARCH_COMPETITION_TODAY;
    cleanup();
  }
});

test("queryStoredOpportunityFeed excludes expired notices by default but keeps undated notices visible", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;
  process.env.ARCH_COMPETITION_TODAY = "2026-04-19";

  try {
    const { queryStoredOpportunityFeed } = await loadStorageModule();
    const opportunities = queryStoredOpportunityFeed({
      sort: "deadline",
      limit: 10,
    });

    assert.deepEqual(
      opportunities.map((opportunity) => opportunity.id),
      [
        "switzerland-campus",
        "italy-regeneration",
        "italy-library",
        "france-hospital",
        "germany-landscape",
        "france-housing",
        "switzerland-sports",
        "italy-heritage",
        "germany-transport",
        "germany-undated",
      ],
    );
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    delete process.env.ARCH_COMPETITION_TODAY;
    cleanup();
  }
});

test("queryStoredOpportunityFeed can include expired notices when explicitly requested", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;
  process.env.ARCH_COMPETITION_TODAY = "2026-04-19";

  try {
    const { queryStoredOpportunityFeed } = await loadStorageModule();
    const opportunities = queryStoredOpportunityFeed({
      includeExpired: true,
      sort: "deadline",
      limit: 20,
    });

    assert.deepEqual(
      opportunities.map((opportunity) => opportunity.id),
      [
        "italy-expired",
        "switzerland-campus",
        "italy-regeneration",
        "italy-library",
        "france-hospital",
        "germany-landscape",
        "france-housing",
        "switzerland-sports",
        "italy-heritage",
        "germany-transport",
        "germany-undated",
      ],
    );
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    delete process.env.ARCH_COMPETITION_TODAY;
    cleanup();
  }
});

test("getStoredOpportunityFeedItemBySlug returns localized-feed fields for detail pages", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredOpportunityFeedItemBySlug } = await loadStorageModule();
    const opportunity = getStoredOpportunityFeedItemBySlug("switzerland-campus");

    assert.equal(opportunity?.statusKey, "discovered");
    assert.equal(opportunity?.jurisdictionKey, "switzerland");
    assert.equal(opportunity?.deadlineAt, "2026-05-12");
    assert.equal(opportunity?.estimatedContractValueEur, 980000);
    assert.equal(opportunity?.projectTypeKey, "urban_planning");
    assert.deepEqual(opportunity?.buildingCategories, ["education"]);
    assert.equal(opportunity?.briefPdfUrl, "https://example.com/switzerland/brief.pdf");
    assert.equal(opportunity?.documentsPortalUrl, "https://example.com/switzerland/documents");
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("storage falls back to raw contract value text when eur normalization is unavailable", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredOpportunityFeedItemBySlug, queryStoredOpportunities } = await loadStorageModule();
    const feedItem = getStoredOpportunityFeedItemBySlug("germany-undated");
    const opportunity = queryStoredOpportunities({ search: "undated framework", limit: 5 })[0];

    assert.equal(feedItem?.estimatedContractValueEur, null);
    assert.equal(feedItem?.estimatedContractValueText, "GBP 1,000,000");
    assert.equal(opportunity?.contractValueLabel, "GBP 1,000,000");
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("getStoredSourceHealth exposes source-level freshness and parser diagnostics", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredSourceHealth } = await loadStorageModule();
    const rows = getStoredSourceHealth();

    assert.equal(rows.length, 2);
    assert.equal(rows[0]?.sourceId, "ted_design_notices");
    assert.equal(rows[0]?.lastStatus, "completed_with_failures");
    assert.equal(rows[0]?.lastParseFailureCount, 3);
    assert.equal(rows[0]?.duplicateGroupCount, 2);
    assert.equal(rows[0]?.maxDuplicateGroupSize, 3);
    assert.equal(rows[0]?.lastError, "Three payloads failed parser validation.");
    assert.equal(rows[1]?.sourceId, "boamp_design_notices");
    assert.equal(rows[1]?.lastParseFailureCount, 0);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("getStoredSourceHealth returns an empty list when diagnostics tables are missing", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-storage-legacy-"));
  const dbPath = path.join(directory, "competitions.sqlite");
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE competitions (
      id TEXT PRIMARY KEY,
      dedup_key TEXT NOT NULL,
      title TEXT NOT NULL,
      organizer TEXT NOT NULL,
      authority_name TEXT,
      official_url TEXT,
      source_url TEXT NOT NULL,
      status TEXT NOT NULL,
      opportunity_type TEXT NOT NULL,
      jurisdiction TEXT,
      procedure_type TEXT,
      official_notice_id TEXT,
      regions TEXT NOT NULL,
      languages TEXT NOT NULL,
      competition_types TEXT NOT NULL,
      audience TEXT NOT NULL,
      cpv_codes TEXT NOT NULL,
      implementation_path TEXT,
      licensed_architect_required INTEGER,
      local_partner_required INTEGER,
      registration_fee_eur REAL,
      submission_fee_eur REAL,
      estimated_contract_value_eur REAL,
      estimated_contract_value_text TEXT,
      prize_summary TEXT,
      deadline_at TEXT,
      eligibility_summary TEXT,
      brief_pdf_url TEXT,
      documents_portal_url TEXT,
      extraction_confidence REAL NOT NULL,
      evidence_level TEXT NOT NULL,
      qualification_score REAL,
      evidence_note TEXT,
      last_verified_at TEXT,
      discovered_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  database.close();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredSourceHealth } = await loadStorageModule();
    assert.deepEqual(getStoredSourceHealth(), []);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    rmSync(directory, { recursive: true, force: true });
  }
});

test("getStoredDuplicatePressureSummary derives review pressure from canonical duplicate keys", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  const database = new Database(dbPath);
  database
    .prepare(`
      INSERT INTO competitions (
        id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
        opportunity_type, jurisdiction, procedure_type, official_notice_id, regions, languages,
        competition_types, audience, cpv_codes, implementation_path, licensed_architect_required,
        local_partner_required, registration_fee_eur, submission_fee_eur, estimated_contract_value_eur,
        estimated_contract_value_text, prize_summary, deadline_at, eligibility_summary, brief_pdf_url,
        documents_portal_url, extraction_confidence, evidence_level, qualification_score, evidence_note,
        last_verified_at, discovered_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "duplicate-a",
      "duplicate-cluster-a",
      "Shared Competition A",
      "TED",
      "Comune Uno",
      "https://example.com/dup-a",
      "https://example.com/dup-a",
      "discovered",
      "public_design_contest",
      "italy",
      "design_contest",
      "TED-100",
      JSON.stringify(["europe", "italy"]),
      JSON.stringify(["en"]),
      JSON.stringify(["architecture"]),
      JSON.stringify(["professionals"]),
      JSON.stringify(["71230000"]),
      "winner_or_winners_progress_to_negotiated_service_award",
      1,
      0,
      0,
      0,
      500000,
      null,
      null,
      "2026-10-01",
      null,
      null,
      null,
      0.8,
      "official_notice",
      0.7,
      null,
      "2026-04-19T00:00:00+00:00",
      "2026-04-19T00:00:00+00:00",
      "2026-04-19T00:00:00+00:00",
    );
  database
    .prepare(`
      INSERT INTO competitions (
        id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
        opportunity_type, jurisdiction, procedure_type, official_notice_id, regions, languages,
        competition_types, audience, cpv_codes, implementation_path, licensed_architect_required,
        local_partner_required, registration_fee_eur, submission_fee_eur, estimated_contract_value_eur,
        estimated_contract_value_text, prize_summary, deadline_at, eligibility_summary, brief_pdf_url,
        documents_portal_url, extraction_confidence, evidence_level, qualification_score, evidence_note,
        last_verified_at, discovered_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      );
    `)
    .run(
      "duplicate-b",
      "duplicate-cluster-a",
      "Shared Competition B",
      "BOAMP",
      "Ville Deux",
      "https://example.com/dup-b",
      "https://example.com/dup-b",
      "discovered",
      "public_design_contest",
      "france",
      "design_contest",
      "BOAMP-100",
      JSON.stringify(["europe", "france"]),
      JSON.stringify(["fr"]),
      JSON.stringify(["architecture"]),
      JSON.stringify(["professionals"]),
      JSON.stringify(["71230000"]),
      "winner_or_winners_progress_to_negotiated_service_award",
      1,
      0,
      0,
      0,
      500000,
      null,
      null,
      "2026-10-01",
      null,
      null,
      null,
      0.8,
      "official_notice",
      0.7,
      null,
      "2026-04-19T00:00:00+00:00",
      "2026-04-19T00:00:00+00:00",
      "2026-04-19T00:00:00+00:00",
    );
  database.close();

  try {
    const { getStoredDuplicatePressureSummary } = await loadStorageModule();
    assert.deepEqual(getStoredDuplicatePressureSummary(), {
      duplicateGroups: 1,
      recordsInDuplicateGroups: 2,
      maxDuplicateGroupSize: 2,
    });
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("getStoredOpsReviewSummary exposes active queue counts and reason-group totals", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { getStoredOpsReviewSummary } = await loadStorageModule();

    assert.deepEqual(getStoredOpsReviewSummary(), {
      total: 4,
      active: 3,
      pending: 2,
      accepted: 1,
      rejected: 0,
      needsFollowUp: 0,
      reasons: [
        { reasonCode: "duplicate_cluster", count: 1 },
        { reasonCode: "low_confidence_record", count: 1 },
        { reasonCode: "source_parse_failures", count: 1 },
      ],
    });
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("queryStoredOpsReviewQueue returns active pending items ordered by status and priority", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { queryStoredOpsReviewQueue } = await loadStorageModule();
    const queue = queryStoredOpsReviewQueue();

    assert.equal(queue.length, 2);
    assert.equal(queue[0]?.queueId, "source-parse-failures:ted_design_notices");
    assert.equal(queue[0]?.payload.lastParseFailureCount, 3);
    assert.equal(queue[1]?.queueId, "duplicate-cluster:italy-library");
    assert.equal(queue[1]?.reasonCode, "duplicate_cluster");
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("writeStoredOpsReviewDecision updates queue status and persists the latest decision", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const {
      getStoredOpsReviewSummary,
      queryStoredOpsReviewQueue,
      writeStoredOpsReviewDecision,
    } = await loadStorageModule();
    const updated = writeStoredOpsReviewDecision({
      queueId: "duplicate-cluster:italy-library",
      decision: "needs_follow_up",
      note: "Need to inspect the paired notices before dedupe.",
    });

    assert.equal(updated.status, "needs_follow_up");
    assert.equal(updated.latestDecision?.decision, "needs_follow_up");
    assert.equal(updated.latestDecision?.actorLabel, "local_operator");
    assert.equal(updated.latestDecision?.note, "Need to inspect the paired notices before dedupe.");

    const queue = queryStoredOpsReviewQueue({ status: "needs_follow_up" });
    assert.equal(queue.length, 1);
    assert.equal(queue[0]?.queueId, "duplicate-cluster:italy-library");

    assert.deepEqual(getStoredOpsReviewSummary(), {
      total: 4,
      active: 3,
      pending: 1,
      accepted: 1,
      rejected: 0,
      needsFollowUp: 1,
      reasons: [
        { reasonCode: "duplicate_cluster", count: 1 },
        { reasonCode: "low_confidence_record", count: 1 },
        { reasonCode: "source_parse_failures", count: 1 },
      ],
    });
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("storage returns empty results instead of demo records when no database is present", async () => {
  process.env.ARCH_COMPETITION_DB_PATH = path.join(tmpdir(), `missing-${Date.now()}.sqlite`);

  try {
    const {
      getStoredOpsReviewSummary,
      getStoredDuplicatePressureSummary,
      getStoredOpportunityBySlug,
      getStoredOpportunityFeedItemBySlug,
      getStoredOpsSnapshot,
      getStoredSourceHealth,
      queryStoredOpsReviewQueue,
      queryStoredOpportunityFeed,
      queryStoredOpportunities,
    } = await loadStorageModule();

    assert.deepEqual(queryStoredOpportunityFeed({ limit: 10 }), []);
    assert.deepEqual(queryStoredOpportunities({ limit: 10 }), []);
    assert.equal(getStoredOpportunityFeedItemBySlug("demo"), undefined);
    assert.equal(getStoredOpportunityBySlug("demo"), undefined);
    assert.deepEqual(getStoredSourceHealth(), []);
    assert.deepEqual(getStoredDuplicatePressureSummary(), {
      duplicateGroups: 0,
      recordsInDuplicateGroups: 0,
      maxDuplicateGroupSize: 0,
    });
    assert.deepEqual(getStoredOpsSnapshot(), {
      total: 0,
      verified: 0,
      primary: 0,
    });
    assert.deepEqual(queryStoredOpsReviewQueue(), []);
    assert.deepEqual(getStoredOpsReviewSummary(), {
      total: 0,
      active: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      needsFollowUp: 0,
      reasons: [],
    });
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
  }
});
