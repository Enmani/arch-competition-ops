import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

const createTempDb = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-watchlists-"));
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

    CREATE TABLE workspace_saved_searches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_key TEXT NOT NULL,
      name TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE workspace_watchlist_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace_key TEXT NOT NULL,
      opportunity_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(workspace_key, opportunity_id)
    );
  `);

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
      "2026-04-18T00:00:00+00:00",
      "2026-04-18T00:00:00+00:00",
      "2026-04-19T00:00:00+00:00",
    );
  database.close();

  return {
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
    dbPath,
  };
};

const loadStorageModule = async () => import(`./index.ts?watchlists=${Date.now()}-${Math.random()}`);

test("saved searches persist canonical filters and can be deleted", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const {
      createStoredSavedSearch,
      deleteStoredSavedSearch,
      queryStoredSavedSearches,
    } = await loadStorageModule();

    const savedSearch = createStoredSavedSearch({
      workspaceKey: "local_practice",
      name: "Italy education watch",
      filters: {
        search: "  italy  ",
        projectTypes: ["building_project", "building_project"],
        buildingCategories: ["education", "education"],
        sort: "latest",
        limit: 999,
      },
    });

    assert.equal(savedSearch.workspaceKey, "local_practice");
    assert.equal(savedSearch.name, "Italy education watch");
    assert.deepEqual(savedSearch.filters, {
      search: "italy",
      projectTypes: ["building_project"],
      buildingCategories: ["education"],
      sort: "latest",
    });

    assert.deepEqual(queryStoredSavedSearches({ workspaceKey: "local_practice" }), [savedSearch]);
    assert.equal(
      deleteStoredSavedSearch({
        id: savedSearch.id,
        workspaceKey: "local_practice",
      }),
      true,
    );
    assert.deepEqual(queryStoredSavedSearches({ workspaceKey: "local_practice" }), []);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("saved searches do not duplicate identical workspace requests", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { createStoredSavedSearch, queryStoredSavedSearches } = await loadStorageModule();

    const firstSavedSearch = createStoredSavedSearch({
      workspaceKey: "local_practice",
      name: "Germany watch",
      filters: {
        jurisdiction: "germany",
        sort: "deadline",
      },
    });
    const secondSavedSearch = createStoredSavedSearch({
      workspaceKey: "local_practice",
      name: "Germany watch",
      filters: {
        jurisdiction: "germany",
        sort: "deadline",
      },
    });

    assert.equal(secondSavedSearch.id, firstSavedSearch.id);
    assert.deepEqual(queryStoredSavedSearches({ workspaceKey: "local_practice" }).length, 1);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("watchlist entries can be created, queried, and removed without duplication", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const {
      createStoredWatchlistEntry,
      deleteStoredWatchlistEntry,
      isStoredOpportunityWatched,
      listStoredWatchedOpportunityIds,
      queryStoredWatchlistEntries,
    } = await loadStorageModule();

    const firstEntry = createStoredWatchlistEntry({
      workspaceKey: "local_practice",
      opportunityId: "italy-library",
    });
    const secondEntry = createStoredWatchlistEntry({
      workspaceKey: "local_practice",
      opportunityId: "italy-library",
    });

    assert.equal(firstEntry.opportunityId, "italy-library");
    assert.equal(secondEntry.opportunityId, "italy-library");
    assert.equal(queryStoredWatchlistEntries({ workspaceKey: "local_practice" }).length, 1);
    assert.deepEqual(listStoredWatchedOpportunityIds("local_practice"), ["italy-library"]);
    assert.equal(
      isStoredOpportunityWatched({
        workspaceKey: "local_practice",
        opportunityId: "italy-library",
      }),
      true,
    );

    assert.equal(
      deleteStoredWatchlistEntry({
        workspaceKey: "local_practice",
        opportunityId: "italy-library",
      }),
      true,
    );
    assert.deepEqual(queryStoredWatchlistEntries({ workspaceKey: "local_practice" }), []);
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});

test("watchlist writes reject unknown opportunity ids", async () => {
  const { dbPath, cleanup } = createTempDb();
  process.env.ARCH_COMPETITION_DB_PATH = dbPath;

  try {
    const { createStoredWatchlistEntry } = await loadStorageModule();

    assert.throws(
      () =>
        createStoredWatchlistEntry({
          workspaceKey: "local_practice",
          opportunityId: "missing-opportunity",
        }),
      /Unknown opportunity id/,
    );
  } finally {
    delete process.env.ARCH_COMPETITION_DB_PATH;
    cleanup();
  }
});
