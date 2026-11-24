import type { StorageContext } from "../context";
import { readBatch, type SqlStatement } from "../driver/sql";
import { isMissingPublicationTable } from "./continuation";
import type { NormalizedQuery } from "./query";

export const DISCOVER_SUMMARY_FORMAT = 2;

export const usesDefaultSummary = ({ limit: _limit, offset: _offset, sort, includeExpired, ...filters }: NormalizedQuery) =>
  sort === "deadline" && includeExpired !== true &&
  Object.values(filters).every((value) => Array.isArray(value) && value.length === 0);

export const readPublishedDefault = async (context: StorageContext, day: string, page: SqlStatement) => {
  try {
    // The published key, summary, and ordered rows are checked in the same transaction.
    // A missing/stale key is resolved by a fresh exact batch in the repository.
    const [publication, pageRows] = await readBatch(context.reader, [{
      sql: `SELECT version,
        CASE WHEN summary_day <= ? AND ? < next_summary_day THEN payload_today
             WHEN next_summary_day = ? THEN payload_tomorrow END AS payload
        FROM discover_publication
        WHERE id = 1 AND syncing = 0 AND summary_format = ? AND version IS NOT NULL`,
      parameters: [day, day, day, DISCOVER_SUMMARY_FORMAT],
    }, page]);
    const row = publication[0] as { version: string; payload: string | null } | undefined;
    return row?.payload ? { version: row.version, payload: row.payload, pageRows } : null;
  } catch (error) {
    if (!isMissingPublicationTable(error)) throw error;
    return null;
  }
};
