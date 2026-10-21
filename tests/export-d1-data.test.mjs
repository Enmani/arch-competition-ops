import assert from "node:assert/strict";
import test from "node:test";

import { SchemaMismatchError, parseArgs } from "../scripts/export-d1-data.mjs";
import {
  MIGRATIONS_DIR,
  USER_TABLES,
  applyMigrations,
  createLocalDatabase,
  createWorkspace,
  dumpTable,
  executeFiles,
  insertCompetition,
  insertQueueItem,
  runInto,
  seedRemoteUserData,
  seedWorkerData,
} from "./helpers/d1-sync-fixtures.mjs";

import Database from "better-sqlite3";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

test("schema mismatch (missing column, extra column, missing table) fails without writing files", (t) => {
  const cases = [
    {
      label: "missing column",
      mutate: (db) => db.exec("ALTER TABLE competitions DROP COLUMN geo_source"),
      expected: /competitions: local database is missing column\(s\) geo_source/,
    },
    {
      label: "extra column",
      mutate: (db) => db.exec("ALTER TABLE source_health ADD COLUMN surprise TEXT"),
      expected: /source_health: local database has column\(s\) not in migrations surprise/,
    },
    {
      label: "missing table",
      mutate: (db) => db.exec("DROP TABLE source_runs"),
      expected: /source_runs: table is missing from the local database/,
    },
  ];

  for (const { label, mutate, expected } of cases) {
    const workspace = createWorkspace(t);
    createLocalDatabase(workspace.dbPath, (db) => {
      seedWorkerData(db);
      mutate(db);
    });

    assert.throws(
      () => runInto(workspace),
      (error) => error instanceof SchemaMismatchError && expected.test(error.message),
      label,
    );
    assert.equal(existsSync(workspace.outputRoot), false, `${label}: no output directory`);
  }
});

test("a database without schema_migrations bookkeeping passes the schema check", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, seedWorkerData);
  const result = runInto(workspace);
  assert.ok(result.files.length >= 4);
});

test("generated upserts are idempotent and use ON CONFLICT DO UPDATE", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, seedWorkerData);
  const result = runInto(workspace);

  const allSql = result.files.map((file) => file.content).join("");
  assert.match(allSql, /INSERT INTO "competitions" \(.*\) VALUES \(.*\) ON CONFLICT\("id"\) DO UPDATE SET/);
  assert.match(allSql, /INSERT INTO "source_runs" .* ON CONFLICT\("id"\) DO UPDATE SET/);
  assert.match(allSql, /INSERT INTO "source_health" .* ON CONFLICT\("source_id"\) DO UPDATE SET/);
  assert.match(allSql, /INSERT INTO "ops_review_queue_items" .* ON CONFLICT\("queue_id"\) DO UPDATE SET/);
  assert.doesNotMatch(allSql, /^\s*(BEGIN|COMMIT|SAVEPOINT|ROLLBACK|DELETE)\b/im);
  assert.doesNotMatch(allSql, /workspace_|auth_|ops_review_decisions/);

  const remote = applyMigrations(new Database(":memory:"));
  executeFiles(remote, result);
  const afterFirst = {
    competitions: dumpTable(remote, "competitions", "id"),
    source_runs: dumpTable(remote, "source_runs", "id"),
    source_health: dumpTable(remote, "source_health", "source_id"),
    queue: dumpTable(remote, "ops_review_queue_items", "queue_id"),
  };
  executeFiles(remote, result);

  assert.deepEqual(dumpTable(remote, "competitions", "id"), afterFirst.competitions);
  assert.deepEqual(dumpTable(remote, "source_runs", "id"), afterFirst.source_runs);
  assert.deepEqual(dumpTable(remote, "source_health", "source_id"), afterFirst.source_health);
  assert.deepEqual(dumpTable(remote, "ops_review_queue_items", "queue_id"), afterFirst.queue);

  assert.equal(afterFirst.competitions.length, 2);
  assert.equal(afterFirst.source_runs.length, 1);
  assert.equal(afterFirst.source_health.length, 1);
  assert.equal(afterFirst.queue.length, 1, "only the worker_diagnostic queue row is synced");
  assert.equal(afterFirst.competitions[0].title, "It's \"quoted\"; DROP TABLE x;--");
  assert.equal(afterFirst.competitions[1].estimated_contract_value_eur, 1250000.5);
  remote.close();
});

test("an existing remote upsert is updated in place (no duplicate rows, columns refreshed)", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, (db) => {
    insertCompetition(db, "comp-1", { title: "New title", status: "closed" });
  });
  const remote = applyMigrations(new Database(":memory:"));
  insertCompetition(remote, "comp-1", { title: "Old title", status: "open" });

  executeFiles(remote, runInto(workspace));

  const rows = dumpTable(remote, "competitions", "id");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, "New title");
  assert.equal(rows[0].status, "closed");
  remote.close();
});

