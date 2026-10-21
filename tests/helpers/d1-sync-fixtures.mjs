import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { runExport } from "../../scripts/export-d1-data.mjs";

/** Shared fixtures for the D1 sync tests (tests/export-d1-data*.test.mjs). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const MIGRATIONS_DIR = path.join(REPO_ROOT, "apps", "web", "migrations");
export const SCRIPT_PATH = path.join(REPO_ROOT, "scripts", "export-d1-data.mjs");
export const NOW = new Date("2026-10-21T03:15:00.123Z");

export function applyMigrations(database) {
  for (const file of readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith(".sql")).sort()) {
    database.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
  }
  return database;
}

export function createWorkspace(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "d1-sync-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return {
    dir,
    dbPath: path.join(dir, "local.sqlite"),
    outputRoot: path.join(dir, "out"),
  };
}

/** A "Python-style" local database: migrated structure, no schema_migrations bookkeeping. */
export function createLocalDatabase(dbPath, seed) {
  const database = applyMigrations(new Database(dbPath));
  try {
    seed?.(database);
  } finally {
    database.close();
  }
}

export function insertCompetition(database, id, overrides = {}) {
  const row = {
    id,
    dedup_key: `dedup-${id}`,
    title: `Title ${id}`,
    organizer: "Org",
    source_url: `https://example.test/${id}`,
    status: "open",
    opportunity_type: "competition",
    regions: "[]",
    languages: "[]",
    competition_types: "[]",
    audience: "[]",
    cpv_codes: "[]",
    extraction_confidence: 0.5,
    evidence_level: "official",
    discovered_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
    ...overrides,
  };
  const names = Object.keys(row);
  database
    .prepare(`INSERT INTO competitions (${names.join(", ")}) VALUES (${names.map((n) => `@${n}`).join(", ")})`)
    .run(row);
}

export function insertQueueItem(database, queueId, overrides = {}) {
  const row = {
    queue_id: queueId,
    origin: "worker_diagnostic",
    reason_code: "missing_deadline",
    status: "pending",
    priority: 1,
    title: `Queue ${queueId}`,
    summary: "summary",
    first_detected_at: "2026-01-01T00:00:00Z",
    last_detected_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
  const names = Object.keys(row);
  database
    .prepare(
      `INSERT INTO ops_review_queue_items (${names.join(", ")}) VALUES (${names.map((n) => `@${n}`).join(", ")})`,
    )
    .run(row);
}

export function seedWorkerData(database) {
  insertCompetition(database, "comp-1", { title: "It's \"quoted\"; DROP TABLE x;--" });
  insertCompetition(database, "comp-2", { estimated_contract_value_eur: 1250000.5, jurisdiction: "IT" });
  database
    .prepare(
      `INSERT INTO source_health (source_id, source_name, source_kind, source_tier, last_status, updated_at)
       VALUES ('src-a', 'Source A', 'portal', 'tier1', 'ok', '2026-01-02T00:00:00Z')`,
    )
    .run();
  database
    .prepare(
      `INSERT INTO source_runs (source_id, source_name, source_kind, source_tier, status, started_at)
       VALUES ('src-a', 'Source A', 'portal', 'tier1', 'ok', '2026-01-02T00:00:00Z')`,
    )
    .run();
  insertQueueItem(database, "diag-1");
  insertQueueItem(database, "sub-1", { origin: "submission", title: "User submitted" });
}

export function runInto(workspace, options = {}) {
  return runExport({
    dbPath: workspace.dbPath,
    outputRoot: workspace.outputRoot,
    migrationsDir: MIGRATIONS_DIR,
    now: NOW,
    ...options,
  });
}

export function executeFiles(database, result) {
  for (const file of result.files) {
    database.exec(file.content);
  }
}

export function dumpTable(database, table, orderBy) {
  return database.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
}

export const USER_TABLES = [
  ["workspace_saved_searches", "id"],
  ["workspace_watchlist_entries", "id"],
  ["ops_review_decisions", "id"],
  ["auth_users", "id"],
  ["auth_sessions", "token_hash"],
];

export function seedRemoteUserData(remote) {
  insertCompetition(remote, "comp-watched");
  insertQueueItem(remote, "diag-1", { status: "resolved" });
  remote
    .prepare(
      `INSERT INTO workspace_saved_searches (workspace_key, name, filters_json, created_at, updated_at)
       VALUES ('ws1', 'My search', '{}', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
    )
    .run();
  remote
    .prepare(
      `INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at, updated_at)
       VALUES ('ws1', 'comp-watched', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
    )
    .run();
  remote
    .prepare(
      `INSERT INTO ops_review_decisions (queue_id, decision, actor_label, created_at)
       VALUES ('diag-1', 'accepted', 'alice', '2026-02-02T00:00:00Z')`,
    )
    .run();
  remote
    .prepare(
      `INSERT INTO auth_users (id, email, password_hash, created_at, updated_at)
       VALUES ('u1', 'a@example.test', 'hash', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')`,
    )
    .run();
  remote
    .prepare(
      `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
       VALUES ('tok', 'u1', '2026-02-01T00:00:00Z', '2026-03-01T00:00:00Z')`,
    )
    .run();
}
