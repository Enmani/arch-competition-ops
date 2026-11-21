// Persistent watermark state for the incremental local -> D1 sync.
//
// The state file lives NEXT TO the worker's SQLite database (data/d1-sync-state.json), never
// inside it: the exporter opens the database read-only, and the schema check would (rightly)
// reject a bookkeeping table the migrations do not define. cloud-state.mjs carries the file
// to R2 as an optional third slot of every state generation, so it survives between cloud
// runs exactly like the database itself.
//
// Shape: { version: 1, lastFullAt: <ISO string|null>, tables: { <table>: <watermark string> } }
// A watermark is the verbatim MAX() of the table's change signal (see table-specs.mjs) over
// the rows of the last export whose data files were fully applied. It is stored byte-for-byte
// as SQLite returned it; all comparisons go through datetime() on the SQL side and through
// parseWatermark() here, so the stored text format ("YYYY-MM-DD HH:MM:SS", ISO with T/Z, ...)
// never matters.
//
// Anything unreadable (missing file, bad JSON, wrong version) loads as null, and null means
// "no trustworthy state": the caller falls back to a full sync. A corrupt state file must
// never break the daily run, and must never silently skip rows either.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

export const SYNC_STATE_FILE_NAME = "d1-sync-state.json";
export const SYNC_STATE_VERSION = 1;

/** Rows changed within this window before the watermark are re-exported (idempotent upserts). */
export const SYNC_OVERLAP_MINUTES = 5;

/** A full sync is forced when the last completed one is older than this (weekly backstop). */
export const FULL_SYNC_INTERVAL_DAYS = 7;

/** The state file for the database at `dbPath` (same directory, fixed name). */
export function syncStatePathFor(dbPath) {
  return path.join(path.dirname(dbPath), SYNC_STATE_FILE_NAME);
}

export function emptySyncState() {
  return { version: SYNC_STATE_VERSION, lastFullAt: null, tables: {} };
}

/**
 * Load and validate the state file. Returns null when the file is missing or unusable;
 * callers must treat null as "run a full sync", never as an error.
 */
export function loadSyncState(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
  if (
    !parsed ||
    parsed.version !== SYNC_STATE_VERSION ||
    typeof parsed.tables !== "object" ||
    parsed.tables === null ||
    Array.isArray(parsed.tables)
  ) {
    return null;
  }
  const tables = {};
  for (const [name, value] of Object.entries(parsed.tables)) {
    if (typeof value === "string" && value.length > 0) {
      tables[name] = value;
    }
  }
  return {
    version: SYNC_STATE_VERSION,
    lastFullAt: typeof parsed.lastFullAt === "string" && parsed.lastFullAt.length > 0 ? parsed.lastFullAt : null,
    tables,
  };
}

export function saveSyncState(filePath, state) {
  writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

/**
 * Parse a stored watermark as a UTC instant, tolerating the formats SQLite produces
 * ("2026-11-20 10:00:00", "2026-11-20T10:00:00", with/without fractional seconds or zone).
 * Naive values are read as UTC, matching how the worker stamps them. Returns null when the
 * value cannot be parsed; the caller then falls back to a full sync for that table.
 */
export function parseWatermark(value) {
  if (typeof value !== "string") {
    return null;
  }
  let text = value.trim();
  if (text.length === 0) {
    return null;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)) {
    text = text.replace(" ", "T");
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(text)) {
    text += "Z";
  }
  const ms = Date.parse(text);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * The incremental cutoff for one table: the watermark minus the overlap, as an ISO string
 * for `datetime(?)` on the SQL side. Null when the watermark is unparseable (full sync).
 */
export function watermarkCutoffIso(watermark, overlapMinutes = SYNC_OVERLAP_MINUTES) {
  const parsed = parseWatermark(watermark);
  if (parsed === null) {
    return null;
  }
  return new Date(parsed.getTime() - overlapMinutes * 60_000).toISOString();
}

/** True when a full sync is due: never completed, unparseable, or older than the interval. */
export function fullSyncDue(state, now) {
  if (state === null || state.lastFullAt === null) {
    return true;
  }
  const lastFull = parseWatermark(state.lastFullAt);
  if (lastFull === null) {
    return true;
  }
  return now.getTime() - lastFull.getTime() > FULL_SYNC_INTERVAL_DAYS * 24 * 60 * 60 * 1000;
}
