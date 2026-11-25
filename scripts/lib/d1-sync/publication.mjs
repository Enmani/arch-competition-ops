import { require as load } from "tsx/cjs/api";

import { formatSqlValue } from "./sql-values.mjs";

const storagePath = "../../../packages/storage/src/opportunities";
const { buildAggregateStatement } = load(`${storagePath}/aggregate.ts`, import.meta.url);
const { buildWhere, normalizeQuery, OPPORTUNITY_COLUMNS } = load(`${storagePath}/query.ts`, import.meta.url);
const { DISCOVER_SUMMARY_FORMAT } = load(`${storagePath}/summary-publication.ts`, import.meta.url);

export const SYNC_START_FILE = "0000-syncing.sql";
export const SYNC_PUBLISH_FILE = "0100-publish.sql";
export const PUBLICATION_TABLE = "discover_publication";

const TODAY = "date('now')";
// Both daily payloads share a D1 row (2 MB limit).
const SUMMARY_BYTES_PER_DAY = 900_000;

function aggregateForDay(daySql) {
  const clock = { now: () => new Date("2000-01-01T00:00:00Z") };
  const statement = buildAggregateStatement(normalizeQuery(), clock, SUMMARY_BYTES_PER_DAY);
  if (statement.parameters?.length !== 1 || statement.sql.split("?").length !== 2) {
    throw new Error("The default summary SQL must bind only the UTC deadline lower bound");
  }
  return statement.sql.replace("?", daySql);
}

const displayColumns = new Set(OPPORTUNITY_COLUMNS.split(", "));

export function publicFields(table, columns) {
  return table === "competitions"
    ? columns.filter(column => displayColumns.has(column))
    : ["competition_id", "current_revision", "decision", "relevance_score", "result_json"];
}

export function publicNoticeIds(database, now) {
  const { clause, parameters } = buildWhere(normalizeQuery(), { now: () => now });
  return new Set(database.prepare(`SELECT id FROM competitions ${clause}`).pluck().all(...parameters));
}

const where = buildWhere(normalizeQuery(), { now: () => new Date("2000-01-01") }).clause;
const nextChange = `COALESCE((SELECT date(substr(MIN(deadline_at),1,10), '+1 day')
  FROM competitions ${where.replace("?", TODAY)} AND deadline_at IS NOT NULL), '9999-12-31')`;

export function buildPublicationFiles(syncId, snapshot, publicKey, prune = false) {
  const key = `${snapshot}:${publicKey}`;
  const id = formatSqlValue(`${syncId}:${key}`, { table: PUBLICATION_TABLE, column: "sync_id" });
  const owns = `id = 1 AND syncing = 1 AND sync_id = ${id}`;
  const current = `id=1 AND syncing=0 AND substr(sync_id,-${key.length})='${key}'
    AND summary_format=${DISCOVER_SUMMARY_FORMAT} AND ${TODAY} < next_summary_day`;
  const changed = `summary_format IS NOT ${DISCOVER_SUMMARY_FORMAT} OR version IS NULL
     OR ${TODAY} >= next_summary_day OR substr(sync_id,-${publicKey.length}) IS NOT '${publicKey}'`;
  const dirty = `summary_format IS NOT ${DISCOVER_SUMMARY_FORMAT}`;
  return {
    preflight: `SELECT EXISTS(SELECT 1 FROM ${PUBLICATION_TABLE} WHERE ${current}) AS unchanged`,
    start: [
      `INSERT INTO ${PUBLICATION_TABLE} (id, sync_id, syncing) VALUES (1, ${id}, 1)
       ON CONFLICT(id) DO UPDATE SET summary_format=CASE WHEN ${changed} THEN 0 ELSE summary_format END,
           sync_id = excluded.sync_id, syncing = 1 WHERE ${prune ? "1" : `(${current}) IS NOT TRUE`};`,
    ],
    // A committed identical snapshot may replay idempotently. A competing incomplete sync always fences it.
    pruneGuard: `INSERT INTO ${PUBLICATION_TABLE} (id, sync_id, syncing) SELECT 0, ${id}, 1
       WHERE NOT EXISTS (SELECT 1 FROM ${PUBLICATION_TABLE} WHERE ${owns});`,
    guard: `INSERT INTO ${PUBLICATION_TABLE} (id, sync_id, syncing) SELECT 0, ${id}, 1
       WHERE NOT EXISTS (SELECT 1 FROM ${PUBLICATION_TABLE} WHERE (${owns}) OR (${current}));`,
    finish: [
      `UPDATE ${PUBLICATION_TABLE}
       SET syncing = 0, version = CASE WHEN ${dirty} THEN lower(hex(randomblob(16))) ELSE version END,
           summary_format = ${DISCOVER_SUMMARY_FORMAT},
           summary_day = CASE WHEN ${dirty} THEN ${TODAY} ELSE summary_day END,
           next_summary_day = CASE WHEN ${dirty} THEN ${nextChange} ELSE next_summary_day END,
           payload_today = CASE WHEN ${dirty} THEN (${aggregateForDay(TODAY)}) ELSE payload_today END,
           payload_tomorrow = CASE WHEN ${dirty} THEN (${aggregateForDay(nextChange)}) ELSE payload_tomorrow END
       WHERE ${owns};`,
    ],
  };
}
