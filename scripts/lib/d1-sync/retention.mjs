import { RETENTION_DAYS } from "./table-specs.mjs";

// Bound the deletes per run while allowing cleanup to catch up across successive runs.
const MCP_ANONYMOUS_PRUNE_LIMIT = 25_000;

/**
 * Remote mirror of the worker's daily cleanup (`cleanup-expired-competitions`), so records the
 * worker has dropped also leave production D1. Generated only for `--apply` / `--retention`.
 *
 * Rules, identical to the local ones:
 *   - deadline_at more than RETENTION_DAYS before the sync's UTC date;
 *   - the CURRENT AI assessment is `exclude` (assessed on this very revision: source_updated_at =
 *     competitions.updated_at) and was made more than RETENTION_DAYS ago, and the record is not
 *     `shortlisted` / `verified`.
 * A competition on any watchlist is kept (the foreign key forbids deletion anyway).
 * This file also removes expired anonymous MCP usage. The subject prefix leaves account
 * usage and the single global counter outside the sweep.
 *
 * Foreign keys on D1 (migrations): ai_screening_results cascades on delete,
 * ai_screening_runs.competition_id is set to NULL, ops_review_queue_items has no foreign key to
 * competitions (the next review-queue refresh deactivates its stale items). Order matters in one
 * place: the exclusion rule reads ai_screening_results, so it runs before anything that could
 * remove those rows. The last statement sweeps result rows whose competition is gone, in case
 * foreign-key cascades are not enforced.
 *
 * The cut-off date is computed here and embedded as a literal, so the file is deterministic.
 */
export function buildRetentionStatements(now) {
  const today = now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error(`Cannot build retention statements for the date ${today}`);
  }
  const cutoff = `date('${today}', '-${RETENTION_DAYS} days')`;
  const notWatched =
    'NOT EXISTS (SELECT 1 FROM "workspace_watchlist_entries" watch WHERE watch."opportunity_id" = "competitions"."id")';

  return [
    `DELETE FROM "competitions" WHERE "status" NOT IN ('shortlisted', 'verified') ` +
      `AND EXISTS (SELECT 1 FROM "ai_screening_results" result ` +
      `WHERE result."competition_id" = "competitions"."id" AND result."decision" = 'exclude' ` +
      `AND result."source_updated_at" = "competitions"."updated_at" AND result."updated_at" < ${cutoff}) ` +
      `AND ${notWatched};`,
    `DELETE FROM "competitions" WHERE "deadline_at" IS NOT NULL AND "deadline_at" < ${cutoff} AND ${notWatched};`,
    `DELETE FROM "ai_screening_results" WHERE "competition_id" NOT IN (SELECT "id" FROM "competitions");`,
    `DELETE FROM "mcp_usage" WHERE "subject" IN (SELECT "subject" FROM "mcp_usage" ` +
      `WHERE "subject" GLOB 'anon:*' AND "month_start" < unixepoch('${today.slice(0, 7)}-01') ` +
      `LIMIT ${MCP_ANONYMOUS_PRUNE_LIMIT});`,
  ];
}
