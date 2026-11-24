// Keeps the worker's SQLite state in a PRIVATE Cloudflare R2 bucket between cloud runs.
//
//   node scripts/cloud-state.mjs pull [--force] [--generation <id>]
//   node scripts/cloud-state.mjs push [--init] [--force]
//   node scripts/cloud-state.mjs stats
//
// The state is data/competitions.sqlite (notice ledger + paid-assessment cache) plus
// data/geocoding-cache.json. Losing it, or starting from an empty database, means paying for
// every assessment again, so:
//   - `pull` fails loudly when the bucket holds no state; only `push --init` creates the first one.
//   - `pull` and `push` refuse to replace newer-looking state (more ai_notice_ledger rows) with older
//     state unless --force.
// Objects: state/<UTC timestamp>/competitions.sqlite.gz, state/<UTC timestamp>/geocoding-cache.json.gz
// and the small pointer latest.json (written last, so a half-finished push never becomes "latest").
// The newest KEEP_GENERATIONS generations are kept. wrangler has no `r2 object list`, so latest.json
// also carries the generation index.
//
// Output is counts only: never file contents, never environment values (logs of a public repo are
// world-readable). Environment: ARCH_STATE_BUCKET (default arch-competition-state),
// ARCH_COMPETITION_OPS_DB, ARCH_WRANGLER_CMD (see lib/wrangler.mjs), CLOUDFLARE_API_TOKEN and
// CLOUDFLARE_ACCOUNT_ID.

import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync, gzipSync } from "node:zlib";

import Database from "better-sqlite3";

import { resolveDatabasePath } from "./export-d1-data.mjs";
import { utcTimestamp } from "./lib/d1-sync/batching.mjs";
import { assertCloudflareCredentials, describeFailure, resolveWrangler, runWrangler } from "./lib/wrangler.mjs";

export const DEFAULT_BUCKET = "arch-competition-state";
export const BUCKET_ENV_VAR = "ARCH_STATE_BUCKET";
export const KEEP_GENERATIONS = 14;
export const POINTER_KEY = "latest.json";
const DB_FILE = "competitions.sqlite";
const GEOCODE_FILE = "geocoding-cache.json";
const COUNTED_TABLES = ["competitions", "ai_notice_ledger", "notice_backlog", "ai_screening_results", "ai_screening_runs"];
const KEY_PATTERN = /^state\/[0-9A-Za-z-]+\/[0-9A-Za-z._-]+$/;
const BUCKET_PATTERN = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;
const MISSING_OBJECT_PATTERN = /does not exist|not found|NoSuchKey|10007/i;

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const USAGE = `Usage: node scripts/cloud-state.mjs <pull|push|stats> [options]

  pull                 download the newest state generation and restore data/competitions.sqlite
                       (and geocoding-cache.json). Fails when the bucket has no state.
  push                 snapshot the local database, check it, upload it as a new generation and
                       prune generations beyond the newest ${KEEP_GENERATIONS}.
  stats                print row counts of the local database (key=value lines).

Options:
  --init               push only: create the very first generation (refused when state exists).
  --force              skip the "fewer ai_notice_ledger rows" refusal (and --init on existing state).
  --generation <id>    pull only: restore an older generation listed in latest.json.
  --bucket <name>      R2 bucket (default ${DEFAULT_BUCKET}, or ${BUCKET_ENV_VAR}).
`;

export class StateError extends Error {}

export function parseArgs(argv) {
  const options = { command: null, init: false, force: false, generation: null, bucket: null, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--init") {
      options.init = true;
    } else if (arg === "--force") {
      options.force = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--generation" || arg === "--bucket") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new StateError(`${arg} requires a value`);
      }
      options[arg.slice(2)] = value;
      index += 1;
    } else if (!arg.startsWith("--") && options.command === null) {
      options.command = arg;
    } else {
      throw new StateError(`Unknown argument: ${arg}`);
    }
  }
  if (!options.help) {
    if (!["pull", "push", "stats"].includes(options.command)) {
      throw new StateError("The first argument must be pull, push or stats");
    }
    if (options.init && options.command !== "push") {
      throw new StateError("--init applies to push only");
    }
    if (options.generation && options.command !== "pull") {
      throw new StateError("--generation applies to pull only");
    }
  }
  return options;
}

