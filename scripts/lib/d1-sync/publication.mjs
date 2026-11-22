import { require as load } from "tsx/cjs/api";

import { formatSqlValue } from "./sql-values.mjs";

const storagePath = "../../../packages/storage/src/opportunities";
const { buildAggregateStatement } = load(`${storagePath}/aggregate.ts`, import.meta.url);
const { normalizeQuery } = load(`${storagePath}/query.ts`, import.meta.url);
const { DISCOVER_SUMMARY_FORMAT } = load(`${storagePath}/summary-publication.ts`, import.meta.url);

export const SYNC_START_FILE = "0000-syncing.sql";
export const SYNC_PUBLISH_FILE = "0100-publish.sql";
export const PUBLICATION_TABLE = "discover_publication";

const TODAY = "date('now')";
const TOMORROW = "date('now', '+1 day')";
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

export function buildPublicationFiles(syncId) {
  const id = formatSqlValue(syncId, { table: PUBLICATION_TABLE, column: "sync_id" });
  const owns = `id = 1 AND syncing = 1 AND sync_id = ${id}`;
  return {
    start: [
      `INSERT INTO ${PUBLICATION_TABLE} (id, sync_id, syncing) VALUES (1, ${id}, 1)
       ON CONFLICT(id) DO UPDATE SET sync_id = excluded.sync_id, syncing = 1;`,
    ],
    // An older export cannot write after a retry or another sync has taken over. The
    // CHECK constraint rejects id=0 and D1 rolls back the file if the marker changed.
    guard: `INSERT INTO ${PUBLICATION_TABLE} (id, sync_id, syncing) SELECT 0, ${id}, 1
       WHERE NOT EXISTS (SELECT 1 FROM ${PUBLICATION_TABLE} WHERE ${owns});`,
    finish: [
      // SQLite fixes 'now' for a single statement. This uses the UTC day of publication,
      // after imports and retention, even if the export was made before midnight.
      `UPDATE ${PUBLICATION_TABLE}
       SET syncing = 0, version = lower(hex(randomblob(16))), summary_format = ${DISCOVER_SUMMARY_FORMAT},
           summary_day = ${TODAY}, next_summary_day = ${TOMORROW},
           payload_today = (${aggregateForDay(TODAY)}),
           payload_tomorrow = (${aggregateForDay(TOMORROW)})
       WHERE ${owns};`,
    ],
  };
}
