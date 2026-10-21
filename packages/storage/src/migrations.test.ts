import assert from "node:assert/strict";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { silentLogger } from "@arch-competition/core";

import { applyPendingMigrations, readMigrationFiles, splitSqlStatements } from "./node/migrations";
import { findRepoRoot, resolveMigrationsDirectory } from "./node/paths";
import { openLocalStorage } from "./node";

const migrationsDirectory = resolveMigrationsDirectory();

const withTempDirectory = (run: (directory: string) => void | Promise<void>) => async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-migrations-"));
  try {
    await run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
};

const schemaOf = (connection: Database.Database) =>
  connection
    .prepare("SELECT type, name, tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name != 'schema_migrations' ORDER BY type, name")
    .all();

const columnsOf = (connection: Database.Database, table: string) =>
  (connection.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).map((row) => row.name).sort();

/**
 * Builds a database exactly like the Python worker's ensure_schema does: from its SCHEMA_SQL.
 * The worker keeps the constant somewhere under storage/ (it was database.py, now schema.py), so
 * search the package instead of hard-coding one file name.
 */
const readPythonSchemaSql = () => {
  const storageDirectory = path.join(findRepoRoot(), "apps", "worker", "src", "arch_competition_ops", "storage");
  const candidates = [
    path.join(storageDirectory, "..", "storage.py"),
    ...readdirSync(storageDirectory)
      .filter((name) => name.endsWith(".py"))
      .map((name) => path.join(storageDirectory, name)),
  ].filter((file) => existsSync(file));
  for (const file of candidates) {
    const match = /SCHEMA_SQL = """([\s\S]*?)"""/.exec(readFileSync(file, "utf8"));
    if (match) {
      return match[1];
    }
  }
  assert.fail("could not locate a triple-quoted SCHEMA_SQL literal in the worker storage package");
};

test("migration files split into plain statements (no semicolons inside strings or comments)", () => {
  const files = readMigrationFiles(migrationsDirectory);
  assert.ok(files.length >= 5);
  for (const file of files) {
    const direct = new Database(":memory:");
    const split = new Database(":memory:");
    try {
      // Applying all earlier files first keeps ALTERs valid; compare the schema the two ways produce.
      for (const earlier of files.slice(0, files.indexOf(file))) {
        direct.exec(readFileSync(path.join(migrationsDirectory, earlier.name), "utf8"));
        for (const statement of earlier.statements) split.exec(statement);
      }
      direct.exec(readFileSync(path.join(migrationsDirectory, file.name), "utf8"));
      for (const statement of file.statements) split.exec(statement);
      assert.deepEqual(schemaOf(split), schemaOf(direct), file.name);
    } finally {
      direct.close();
      split.close();
    }
  }
});

test("splitSqlStatements strips comments (including semicolons inside them) and keeps quoted dashes", () => {
  assert.deepEqual(
    splitSqlStatements("-- note; with semicolon\nSELECT 1; -- trailing; comment\nSELECT '--kept' AS v;\n"),
    ["SELECT 1", "SELECT '--kept' AS v"],
  );
});

test("migrations build the full schema on an empty database and are recorded once", () => {
  const connection = new Database(":memory:");
  const report = applyPendingMigrations(connection, migrationsDirectory, silentLogger);
  assert.equal(report.applied.length, readdirSync(migrationsDirectory).filter((name) => name.endsWith(".sql")).length);

  for (const table of ["competitions", "source_runs", "source_health", "ops_review_queue_items", "ops_review_decisions", "workspace_saved_searches", "workspace_watchlist_entries", "auth_users", "auth_sessions", "auth_attempts"]) {
    assert.ok(columnsOf(connection, table).length > 0, `${table} missing`);
  }
  assert.ok(columnsOf(connection, "competitions").includes("source_name"));
  assert.ok(columnsOf(connection, "competitions").includes("geo_lat"));

  const again = applyPendingMigrations(connection, migrationsDirectory, silentLogger);
  assert.deepEqual(again, { applied: [], skippedColumns: [] });
  connection.close();
});

test("applying migrations to a database the Python worker created only adds what is missing", () => {
  const connection = new Database(":memory:");
  connection.exec(readPythonSchemaSql());
  const before = columnsOf(connection, "competitions");

  const report = applyPendingMigrations(connection, migrationsDirectory, silentLogger);
  assert.ok(report.skippedColumns.includes("competitions.geo_lat"));
  assert.ok(report.skippedColumns.includes("competitions.project_types"));
  // Columns that the worker schema does not have yet are added; existing ones are untouched.
  const after = columnsOf(connection, "competitions");
  for (const column of before) {
    assert.ok(after.includes(column));
  }
  assert.ok(after.includes("source_id") && after.includes("source_name"));
  assert.ok(columnsOf(connection, "auth_attempts").length > 0);
  connection.close();
});