// -- SQLite helpers ----------------------------------------------------------------------------

function tableExists(database, table) {
  return database.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) !== undefined;
}

/** Row counts per table (0 for a table that does not exist yet). */
export function readCounts(dbPath) {
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    const counts = {};
    for (const table of COUNTED_TABLES) {
      counts[table] = tableExists(database, table)
        ? Number(database.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get().n)
        : 0;
    }
    counts.backlog_removed = tableExists(database, "backlog_retention")
      ? Number(database.prepare("SELECT removed FROM backlog_retention WHERE id=1").get()?.removed ?? 0) : 0;
    return counts;
  } finally {
    database.close();
  }
}

function assertIntegrity(dbPath, label) {
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    const result = database.pragma("integrity_check", { simple: true });
    if (result !== "ok") {
      throw new StateError(`${label}: PRAGMA integrity_check failed`);
    }
  } finally {
    database.close();
  }
}

/** Consistent copy through SQLite's online backup API; a live database file is never copied. */
async function snapshotDatabase(dbPath, snapshotPath) {
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    await database.backup(snapshotPath);
  } finally {
    database.close();
  }
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

// -- R2 access through wrangler ----------------------------------------------------------------

function createContext({ env, repoRoot, bucket, log, workDir }) {
  const wrangler = resolveWrangler(env, repoRoot);
  assertCloudflareCredentials(wrangler, env);
  if (!BUCKET_PATTERN.test(bucket)) {
    throw new StateError("Invalid bucket name");
  }
  const run = (args) => runWrangler(wrangler, args, { env, repoRoot });
  return {
    bucket,
    log,
    workDir,
    put(key, filePath, contentType) {
      const result = run(["r2", "object", "put", `${bucket}/${key}`, "--remote", "--file", filePath, "--content-type", contentType]);
      if (!result.ok) {
        throw new StateError(`upload of ${key} failed: ${describeFailure(result, env)}`);
      }
    },
    /** Returns false when the object does not exist; throws on any other failure. */
    get(key, filePath) {
      const result = run(["r2", "object", "get", `${bucket}/${key}`, "--remote", "--file", filePath]);
      if (result.ok) {
        return existsSync(filePath);
      }
      if (MISSING_OBJECT_PATTERN.test(`${result.stderr}\n${result.stdout}`)) {
        return false;
      }
      throw new StateError(`download of ${key} failed: ${describeFailure(result, env)}`);
    },
    remove(key) {
      const result = run(["r2", "object", "delete", `${bucket}/${key}`, "--remote"]);
      return result.ok ? null : describeFailure(result, env);
    },
  };
}

function assertKey(key) {
  if (typeof key !== "string" || !KEY_PATTERN.test(key)) {
    throw new StateError("latest.json holds an invalid object key");
  }
}

function validatePointer(pointer) {
  if (!pointer || pointer.version !== 1 || typeof pointer.generation !== "string") {
    throw new StateError("latest.json has an unexpected format");
  }
  pointer.history ??= [];
  if (!Number.isInteger(pointer.counts?.ai_notice_ledger)) {
    throw new StateError("latest.json has no ai_notice_ledger count");
  }
  for (const entry of [pointer, ...(pointer.history ?? [])]) {
    assertKey(entry.db?.key);
    if (entry.geocode) {
      assertKey(entry.geocode.key);
    }
  }
  return pointer;
}

/** latest.json, or null when the bucket has none. */
function fetchPointer(context) {
  const target = path.join(context.workDir, "latest.json");
  if (!context.get(POINTER_KEY, target)) {
    return null;
  }
  try {
    return validatePointer(JSON.parse(readFileSync(target, "utf8")));
  } catch (error) {
    throw error instanceof StateError ? error : new StateError("latest.json is not valid JSON");
  }
}

function formatCounts(counts) {
  return COUNTED_TABLES.map((table) => `${table}=${counts[table]}`).join(" ");
}

// -- commands ----------------------------------------------------------------------------------

