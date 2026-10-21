import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import {
  DEFAULT_LIMITS,
  SqlValueError,
  buildWranglerCommands,
  formatSqlValue,
  parseArgs,
  resolveDatabasePath,
  runExport,
  splitIntoBatches,
} from "../../scripts/export-d1-data.mjs";
import {
  MIGRATIONS_DIR,
  NOW,
  REPO_ROOT,
  SCRIPT_PATH,
  applyMigrations,
  createLocalDatabase,
  createWorkspace,
  executeFiles,
  insertCompetition,
  insertQueueItem,
  runInto,
  seedWorkerData,
} from "./d1-sync-fixtures.mjs";

test("non-finite numbers fail with table, key and column and write nothing", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, (db) => {
    insertCompetition(db, "comp-inf");
    db.exec("UPDATE competitions SET estimated_contract_value_eur = 9e999 WHERE id = 'comp-inf'");
  });

  assert.throws(
    () => runInto(workspace),
    (error) =>
      error instanceof SqlValueError &&
      error.message.includes("competitions[comp-inf].estimated_contract_value_eur"),
  );
  assert.equal(existsSync(workspace.outputRoot), false);

  const context = { table: "t", key: "k", column: "c" };
  assert.throws(() => formatSqlValue(Number.NaN, context), /t\[k\]\.c/);
  assert.throws(() => formatSqlValue(Number.NEGATIVE_INFINITY, context), SqlValueError);
});

test("formatSqlValue escapes and encodes every supported type", () => {
  const context = { table: "t", key: "k", column: "c" };
  assert.equal(formatSqlValue("a'b''c", context), "'a''b''''c'");
  assert.equal(formatSqlValue(null, context), "NULL");
  assert.equal(formatSqlValue(undefined, context), "NULL");
  assert.equal(formatSqlValue(true, context), "1");
  assert.equal(formatSqlValue(false, context), "0");
  assert.equal(formatSqlValue(42, context), "42");
  assert.equal(formatSqlValue(-1.5, context), "-1.5");
  assert.equal(formatSqlValue(9007199254740993n, context), "9007199254740993");
  assert.equal(formatSqlValue(Buffer.from([0, 255, 16]), context), "X'00ff10'");
  assert.equal(formatSqlValue(new Uint8Array([1, 2]), context), "X'0102'");
  assert.throws(() => formatSqlValue("bad\u0000text", context), /NUL/);
  assert.throws(() => formatSqlValue({}, context), SqlValueError);
});

test("64-bit integers survive the round trip", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, (db) => {
    insertCompetition(db, "comp-big");
    db.exec("UPDATE competitions SET registration_fee_eur = 1.25 WHERE id = 'comp-big'");
    db.exec(
      `INSERT INTO source_runs (id, source_id, source_name, source_kind, source_tier, status, started_at, document_count)
       VALUES (9007199254740993, 's', 'S', 'portal', 't', 'ok', '2026-01-01T00:00:00Z', 7)`,
    );
  });
  const remote = applyMigrations(new Database(":memory:"));
  executeFiles(remote, runInto(workspace));
  remote.defaultSafeIntegers(true);
  const row = remote.prepare("SELECT id, document_count FROM source_runs").get();
  assert.equal(row.id, 9007199254740993n);
  assert.equal(row.document_count, 7n);
  remote.close();
});

