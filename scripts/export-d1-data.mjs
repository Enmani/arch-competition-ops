// Incremental local SQLite -> Cloudflare D1 sync exporter.
//
// Generates batched, idempotent upsert SQL files for the tables the Python worker owns.
// It NEVER connects to Cloudflare and never runs wrangler; it only writes files and prints the
// commands to run. It never emits DELETE against user data (workspace_*, ops_review_decisions,
// auth_*), and never emits BEGIN/COMMIT/SAVEPOINT (remote D1 import rejects them).
// See CLOUDFLARE_DEPLOY_RUNBOOK.md for the operating procedure.

import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import {
  buildWranglerCommands,
  planFiles,
  utcTimestamp,
  writeExport,
} from "./lib/d1-sync/batching.mjs";
import { findSchemaProblems, loadMigratedColumns, SchemaMismatchError } from "./lib/d1-sync/schema-check.mjs";
import { quoteIdentifier } from "./lib/d1-sync/sql-values.mjs";
import { buildPruneStatements, buildUpsertStatement } from "./lib/d1-sync/statements.mjs";
import {
  DB_PATH_ENV_VAR,
  D1_DATABASE_NAME,
  DEFAULT_DB_RELATIVE_PATH,
  DEFAULT_LIMITS,
  DEFAULT_OUTPUT_RELATIVE_DIR,
  MIGRATIONS_RELATIVE_DIR,
  SYNC_TABLES,
} from "./lib/d1-sync/table-specs.mjs";

export { formatSqlValue, quoteIdentifier, SqlValueError } from "./lib/d1-sync/sql-values.mjs";
export { buildPruneStatements, buildUpsertStatement } from "./lib/d1-sync/statements.mjs";
export { findSchemaProblems, loadMigratedColumns, SchemaMismatchError } from "./lib/d1-sync/schema-check.mjs";
export { buildWranglerCommands, planFiles, splitIntoBatches } from "./lib/d1-sync/batching.mjs";
export { DEFAULT_LIMITS, SYNC_TABLES } from "./lib/d1-sync/table-specs.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const USAGE = `Usage: node scripts/export-d1-data.mjs [--prune] [--out-dir <dir>] [--help]

Writes batched upsert SQL for competitions, source_runs, source_health and worker-owned
ops_review_queue_items to <out-dir>/<UTC timestamp>/ plus manifest.json, and prints the
wrangler commands to run. Nothing is executed against Cloudflare.

  --prune          also delete remote competitions that no longer exist locally
                   (never deletes ones on a user watchlist). Off by default.
  --out-dir <dir>  output root, relative to the repo root (default ${DEFAULT_OUTPUT_RELATIVE_DIR})

Environment:
  ${DB_PATH_ENV_VAR}  local SQLite file, relative to the repo root (default ${DEFAULT_DB_RELATIVE_PATH})