async function push({ context, dbPath, options, now }) {
  if (!existsSync(dbPath)) {
    throw new StateError("No local database to push");
  }
  const pointer = fetchPointer(context);
  if (pointer === null && !options.init) {
    throw new StateError("The bucket holds no state; refusing to create one. Seed it once with: push --init");
  }
  if (pointer !== null && options.init && !options.force) {
    throw new StateError(`State already exists (generation ${pointer.generation}); --init is only for the first generation`);
  }

  const snapshotPath = path.join(context.workDir, DB_FILE);
  await snapshotDatabase(dbPath, snapshotPath);
  assertIntegrity(snapshotPath, "snapshot");
  const counts = readCounts(snapshotPath);
  if (pointer !== null && !options.force && counts.ai_notice_ledger < pointer.counts.ai_notice_ledger) {
    throw new StateError(
      `Refusing to push: local ai_notice_ledger has ${counts.ai_notice_ledger} rows, ` +
        `the stored state has ${pointer.counts.ai_notice_ledger}. Use --force only if that is intended.`,
    );
  }

  if (pointer && !options.force && counts.notice_backlog + counts.backlog_removed <
      (pointer.counts.notice_backlog ?? 0) + (pointer.counts.backlog_removed ?? 0)) {
    throw new StateError("Refusing to push: notice_backlog has lost rows outside recorded retention.");
  }

  // A generation id never repeats: bump by a second until it is unused.
  const used = new Set([pointer?.generation, ...(pointer?.history ?? []).map((entry) => entry.generation)]);
  let stamp = new Date(now);
  while (used.has(utcTimestamp(stamp))) {
    stamp = new Date(stamp.getTime() + 1000);
  }
  const generation = utcTimestamp(stamp);

  const files = [{ name: DB_FILE, source: snapshotPath, contentType: "application/gzip", slot: "db" }];
  const geocodePath = path.join(path.dirname(dbPath), GEOCODE_FILE);
  if (existsSync(geocodePath)) {
    files.push({ name: GEOCODE_FILE, source: geocodePath, contentType: "application/gzip", slot: "geocode" });
  }
  const entry = { generation, createdAt: stamp.toISOString(), counts };
  for (const file of files) {
    const gz = gzipSync(readFileSync(file.source), { level: 9 });
    const gzPath = path.join(context.workDir, `${file.name}.gz`);
    writeFileSync(gzPath, gz);
    const key = `state/${generation}/${file.name}.gz`;
    context.put(key, gzPath, file.contentType);
    entry[file.slot] = { key, sha256: sha256(gz), size: gz.length };
  }

  const generations = [entry, ...(pointer ? [stripHistory(pointer), ...pointer.history] : [])];
  const kept = generations.slice(0, KEEP_GENERATIONS);
  const dropped = generations.slice(KEEP_GENERATIONS);
  const nextPointer = { version: 1, ...kept[0], history: kept.slice(1) };
  const pointerPath = path.join(context.workDir, "latest.next.json");
  writeFileSync(pointerPath, `${JSON.stringify(nextPointer, null, 2)}\n`, "utf8");
  context.put(POINTER_KEY, pointerPath, "application/json");

  // Pruning comes after the new pointer is live; a failed delete only leaves an unreferenced object.
  let deleted = 0;
  for (const old of dropped) {
    for (const slot of [old.db, old.geocode]) {
      if (!slot) {
        continue;
      }
      const failure = context.remove(slot.key);
      if (failure === null) {
        deleted += 1;
      } else {
        context.log(`[WARN] could not delete ${slot.key}: ${failure}`);
      }
    }
  }
  context.log(
    `Pushed generation ${generation} to ${context.bucket} (${files.length} object(s), ` +
      `${entry.db.size} bytes gz; ${formatCounts(counts)}); kept ${kept.length} generation(s), deleted ${deleted} object(s).`,
  );
}

function stripHistory(pointer) {
  const { version: _version, history: _history, ...entry } = pointer;
  return entry;
}

