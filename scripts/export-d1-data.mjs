// Incremental local SQLite -> Cloudflare D1 sync exporter.
//
// Generates batched, idempotent upsert SQL files for the tables the Python worker owns.
// Incremental by watermark: each table re-sends only rows whose change signal (see
// table-specs.mjs) is newer than the watermark stored in data/d1-sync-state.json (minus a
// 5-minute overlap), so a quiet day costs a handful of D1 reads instead of a full-table
// re-upload. A full sync runs when --full is given, when no trustworthy state exists, or
// when the last full sync is over 7 days old. Watermarks advance only after --apply, and
// only for tables whose data files were all applied.
// It NEVER connects to Cloudflare and never runs wrangler; it only writes files and prints the
// commands to run, unless --apply is given: then it runs them through lib/wrangler.mjs, in order,
// stopping at the first failure. It never emits DELETE against user data (workspace_*,
// ops_review_decisions, auth_*), and never emits BEGIN/COMMIT/SAVEPOINT (remote D1 import rejects them).
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
import { ApplyError, applyExport, prepareApply } from "./lib/d1-sync/apply.mjs";
import { buildRetentionStatements } from "./lib/d1-sync/retention.mjs";
import { findSchemaProblems, loadMigratedColumns, SchemaMismatchError } from "./lib/d1-sync/schema-check.mjs";
import { quoteIdentifier } from "./lib/d1-sync/sql-values.mjs";
import { buildPruneStatements, buildUpsertStatement } from "./lib/d1-sync/statements.mjs";
import {
  emptySyncState,
  fullSyncDue,
  loadSyncState,
  saveSyncState,
  SYNC_OVERLAP_MINUTES,
  syncStatePathFor,
  watermarkCutoffIso,
} from "./lib/d1-sync/sync-state.mjs";
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
export { tablesFullyApplied } from "./lib/d1-sync/apply.mjs";
export {
  emptySyncState,
  loadSyncState,
  parseWatermark,
  saveSyncState,
  syncStatePathFor,
  watermarkCutoffIso,
} from "./lib/d1-sync/sync-state.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const USAGE = `Usage: node scripts/export-d1-data.mjs [--prune] [--retention] [--apply] [--full] [--out-dir <dir>] [--help]

Writes batched upsert SQL for competitions, source_runs, source_health, ai_screening_results and
worker-owned ops_review_queue_items to <out-dir>/<UTC timestamp>/ plus manifest.json, and prints the
wrangler commands to run. Without --apply nothing is executed against Cloudflare.