test("batching honours the statement-count, byte and single-statement limits", (t) => {
  const workspace = createWorkspace(t);
  createLocalDatabase(workspace.dbPath, (db) => {
    for (let index = 0; index < 5; index += 1) {
      insertCompetition(db, `comp-${index}`);
    }
  });

  const byCount = runInto(workspace, { limits: { ...DEFAULT_LIMITS, maxStatementsPerFile: 2 } });
  const competitionFiles = byCount.files.filter((file) => file.table === "competitions");
  assert.deepEqual(competitionFiles.map((file) => file.statements), [2, 2, 1]);
  assert.deepEqual(
    byCount.files.map((file) => file.name.slice(0, 5)),
    byCount.files.map((_, index) => `${String(index + 1).padStart(4, "0")}-`),
  );
  assert.ok(byCount.files.every((file) => file.statements <= 2));
  const manifest = JSON.parse(readFileSync(path.join(byCount.outputDir, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.files.map((file) => file.name), byCount.files.map((file) => file.name));
  assert.equal(manifest.tables.competitions.rows, 5);
  assert.ok(manifest.files.every((file) => file.bytes > 0 && file.statements > 0));
  for (const file of byCount.files) {
    assert.equal(readFileSync(path.join(byCount.outputDir, file.name), "utf8"), file.content);
  }

  const statements = Array.from({ length: 6 }, () => `INSERT INTO t VALUES ('${"x".repeat(100)}');`);
  const byBytes = splitIntoBatches("t", statements, {
    maxStatementsPerFile: 500,
    maxFileBytes: 350,
    maxStatementBytes: 90 * 1024,
  });
  assert.deepEqual(byBytes.map((batch) => batch.length), [2, 2, 2]);

  assert.throws(
    () => splitIntoBatches("t", ["INSERT INTO t VALUES ('" + "x".repeat(200) + "');"], {
      ...DEFAULT_LIMITS,
      maxStatementBytes: 100,
    }),
    /single statement/,
  );
});

test("wrangler commands list every file in order, relative to apps/web", () => {
  const commands = buildWranglerCommands({
    repoRoot: REPO_ROOT,
    outputDir: path.join(REPO_ROOT, "artifacts", "d1-sync", "stamp"),
    files: [{ name: "0001-competitions.sql" }, { name: "0099-prune.sql" }],
  });
  assert.deepEqual(commands, [
    "npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-sync/stamp/0001-competitions.sql",
    "npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-sync/stamp/0099-prune.sql",
  ]);
});

test("database path comes only from ARCH_COMPETITION_OPS_DB, relative to the repo root", () => {
  assert.equal(resolveDatabasePath({}, "/repo"), path.resolve("/repo", "data/competitions.sqlite"));
  assert.equal(
    resolveDatabasePath({ ARCH_COMPETITION_OPS_DB: "data/other.sqlite" }, "/repo"),
    path.resolve("/repo", "data/other.sqlite"),
  );
  assert.equal(
    resolveDatabasePath({ ARCH_COMPETITION_DB_PATH: "/legacy.sqlite" }, "/repo"),
    path.resolve("/repo", "data/competitions.sqlite"),
    "the deprecated variable is ignored",
  );
  for (const file of ["scripts/export-d1-data.mjs", "scripts/lib/d1-sync/table-specs.mjs"]) {
    assert.doesNotMatch(readFileSync(path.join(REPO_ROOT, file), "utf8"), /ARCH_COMPETITION_DB_PATH/);
  }
});

test("CLI: exits 0 with commands on success, exits 1 and writes nothing on schema mismatch", (t) => {
  const good = createWorkspace(t);
  createLocalDatabase(good.dbPath, seedWorkerData);
  const env = { ...process.env, ARCH_COMPETITION_OPS_DB: good.dbPath, ARCH_COMPETITION_DB_PATH: "C:/does/not/exist.sqlite" };
  const ok = spawnSync(process.execPath, [SCRIPT_PATH, "--out-dir", good.outputRoot], { env, encoding: "utf8" });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stdout, /wrangler d1 execute arch-competition-ops --remote --file/);
  assert.match(ok.stdout, /--prune: off/);
  const [stamp] = readdirSync(good.outputRoot);
  assert.ok(existsSync(path.join(good.outputRoot, stamp, "manifest.json")));

  const bad = createWorkspace(t);
  createLocalDatabase(bad.dbPath, (db) => db.exec("ALTER TABLE source_health ADD COLUMN surprise TEXT"));
  const failed = spawnSync(process.execPath, [SCRIPT_PATH, "--out-dir", bad.outputRoot], {
    env: { ...env, ARCH_COMPETITION_OPS_DB: bad.dbPath },
    encoding: "utf8",
  });
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /surprise/);
  assert.equal(existsSync(bad.outputRoot), false);
});