async function pull({ context, dbPath, options }) {
  const pointer = fetchPointer(context);
  if (pointer === null) {
    throw new StateError(
      `The bucket ${context.bucket} holds no state. Refusing to continue with an empty database ` +
        "(every paid assessment would be bought again). Seed it from a local database with: push --init",
    );
  }
  const entry = options.generation
    ? [stripHistory(pointer), ...pointer.history].find((candidate) => candidate.generation === options.generation)
    : stripHistory(pointer);
  if (!entry) {
    throw new StateError(`Generation ${options.generation} is not in latest.json`);
  }

  const stagedDb = path.join(context.workDir, `restore-${DB_FILE}`);
  writeFileSync(stagedDb, downloadVerified(context, entry.db));
  assertIntegrity(stagedDb, "downloaded database");
  const counts = readCounts(stagedDb);

  if (existsSync(dbPath) && !options.force) {
    let localLedger;
    try {
      localLedger = readCounts(dbPath).ai_notice_ledger;
    } catch {
      throw new StateError("The local database is unreadable; use --force to replace it");
    }
    if (localLedger > counts.ai_notice_ledger) {
      throw new StateError(
        `Refusing to overwrite: the local ai_notice_ledger has ${localLedger} rows, ` +
          `the pulled generation ${entry.generation} has ${counts.ai_notice_ledger}. Use --force to replace it.`,
      );
    }
  }
  let geocode = null;
  if (entry.geocode) {
    geocode = downloadVerified(context, entry.geocode);
  }

  mkdirSync(path.dirname(dbPath), { recursive: true });
  const pendingPath = `${dbPath}.restore`;
  copyFileSync(stagedDb, pendingPath);
  // Sidecars of the replaced database must not be applied to the restored one.
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    rmSync(`${dbPath}${suffix}`, { force: true });
  }
  renameSync(pendingPath, dbPath);
  if (geocode !== null) {
    writeFileSync(path.join(path.dirname(dbPath), GEOCODE_FILE), geocode);
  }
  context.log(`Restored generation ${entry.generation} from ${context.bucket} (${formatCounts(counts)}).`);
}

/** Download one object, check size and sha256, return the gunzipped bytes. */
function downloadVerified(context, slot) {
  const target = path.join(context.workDir, path.basename(slot.key));
  if (!context.get(slot.key, target)) {
    throw new StateError(`${slot.key} is listed in latest.json but is missing from the bucket`);
  }
  const bytes = readFileSync(target);
  if (bytes.length !== slot.size || sha256(bytes) !== slot.sha256) {
    throw new StateError(`${slot.key} does not match the size/sha256 recorded in latest.json`);
  }
  try {
    return gunzipSync(bytes);
  } catch {
    throw new StateError(`${slot.key} is not valid gzip data`);
  }
}

function stats({ dbPath, log, now }) {
  if (!existsSync(dbPath)) {
    throw new StateError("No local database");
  }
  const counts = readCounts(dbPath);
  for (const table of COUNTED_TABLES) {
    log(`${table}=${counts[table]}`);
  }
  const database = new Database(dbPath, { fileMustExist: true });
  try {
    if (tableExists(database, "ai_screening_runs")) {
      const today = now.toISOString().slice(0, 10);
      const cost = database
        .prepare("SELECT COALESCE(SUM(cost_usd), 0) AS usd FROM ai_screening_runs WHERE substr(started_at, 1, 10) = ?")
        .get(today).usd;
      log(`ai_cost_usd_today=${Number(cost).toFixed(4)}`);
    }
  } finally {
    database.close();
  }
}

export async function main(
  argv = process.argv.slice(2),
  env = process.env,
  { log = console.log, repoRoot = REPO_ROOT, now = new Date() } = {},
) {
  let workDir = null;
  try {
    const options = parseArgs(argv);
    if (options.help) {
      log(USAGE);
      return 0;
    }
    const dbPath = resolveDatabasePath(env, repoRoot);
    if (options.command === "stats") {
      stats({ dbPath, log, now });
      return 0;
    }
    workDir = mkdtempSync(path.join(tmpdir(), "arch-cloud-state-"));
    const bucket = options.bucket ?? (env[BUCKET_ENV_VAR]?.trim() || DEFAULT_BUCKET);
    const context = createContext({ env, repoRoot, bucket, log, workDir });
    if (options.command === "push") {
      await push({ context, dbPath, options, now });
    } else {
      await pull({ context, dbPath, options });
    }
    return 0;
  } catch (error) {
    console.error(error instanceof StateError ? `cloud-state: ${error.message}` : `cloud-state failed: ${error.message}`);
    return 1;
  } finally {
    if (workDir) {
      rmSync(workDir, { recursive: true, force: true });
    }
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
  process.exitCode = await main();
}
