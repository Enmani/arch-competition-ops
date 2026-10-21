import type { StorageContext } from "../context";
import { readRow, readRows } from "../driver/sql";

export type StoredSourceHealthItem = {
  duplicateGroupCount: number;
  lastDocumentCount: number;
  lastError: string | null;
  lastParseFailureCount: number;
  lastRunCompletedAt: string | null;
  lastRunStartedAt: string | null;
  lastStatus: string;
  lastSuccessAt: string | null;
  lastUpsertedCount: number;
  maxDuplicateGroupSize: number;
  sourceId: string;
  sourceKind: string;
  sourceName: string;
  sourceTier: string;
};

export type StoredDuplicatePressureSummary = {
  duplicateGroups: number;
  maxDuplicateGroupSize: number;
  recordsInDuplicateGroups: number;
};

export type StoredOpsSnapshot = { primary: number; total: number; verified: number };

type SourceHealthRow = {
  duplicate_group_count: number;
  last_document_count: number;
  last_error: string | null;
  last_parse_failure_count: number;
  last_run_completed_at: string | null;
  last_run_started_at: string | null;
  last_status: string;
  last_success_at: string | null;
  last_upserted_count: number;
  max_duplicate_group_size: number;
  source_id: string;
  source_kind: string;
  source_name: string;
  source_tier: string;
};

export const getOpsSnapshot = async (context: StorageContext): Promise<StoredOpsSnapshot> => {
  const row = await readRow<{ primary_count: number | null; total: number; verified: number | null }>(
    context.reader,
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
       SUM(CASE WHEN evidence_level IN ('official_notice', 'official_listing') THEN 1 ELSE 0 END) AS primary_count
     FROM competitions`,
  );
  return { primary: row?.primary_count ?? 0, total: row?.total ?? 0, verified: row?.verified ?? 0 };
};

export const getSourceHealth = async (
  context: StorageContext,
  limit = 20,
): Promise<StoredSourceHealthItem[]> => {
  const rows = await readRows<SourceHealthRow>(
    context.reader,
    `SELECT source_id, source_name, source_kind, source_tier, last_status, last_run_started_at,
            last_run_completed_at, last_success_at, last_document_count, last_upserted_count,
            last_parse_failure_count, duplicate_group_count, max_duplicate_group_size, last_error
     FROM source_health
     ORDER BY
       CASE
         WHEN last_status = 'failed' THEN 0
         WHEN COALESCE(last_parse_failure_count, 0) > 0 THEN 1
         WHEN COALESCE(duplicate_group_count, 0) > 0 THEN 2
         ELSE 3
       END ASC,
       COALESCE(last_run_completed_at, last_success_at, '') ASC,
       source_name ASC
     LIMIT ?`,
    [Math.min(Math.max(Math.trunc(limit), 1), 200)],
  );

  return rows.map((row) => ({
    duplicateGroupCount: row.duplicate_group_count,
    lastDocumentCount: row.last_document_count,
    lastError: row.last_error,
    lastParseFailureCount: row.last_parse_failure_count,
    lastRunCompletedAt: row.last_run_completed_at,
    lastRunStartedAt: row.last_run_started_at,
    lastStatus: row.last_status,
    lastSuccessAt: row.last_success_at,
    lastUpsertedCount: row.last_upserted_count,
    maxDuplicateGroupSize: row.max_duplicate_group_size,
    sourceId: row.source_id,
    sourceKind: row.source_kind,
    sourceName: row.source_name,
    sourceTier: row.source_tier,
  }));
};

export const getDuplicatePressureSummary = async (
  context: StorageContext,
): Promise<StoredDuplicatePressureSummary> => {
  const row = await readRow<StoredDuplicatePressureSummary>(
    context.reader,
    `WITH duplicate_groups AS (
       SELECT COUNT(*) AS duplicate_count
       FROM competitions
       GROUP BY dedup_key
       HAVING COUNT(*) > 1
     )
     SELECT
       COUNT(*) AS duplicateGroups,
       COALESCE(SUM(duplicate_count), 0) AS recordsInDuplicateGroups,
       COALESCE(MAX(duplicate_count), 0) AS maxDuplicateGroupSize
     FROM duplicate_groups`,
  );
  return {
    duplicateGroups: row?.duplicateGroups ?? 0,
    maxDuplicateGroupSize: row?.maxDuplicateGroupSize ?? 0,
    recordsInDuplicateGroups: row?.recordsInDuplicateGroups ?? 0,
  };
};
