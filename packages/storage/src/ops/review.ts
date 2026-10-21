import {
  OPS_REVIEW_NOTE_MAX_LENGTH,
  OPS_REVIEW_STATUSES,
  includesValue,
  type OpsReviewReasonCode,
  type OpsReviewStatus,
} from "@arch-competition/core";

import type { StorageContext } from "../context";
import { StorageNotFoundError, StorageValidationError } from "../domain-errors";
import { executeBatch, readBatch, readRow, readRows } from "../driver/sql";
import type { SqlParameter } from "../driver/types";

export type StoredOpsReviewQueueQuery = {
  activeOnly?: boolean;
  limit?: number;
  reasonCode?: OpsReviewReasonCode | "all";
  status?: OpsReviewStatus | "all";
};

export type StoredOpsReviewSummary = {
  accepted: number;
  active: number;
  needsFollowUp: number;
  pending: number;
  reasons: Array<{ count: number; reasonCode: string }>;
  rejected: number;
  total: number;
};

export type StoredOpsReviewQueueItem = {
  competitionId: string | null;
  dedupKey: string | null;
  evidenceNote: string | null;
  firstDetectedAt: string;
  isActive: boolean;
  lastDetectedAt: string;
  latestDecision: null | {
    actorLabel: string | null;
    createdAt: string;
    decision: string;
    note: string | null;
  };
  noticeId: string | null;
  origin: string;
  payload: Record<string, unknown>;
  priority: number;
  queueId: string;
  reasonCode: string;
  sourceId: string | null;
  status: string;
  summary: string;
  title: string;
  updatedAt: string;
};

/** `actorLabel` is mandatory: the web layer always passes the signed-in administrator's email. */
export type StoredOpsReviewDecisionInput = {
  actorLabel: string;
  decision: OpsReviewStatus;
  note?: string | null;
  queueId: string;
};

type QueueRow = {
  competition_id: string | null;
  dedup_key: string | null;
  evidence_note: string | null;
  first_detected_at: string;
  is_active: number;
  last_detected_at: string;
  latest_actor_label: string | null;
  latest_created_at: string | null;
  latest_decision: string | null;
  latest_note: string | null;
  notice_id: string | null;
  origin: string;
  payload_json: string;
  priority: number;
  queue_id: string;
  reason_code: string;
  source_id: string | null;
  status: string;
  summary: string;
  title: string;
  updated_at: string;
};

const QUEUE_SELECT = `
  WITH latest_decision_ids AS (
    SELECT queue_id, MAX(id) AS latest_id
    FROM ops_review_decisions
    GROUP BY queue_id
  )
  SELECT q.queue_id, q.origin, q.reason_code, q.status, q.priority, q.title, q.summary,
         q.evidence_note, q.source_id, q.competition_id, q.dedup_key, q.notice_id, q.payload_json,
         q.is_active, q.first_detected_at, q.last_detected_at, q.updated_at,
         d.decision AS latest_decision, d.actor_label AS latest_actor_label,
         d.note AS latest_note, d.created_at AS latest_created_at
  FROM ops_review_queue_items AS q
  LEFT JOIN latest_decision_ids AS latest ON latest.queue_id = q.queue_id
  LEFT JOIN ops_review_decisions AS d ON d.id = latest.latest_id`;

const parsePayload = (row: QueueRow, context: StorageContext): Record<string, unknown> => {
  try {
    const value: unknown = JSON.parse(row.payload_json);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // Fall through to the warning below.
  }
  context.logger.warn("storage.malformed_payload_json", { queueId: row.queue_id });
  return {};
};

const mapQueueRow = (row: QueueRow, context: StorageContext): StoredOpsReviewQueueItem => ({
  competitionId: row.competition_id,
  dedupKey: row.dedup_key,
  evidenceNote: row.evidence_note,
  firstDetectedAt: row.first_detected_at,
  isActive: row.is_active === 1,
  lastDetectedAt: row.last_detected_at,
  latestDecision:
    row.latest_decision && row.latest_created_at
      ? {
          actorLabel: row.latest_actor_label,
          createdAt: row.latest_created_at,
          decision: row.latest_decision,
          note: row.latest_note,
        }
      : null,
  noticeId: row.notice_id,
  origin: row.origin,
  payload: parsePayload(row, context),
  priority: row.priority,
  queueId: row.queue_id,
  reasonCode: row.reason_code,
  sourceId: row.source_id,
  status: row.status,
  summary: row.summary,
  title: row.title,
  updatedAt: row.updated_at,
});