test("manual review status survives a re-sync; only diagnostic fields are refreshed", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, (db) => {
    insertQueueItem(db, "diag-1", {
      status: "pending",
      title: "Fresh title",
      priority: 9,
      is_active: 0,
      last_detected_at: "2026-05-05T00:00:00Z",
      first_detected_at: "2026-05-01T00:00:00Z",
      updated_at: "2026-05-05T00:00:00Z",
    });
  });
  const remote = applyMigrations(new Database(":memory:"));
  insertQueueItem(remote, "diag-1", {
    status: "resolved",
    title: "Old title",
    priority: 1,
    first_detected_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-02-02T00:00:00Z",
  });

  const result = runInto(workspace);
  executeFiles(remote, result);
  executeFiles(remote, result);

  const [row] = dumpTable(remote, "ops_review_queue_items", "queue_id");
  assert.equal(row.status, "resolved", "human status is preserved");
  assert.equal(row.first_detected_at, "2026-01-01T00:00:00Z");
  assert.equal(row.updated_at, "2026-02-02T00:00:00Z");
  assert.equal(row.title, "Fresh title");
  assert.equal(row.priority, 9);
  assert.equal(row.is_active, 0);
  assert.equal(row.last_detected_at, "2026-05-05T00:00:00Z");
  remote.close();
});

test("a remote queue row with the same id but a non-worker origin is not overwritten", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, (db) => insertQueueItem(db, "shared-id", { title: "Worker title" }));
  const remote = applyMigrations(new Database(":memory:"));
  insertQueueItem(remote, "shared-id", { origin: "submission", title: "Human title" });

  executeFiles(remote, runInto(workspace));

  const [row] = dumpTable(remote, "ops_review_queue_items", "queue_id");
  assert.equal(row.title, "Human title");
  assert.equal(row.origin, "submission");
  remote.close();
});

test("user-owned tables are untouched by a default sync and by --prune", (t) => {
  for (const prune of [false, true]) {
    const workspace = createWorkspace(t);
    createLocalDatabase(workspace.dbPath, seedWorkerData);
    const remote = applyMigrations(new Database(":memory:"));
    seedRemoteUserData(remote);
    const before = USER_TABLES.map(([table, order]) => dumpTable(remote, table, order));
    assert.ok(before.every((rows) => rows.length === 1));

    executeFiles(remote, runInto(workspace, { prune }));

    const after = USER_TABLES.map(([table, order]) => dumpTable(remote, table, order));
    assert.deepEqual(after, before, `prune=${prune}`);
    remote.close();
  }
});

test("--prune is off by default: no prune file and no DELETE statements", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, seedWorkerData);

  assert.equal(parseArgs([]).prune, false);
  const result = runInto(workspace);

  assert.equal(result.manifest.prune, false);
  assert.ok(result.files.every((file) => !file.name.includes("prune")));
  for (const file of result.files) {
    assert.doesNotMatch(file.content, /\bDELETE\b/i);
    assert.doesNotMatch(file.content, /\b(BEGIN|COMMIT|SAVEPOINT|ROLLBACK)\b/i);
  }
});

test("--prune removes remote-only competitions but keeps watched ones, in the last file", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, seedWorkerData);
  assert.equal(parseArgs(["--prune"]).prune, true);

  const result = runInto(workspace, { prune: true });
  const names = result.files.map((file) => file.name);
  assert.equal(names.at(-1), "0099-prune.sql");
  assert.equal(result.manifest.prune, true);
  assert.deepEqual(
    result.files.filter((file) => /\bDELETE\b/.test(file.content)).map((file) => file.name),
    ["0099-prune.sql"],
    "only the prune file may contain DELETE",
  );
  for (const file of result.files) {
    assert.doesNotMatch(file.content, /\b(BEGIN|COMMIT|SAVEPOINT|ROLLBACK)\b/i);
  }

  const remote = applyMigrations(new Database(":memory:"));
  seedRemoteUserData(remote); // comp-watched is watched and absent locally
  insertCompetition(remote, "comp-stale");
  remote.pragma("foreign_keys = ON");

  executeFiles(remote, result);

  const ids = dumpTable(remote, "competitions", "id").map((row) => row.id);
  assert.deepEqual(ids, ["comp-1", "comp-2", "comp-watched"]);
  assert.equal(
    remote.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = '_sync_competition_ids'").get().n,
    0,
    "staging table is dropped",
  );

  // Re-running the whole sequence stays valid (idempotent, e.g. after a partial failure).
  executeFiles(remote, result);
  assert.equal(dumpTable(remote, "competitions", "id").length, 3);
  remote.close();
});

test("--prune refuses to run against an empty local competitions table", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath);
  assert.throws(() => runInto(workspace, { prune: true }), /empty/);
  assert.equal(existsSync(workspace.outputRoot), false);
});

// Value-escaping, batching and CLI cases live in a helper module so each file stays under 500 lines;
// importing it registers them in this same test run.
import "./helpers/d1-sync-format-tests.mjs";