`;

/** Env var only, relative paths resolve against the repo root (same rule as the Python side). */
export function resolveDatabasePath(env = process.env, repoRoot = REPO_ROOT) {
  const configured = env[DB_PATH_ENV_VAR]?.trim();
  return path.resolve(repoRoot, configured || DEFAULT_DB_RELATIVE_PATH);
}

export function parseArgs(argv) {
  const options = { prune: false, outDir: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prune") {
      options.prune = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--out-dir") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--out-dir requires a directory argument");
      }
      options.outDir = value;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function readTableRows(database, spec, columns) {
  const columnList = columns.map(quoteIdentifier).join(", ");
  const where = spec.rowFilter ? ` WHERE ${spec.rowFilter}` : "";
  const order = quoteIdentifier(spec.primaryKey);
  return database
    .prepare(`SELECT ${columnList} FROM ${quoteIdentifier(spec.name)}${where} ORDER BY ${order}`)
    .safeIntegers(true) // keep 64-bit integers exact
    .all();
}

/**
 * Build the whole export in memory, then write it. Throws SchemaMismatchError (nothing
 * written) when the local schema differs from the migrations.
 */
export function runExport({
  dbPath,
  migrationsDir = path.join(REPO_ROOT, MIGRATIONS_RELATIVE_DIR),
  outputRoot = path.join(REPO_ROOT, DEFAULT_OUTPUT_RELATIVE_DIR),
  repoRoot = REPO_ROOT,
  prune = false,
  now = new Date(),
  limits = DEFAULT_LIMITS,
}) {
  const tableNames = SYNC_TABLES.map((spec) => spec.name);
  const { columns: migratedColumns } = loadMigratedColumns(migrationsDir, tableNames);

  const database = new Database(dbPath, { readonly: true, fileMustExist: true });
  let tableStatements;
  let rowCounts;
  let competitionIds = null;
  try {
    const problems = findSchemaProblems(database, migratedColumns);
    if (problems.length > 0) {
      throw new SchemaMismatchError(problems);
    }

    // One read transaction -> a consistent snapshot even if the ingest worker is writing.
    database
      .transaction(() => {
        tableStatements = [];
        rowCounts = {};
        for (const spec of SYNC_TABLES) {
          const columns = migratedColumns.get(spec.name);
          const rows = readTableRows(database, spec, columns);
          rowCounts[spec.name] = rows.length;
          tableStatements.push({
            table: spec.name,
            statements: rows.map((row) => buildUpsertStatement(spec, columns, row)),
          });
        }
        if (prune) {
          competitionIds = database
            .prepare('SELECT "id" FROM "competitions" ORDER BY "id"')
            .all()
            .map((row) => row.id);
        }
      })
      .deferred();
  } finally {
    database.close();
  }

  let pruneStatements = null;
  if (prune) {
    if (competitionIds.length === 0) {
      throw new Error("Refusing --prune: the local competitions table is empty, it would wipe remote data");
    }
    pruneStatements = buildPruneStatements(competitionIds, limits);
  }

  const files = planFiles({ tableStatements, pruneStatements, limits });
  const outputDir = path.join(outputRoot, utcTimestamp(now));
  const wranglerCommands = buildWranglerCommands({ repoRoot, outputDir, files });
  const relativeDb = path.relative(repoRoot, dbPath);
  const manifest = {
    generatedAt: now.toISOString(),
    sourceDatabase: relativeDb.startsWith("..") || path.isAbsolute(relativeDb) ? dbPath : relativeDb,
    d1Database: D1_DATABASE_NAME,
    prune,
    limits,
    tables: Object.fromEntries(
      Object.entries(rowCounts).map(([table, rows]) => [table, { rows }]),
    ),
    pruneStagedCompetitionIds: prune ? competitionIds.length : undefined,
    files: files.map(({ name, table, statements, bytes, sha256 }, index) => ({
      order: index + 1,
      name,
      table,
      statements,
      bytes,
      sha256,
    })),
    wranglerCommands,
  };

  writeExport({ outputDir, files, manifest });
  return { outputDir, manifest, files, wranglerCommands };
}

export function main(argv = process.argv.slice(2), env = process.env, log = console.log) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`${error.message}\n\n${USAGE}`);
    return 1;
  }
  if (options.help) {
    log(USAGE);
    return 0;
  }

  try {
    const result = runExport({
      dbPath: resolveDatabasePath(env),
      outputRoot: options.outDir
        ? path.resolve(REPO_ROOT, options.outDir)
        : path.join(REPO_ROOT, DEFAULT_OUTPUT_RELATIVE_DIR),
      prune: options.prune,
    });
    const { manifest } = result;
    log(`Source database: ${manifest.sourceDatabase}`);
    for (const [table, { rows }] of Object.entries(manifest.tables)) {
      log(`  ${table}: ${rows} row(s)`);
    }
    log(`Wrote ${manifest.files.length} SQL file(s) + manifest.json to ${path.relative(REPO_ROOT, result.outputDir)}`);
    log(options.prune ? "--prune: ENABLED (see runbook before running the last file)" : "--prune: off");
    log("\nBack up first (see runbook), then run in this order. Nothing was executed:\n");
    for (const command of result.wranglerCommands) {
      log(command);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof SchemaMismatchError ? error.message : `export-d1-data failed: ${error.message}`);
    return 1;
  }
}

function isEntrypoint() {
  if (!process.argv[1]) {
    return false;
  }
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntrypoint()) {
  process.exitCode = main();
}