export const getOpsReviewSummary = async (context: StorageContext): Promise<StoredOpsReviewSummary> => {
  const [countRows, reasonRows] = await readBatch(context.writer, [
    {
      sql: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
              SUM(CASE WHEN is_active = 1 AND status = 'pending' THEN 1 ELSE 0 END) AS pending,
              SUM(CASE WHEN is_active = 1 AND status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
              SUM(CASE WHEN is_active = 1 AND status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
              SUM(CASE WHEN is_active = 1 AND status = 'needs_follow_up' THEN 1 ELSE 0 END) AS needsFollowUp
            FROM ops_review_queue_items`,
    },
    {
      sql: `SELECT reason_code AS reasonCode, COUNT(*) AS count
            FROM ops_review_queue_items
            WHERE is_active = 1
            GROUP BY reason_code
            ORDER BY count DESC, reason_code ASC`,
    },
  ]);
  const counts = (countRows[0] ?? {}) as Partial<Record<string, number | null>>;
  return {
    accepted: counts.accepted ?? 0,
    active: counts.active ?? 0,
    needsFollowUp: counts.needsFollowUp ?? 0,
    pending: counts.pending ?? 0,
    reasons: reasonRows as StoredOpsReviewSummary["reasons"],
    rejected: counts.rejected ?? 0,
    total: counts.total ?? 0,
  };
};

export const queryOpsReviewQueue = async (
  context: StorageContext,
  { activeOnly = true, limit = 50, reasonCode = "all", status = "pending" }: StoredOpsReviewQueueQuery = {},
): Promise<StoredOpsReviewQueueItem[]> => {
  const conditions: string[] = [];
  const parameters: SqlParameter[] = [];
  if (activeOnly) {
    conditions.push("q.is_active = 1");
  }
  if (status !== "all") {
    conditions.push("q.status = ?");
    parameters.push(status);
  }
  if (reasonCode !== "all") {
    conditions.push("q.reason_code = ?");
    parameters.push(reasonCode);
  }

  const rows = await readRows<QueueRow>(
    context.writer,
    `${QUEUE_SELECT}
     ${conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""}
     ORDER BY
       CASE q.status
         WHEN 'pending' THEN 0 WHEN 'needs_follow_up' THEN 1 WHEN 'accepted' THEN 2 WHEN 'rejected' THEN 3 ELSE 4
       END ASC,
       q.priority DESC, q.last_detected_at DESC, q.queue_id ASC
     LIMIT ?`,
    [...parameters, Math.min(Math.max(Math.trunc(limit), 1), 200)],
  );
  return rows.map((row) => mapQueueRow(row, context));
};

/**
 * Records a decision. The audit row and the status change are one `batch()` (one
 * transaction), and the audit row is inserted from a SELECT on the queue item, so an
 * unknown queue id writes nothing and is reported as not found. There is no check-then-write
 * window for a concurrent delete to slip through.
 */
export const writeOpsReviewDecision = async (
  context: StorageContext,
  { actorLabel, decision, note = null, queueId }: StoredOpsReviewDecisionInput,
): Promise<StoredOpsReviewQueueItem> => {
  if (!includesValue(OPS_REVIEW_STATUSES, decision)) {
    throw new StorageValidationError(`Unsupported ops review decision: ${String(decision)}`);
  }
  const normalizedNote = note?.trim() ? note.trim() : null;
  if (normalizedNote && normalizedNote.length > OPS_REVIEW_NOTE_MAX_LENGTH) {
    throw new StorageValidationError(`Review note must be ${OPS_REVIEW_NOTE_MAX_LENGTH} characters or fewer`);
  }
  const normalizedActor = actorLabel.trim();
  if (!normalizedActor) {
    throw new StorageValidationError("An actor label is required for review decisions");
  }

  const now = context.clock.now().toISOString();
  const [insert] = await executeBatch(context.writer, [
    {
      parameters: [decision, normalizedActor, normalizedNote, now, queueId],
      sql: `INSERT INTO ops_review_decisions (queue_id, decision, actor_label, note, created_at)
            SELECT queue_id, ?, ?, ?, ? FROM ops_review_queue_items WHERE queue_id = ?`,
    },
    {
      parameters: [decision, now, queueId],
      sql: "UPDATE ops_review_queue_items SET status = ?, updated_at = ? WHERE queue_id = ?",
    },
  ]);
  if (insert.changes === 0) {
    throw new StorageNotFoundError(`Unknown ops review queue item: ${queueId}`);
  }

  const row = await readRow<QueueRow>(context.writer, `${QUEUE_SELECT} WHERE q.queue_id = ?`, [queueId]);
  if (!row) {
    throw new StorageNotFoundError(`Ops review queue item disappeared after update: ${queueId}`);
  }
  return mapQueueRow(row, context);
};