test("a worker-created database with existing rows keeps its data through the migrations", () => {
  const connection = new Database(":memory:");
  connection.exec(readPythonSchemaSql());
  connection
    .prepare(
      `INSERT INTO competitions (id, dedup_key, title, organizer, source_url, status, opportunity_type, regions, languages, competition_types, audience, cpv_codes, extraction_confidence, evidence_level, discovered_at, updated_at)
       VALUES ('keep', 'k', 'Kept title', 'ANAC', 'https://x.example', 'discovered', 'public_design_contest', '[]', '[]', '[]', '[]', '[]', 0.8, 'official_notice', 'd', 'u')`,
    )
    .run();

  applyPendingMigrations(connection, migrationsDirectory, silentLogger);
  const row = connection.prepare("SELECT title, source_id, source_name FROM competitions WHERE id = 'keep'").get();
  assert.deepEqual(row, { source_id: null, source_name: null, title: "Kept title" });
  connection.close();
});

test("0005 removes duplicate saved searches (keeping the most recently updated), clears old sessions and enforces uniqueness", withTempDirectory((directory) => {
  const staged = path.join(directory, "migrations");
  mkdirSync(staged);
  for (const name of readdirSync(migrationsDirectory)) {
    if (name < "0005") cpSync(path.join(migrationsDirectory, name), path.join(staged, name));
  }

  const connection = new Database(":memory:");
  applyPendingMigrations(connection, staged, silentLogger);
  const insert = connection.prepare(
    "INSERT INTO workspace_saved_searches (workspace_key, name, filters_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  );
  insert.run("user:a", "old", '{"jurisdiction":"italy"}', "2026-01-01", "2026-01-01");
  insert.run("user:a", "newest", '{"jurisdiction":"italy"}', "2026-01-02", "2026-03-01");
  insert.run("user:a", "tie-low-id", '{"jurisdiction":"france"}', "2026-01-02", "2026-02-01");
  insert.run("user:a", "tie-high-id", '{"jurisdiction":"france"}', "2026-01-02", "2026-02-01");
  insert.run("user:b", "other-workspace", '{"jurisdiction":"italy"}', "2026-01-01", "2026-01-01");
  connection.prepare("INSERT INTO auth_users (id, email, password_hash, created_at, updated_at) VALUES ('u', 'u@example.com', 'x', 'x', 'x')").run();
  connection.prepare("INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at) VALUES ('legacy', 'u', 'x', '2999-01-01')").run();

  cpSync(path.join(migrationsDirectory, readdirSync(migrationsDirectory).find((name) => name.startsWith("0005")) as string), path.join(staged, "0005_auth_attempts_and_saved_search_uniqueness.sql"));
  applyPendingMigrations(connection, staged, silentLogger);

  const names = (connection.prepare("SELECT name FROM workspace_saved_searches ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names, ["newest", "other-workspace", "tie-high-id"]);
  assert.equal((connection.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get() as { total: number }).total, 0);
  assert.throws(() => insert.run("user:a", "dupe", '{"jurisdiction":"italy"}', "x", "x"), /UNIQUE/);
  connection.close();
}));

test("openLocalStorage migrates a worker-created file on first use and is idempotent on reopen", withTempDirectory((directory) => {
  const databasePath = path.join(directory, "competitions.sqlite");
  const seed = new Database(databasePath);
  seed.exec(readPythonSchemaSql());
  seed.close();

  openLocalStorage({ databasePath, logger: silentLogger }).close();
  openLocalStorage({ databasePath, logger: silentLogger }).close();

  const connection = new Database(databasePath, { readonly: true });
  assert.equal((connection.prepare("SELECT COUNT(*) AS total FROM schema_migrations").get() as { total: number }).total, readMigrationFiles(migrationsDirectory).length);
  assert.ok(columnsOf(connection, "competitions").includes("source_name"));
  connection.close();
  assert.ok(existsSync(databasePath));
}));

test("the migration set is the only schema source: tables created by hand are not needed anywhere in src", () => {
  const sourceFiles = readdirSync(path.join(findRepoRoot(), "packages", "storage", "src"), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts"))
    .map((entry) => path.join(entry.parentPath, entry.name));
  for (const file of sourceFiles) {
    const text = readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => !/^\s*(\*|\/\/|\/\*)/.test(line))
      .join("\n");
    assert.ok(!/CREATE TABLE (?!IF NOT EXISTS schema_migrations)/i.test(text), `${file} contains a handwritten CREATE TABLE`);
    assert.ok(!/PRAGMA table_info/i.test(text) || file.endsWith("migrations.ts"), `${file} probes the schema at runtime`);
  }
});