By default the export is incremental: only rows changed since the watermark in
data/d1-sync-state.json are written (see manifest.json "sync"). The watermarks advance only
after a successful --apply, per fully applied table; a dry run never touches the state file.

  --prune          also delete remote competitions that no longer exist locally
                   (never deletes ones on a user watchlist). Off by default.
  --retention      add 0090-retention.sql: delete remote competitions whose deadline is more than
                   7 days past, or whose current AI assessment is exclude (older than 7 days, not
                   shortlisted/verified). Never deletes watchlisted ones or touches user tables.
  --apply          after writing, run every file against remote D1 in order (stops at the first
                   failure) and print row counts. Implies --retention. Needs CLOUDFLARE_API_TOKEN
                   and CLOUDFLARE_ACCOUNT_ID.
  --full           export every row, ignoring the watermarks. A full export also runs
                   automatically when there is no usable sync state or the last full sync
                   completed more than 7 days ago.
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
  const options = { prune: false, retention: false, apply: false, full: false, outDir: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--prune") {
      options.prune = true;
    } else if (arg === "--retention") {
      options.retention = true;
    } else if (arg === "--apply") {
      options.apply = true;
      options.retention = true;
    } else if (arg === "--full") {
      options.full = true;
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

function readTableRows(database, spec, columns, cutoffIso = null) {
  const columnList = columns.map(quoteIdentifier).join(", ");
  const conditions = [];
  const params = [];
  if (spec.rowFilter) {
    conditions.push(`(${spec.rowFilter})`);
  }
  if (cutoffIso !== null) {
    // datetime() on both sides: the stored text format of the change signal never matters.
    conditions.push(`datetime(${spec.changeSignal}) > datetime(?)`);
    params.push(cutoffIso);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const order = quoteIdentifier(spec.primaryKey);
  return database
    .prepare(`SELECT ${columnList} FROM ${quoteIdentifier(spec.name)}${where} ORDER BY ${order}`)
    .safeIntegers(true) // keep 64-bit integers exact
    .all(...params);
}

/**
 * The table's candidate watermark: the verbatim MAX() of its change signal over ALL rows the
 * sync owns (rowFilter applied, change filter not). Stored byte-for-byte after a successful
 * apply; null when the table holds no rows (the previous watermark then stays).
 */
function readCandidateWatermark(database, spec) {
  const where = spec.rowFilter ? ` WHERE ${spec.rowFilter}` : "";
  const row = database
    .prepare(`SELECT MAX(${spec.changeSignal}) AS candidate FROM ${quoteIdentifier(spec.name)}${where}`)
    .safeIntegers(true)
    .get();
  return row.candidate === null || row.candidate === undefined ? null : String(row.candidate);
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
  full = false,
  statePath = syncStatePathFor(dbPath),
  now = new Date(),
  limits = DEFAULT_LIMITS,
}) {
  const tableNames = SYNC_TABLES.map((spec) => spec.name);
  const { columns: migratedColumns } = loadMigratedColumns(migrationsDir, tableNames);

  // Mode decision, made before any row is read: forced by --full, by missing/unusable
  // state, or by the weekly full-sync backstop. Per table, a missing or unparseable
  // watermark also falls back to a full export of just that table.
  const state = full ? null : loadSyncState(statePath);
  const syncMode = full || fullSyncDue(state, now) ? "full" : "incremental";
  const tablePlans = new Map();
  for (const spec of SYNC_TABLES) {
    const watermarkBefore = syncMode === "incremental" ? (state.tables[spec.name] ?? null) : null;
    const cutoffIso = watermarkBefore !== null ? watermarkCutoffIso(watermarkBefore) : null;
    tablePlans.set(spec.name, {
      changeSignal: spec.changeSignal,
      mode: syncMode === "incremental" && cutoffIso !== null ? "incremental" : "full",
      watermarkBefore,
      cutoffIso,
      candidateWatermark: null,
    });
  }

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
          const plan = tablePlans.get(spec.name);
          plan.candidateWatermark = readCandidateWatermark(database, spec);
          const rows = readTableRows(
            database,
            spec,
            columns,
            plan.mode === "incremental" ? plan.cutoffIso : null,
          );
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
  const files = planFiles({ tableStatements, retentionStatements, pruneStatements, limits });
  const outputDir = path.join(outputRoot, utcTimestamp(now));
  const wranglerCommands = buildWranglerCommands({ repoRoot, outputDir, files });
  const relativeDb = path.relative(repoRoot, dbPath);
  const sync = {
    mode: syncMode,
    overlapMinutes: SYNC_OVERLAP_MINUTES,
    tables: Object.fromEntries(
      SYNC_TABLES.map((spec) => {
        const plan = tablePlans.get(spec.name);
        return [
          spec.name,
          {
            changeSignal: plan.changeSignal,
            mode: plan.mode,
            watermarkBefore: plan.watermarkBefore,
            candidateWatermark: plan.candidateWatermark,
          },
        ];
      }),
    ),
  };
  const manifest = {
    generatedAt: now.toISOString(),
    sourceDatabase: relativeDb.startsWith("..") || path.isAbsolute(relativeDb) ? dbPath : relativeDb,
    d1Database: D1_DATABASE_NAME,
    prune,
    retention,
    sync,
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
  return { outputDir, manifest, files, wranglerCommands, sync, statePath };
}

/**
 * Advance the stored watermarks after an --apply, for the tables whose data files were ALL
 * applied (a partially applied table keeps its old watermark, so its remaining rows are
 * re-sent next run; upserts are idempotent, so re-sending is safe). `lastFullAt` moves only
 * when a full-mode export was applied in full. Called only from main's --apply path: a dry
 * run never persists anything.
 */
export function persistSyncState({ sync, statePath, appliedTables, now = new Date() }) {
  const next = loadSyncState(statePath) ?? emptySyncState();
  for (const spec of SYNC_TABLES) {
    const candidate = sync.tables[spec.name]?.candidateWatermark;
    if (appliedTables.has(spec.name) && candidate !== null && candidate !== undefined) {
      next.tables[spec.name] = candidate;
    }
  }
  if (sync.mode === "full" && SYNC_TABLES.every((spec) => appliedTables.has(spec.name))) {
    next.lastFullAt = now.toISOString();
  }
  saveSyncState(statePath, next);
  return next;
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
      full: options.full,
    });
    const { manifest } = result;
    log(`Source database: ${manifest.sourceDatabase}`);
    for (const [table, { rows }] of Object.entries(manifest.tables)) {
      log(`  ${table}: ${rows} row(s)`);
    }
    log(`Wrote ${manifest.files.length} SQL file(s) + manifest.json to ${path.relative(REPO_ROOT, result.outputDir)}`);
    log(`--sync: ${manifest.sync.mode} (watermarks advance only after a successful --apply)`);
    log(options.prune ? "--prune: ENABLED (see runbook before running the last file)" : "--prune: off");
    log(options.retention ? "--retention: ENABLED (0090-retention.sql)" : "--retention: off");
    if (options.apply) {
      log("\nApplying to remote D1 in order:\n");
      try {
        const { appliedTables } = applyExport({
          wrangler,
          env,
          repoRoot: REPO_ROOT,
          outputDir: result.outputDir,
          files: result.files,
          manifest,
          log,
        });
        persistSyncState({ sync: result.sync, statePath: result.statePath, appliedTables });
        log(`d1_sync_watermarks_advanced=${appliedTables.size}`);
      } catch (error) {
        // Even a failed apply may have fully applied some tables (apply stops at the first
        // failure); advance exactly those watermarks before reporting the failure.
        if (error instanceof ApplyError && error.appliedTables) {
          persistSyncState({ sync: result.sync, statePath: result.statePath, appliedTables: error.appliedTables });
          log(`d1_sync_watermarks_advanced=${error.appliedTables.size}`);
        }
        throw error;
      }
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
