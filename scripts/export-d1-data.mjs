// Incremental local SQLite -> Cloudflare D1 sync exporter.
//
// Generates batched upserts for worker-owned tables, bracketed by discover publication files.
// It NEVER connects to Cloudflare and never runs wrangler; it only writes files and prints the
// commands to run, unless --apply is given: then it runs them through lib/wrangler.mjs, in order,
// stopping at the first failure. It never emits DELETE against user data (workspace_*,
// ops_review_decisions, auth_*), and never emits BEGIN/COMMIT/SAVEPOINT (remote D1 import rejects them).
// See CLOUDFLARE_DEPLOY_RUNBOOK.md for the operating procedure.

import { randomUUID } from "node:crypto";
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
import { ApplyError, applyExport, prepareApply } from "./lib/d1-sync/apply.mjs";
import { buildPublicationFiles } from "./lib/d1-sync/publication.mjs";
import { buildRetentionStatements } from "./lib/d1-sync/retention.mjs";
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

export const USAGE = `Usage: node scripts/export-d1-data.mjs [--prune] [--retention] [--apply] [--out-dir <dir>] [--help]

Writes batched upsert SQL for competitions, source_runs, source_health, ai_screening_results and
worker-owned ops_review_queue_items to <out-dir>/<UTC timestamp>/ plus manifest.json, with a syncing
marker first and a discover summary publication last. Prints the wrangler commands to run. Without --apply nothing is executed against Cloudflare.

  --prune          also delete remote competitions that no longer exist locally
                   (never deletes ones on a user watchlist). Off by default.
  --retention      add 0090-retention.sql: delete remote competitions whose deadline is more than
                   7 days past, or whose current AI assessment is exclude (older than 7 days, not
                   shortlisted/verified). Keeps watchlisted records and removes expired anonymous
                   MCP counters. Signed-in user data stays outside this cleanup.
  --apply          after writing, run every file against remote D1 in order (stops at the first
                   failure) and print row counts. Implies --retention. Needs CLOUDFLARE_API_TOKEN
                   and CLOUDFLARE_ACCOUNT_ID.
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
  const options = { prune: false, retention: false, apply: false, outDir: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prune") {
      options.prune = true;
    } else if (arg === "--retention") {
      options.retention = true;
    } else if (arg === "--apply") {
      options.apply = true;
      options.retention = true;
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
  retention = false,
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

  const retentionStatements = retention ? buildRetentionStatements(now) : null;
  const publication = buildPublicationFiles(randomUUID());
  const files = planFiles({ tableStatements, retentionStatements, pruneStatements, limits, publication });
  const outputDir = path.join(outputRoot, utcTimestamp(now));
  const wranglerCommands = buildWranglerCommands({ repoRoot, outputDir, files });
  const relativeDb = path.relative(repoRoot, dbPath);
  const manifest = {
    generatedAt: now.toISOString(),
    sourceDatabase: relativeDb.startsWith("..") || path.isAbsolute(relativeDb) ? dbPath : relativeDb,
    d1Database: D1_DATABASE_NAME,
    prune,
    retention,
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
    // Fail before writing anything when --apply cannot run.
    const wrangler = options.apply ? prepareApply(env, REPO_ROOT) : null;
    const result = runExport({
      dbPath: resolveDatabasePath(env),
      outputRoot: options.outDir
        ? path.resolve(REPO_ROOT, options.outDir)
        : path.join(REPO_ROOT, DEFAULT_OUTPUT_RELATIVE_DIR),
      prune: options.prune,
      retention: options.retention,
    });
    const { manifest } = result;
    log(`Source database: ${manifest.sourceDatabase}`);
    for (const [table, { rows }] of Object.entries(manifest.tables)) {
      log(`  ${table}: ${rows} row(s)`);
    }
    log(`Wrote ${manifest.files.length} SQL file(s) + manifest.json to ${path.relative(REPO_ROOT, result.outputDir)}`);
    log(options.prune ? "--prune: ENABLED (see runbook before running 0099-prune.sql)" : "--prune: off");
    log(options.retention ? "--retention: ENABLED (0090-retention.sql)" : "--retention: off");
    if (options.apply) {
      log("\nApplying to remote D1 in order:\n");
      applyExport({
        wrangler,
        env,
        repoRoot: REPO_ROOT,
        outputDir: result.outputDir,
        files: result.files,
        manifest,
        log,
      });
      return 0;
    }
    log("\nBack up first (see runbook), then run in this order. Nothing was executed:\n");
    for (const command of result.wranglerCommands) {
      log(command);
    }
    return 0;
  } catch (error) {
    const plain = error instanceof SchemaMismatchError || error instanceof ApplyError;
    console.error(plain ? error.message : `export-d1-data failed: ${error.message}`);
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
