import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import Database from "better-sqlite3";

type SqlParameter = string | number | bigint | Uint8Array | null;

type OpsReviewQueueRow = {
  queue_id: string;
  origin: string;
  reason_code: string;
  status: string;
  priority: number;
  title: string;
  summary: string;
  evidence_note: string | null;
  source_id: string | null;
  competition_id: string | null;
  dedup_key: string | null;
  notice_id: string | null;
  payload_json: string;
  is_active: number;
  first_detected_at: string;
  last_detected_at: string;
  updated_at: string;
  latest_decision: string | null;
  latest_actor_label: string | null;
  latest_note: string | null;
  latest_created_at: string | null;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "../../..");

export const STORED_OPS_REVIEW_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "needs_follow_up",
] as const;
export const STORED_OPS_REVIEW_REASON_CODES = [
  "source_parse_failures",
  "source_run_failed",
  "duplicate_cluster",
  "low_confidence_record",
  "evidence_conflict",
  "submission_pending_review",
] as const;
export const STORED_OPS_REVIEW_ORIGINS = ["worker_diagnostic", "submission"] as const;

export type StoredOpsReviewDecisionStatus = (typeof STORED_OPS_REVIEW_STATUSES)[number];
export type StoredOpsReviewReasonCode = (typeof STORED_OPS_REVIEW_REASON_CODES)[number];
export type StoredOpsReviewOrigin = (typeof STORED_OPS_REVIEW_ORIGINS)[number];
export type StoredOpsReviewQueueQuery = {
  activeOnly?: boolean;
  limit?: number;
  reasonCode?: StoredOpsReviewReasonCode | "all";
  status?: StoredOpsReviewDecisionStatus | "all";
};
export type StoredOpsReviewSummary = {
  total: number;
  active: number;
  pending: number;
  accepted: number;
  rejected: number;
  needsFollowUp: number;
  reasons: Array<{
    count: number;
    reasonCode: string;
  }>;
};
export type StoredOpsReviewQueueItem = {
  queueId: string;
  origin: string;
  reasonCode: string;
  status: string;
  priority: number;
  title: string;
  summary: string;
  evidenceNote: string | null;
  sourceId: string | null;
  competitionId: string | null;
  dedupKey: string | null;
  noticeId: string | null;
  payload: Record<string, unknown>;
  isActive: boolean;
  firstDetectedAt: string;
  lastDetectedAt: string;
  updatedAt: string;
  latestDecision: null | {
    actorLabel: string | null;
    createdAt: string;
    decision: string;
    note: string | null;
  };
};
export type StoredOpsReviewDecisionInput = {
  actorLabel?: string | null;
  decision: StoredOpsReviewDecisionStatus;
  note?: string | null;
  queueId: string;
};

const resolveSqlitePath = () => {
  const envPath = process.env.ARCH_COMPETITION_DB_PATH;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath);
  }
  return path.join(repoRoot, "data", "competitions.sqlite");
};

const readRows = <T>(statement: string, parameters: SqlParameter[] = []) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    return [] as T[];
  }

  const database = new Database(sqlitePath, { readonly: true });

  try {
    return database.prepare(statement).all(...parameters) as T[];
  } finally {
    database.close();
  }
};

const readRow = <T>(statement: string, parameters: SqlParameter[] = []) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    return undefined;
  }

  const database = new Database(sqlitePath, { readonly: true });

  try {
    return database.prepare(statement).get(...parameters) as T | undefined;
  } finally {
    database.close();
  }
};

const withWriteDatabase = <T>(handler: (database: Database.Database) => T) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    throw new Error("SQLite database not found");
  }

  const database = new Database(sqlitePath);
  try {
    return handler(database);
  } finally {
    database.close();
  }
};

const hasTable = (tableName: string) => {
  try {
    const row = readRow<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    return Boolean(row?.name);
  } catch {
    return false;
  }
};

const safeJsonRecord = (payload: string) => {
  try {
    const value = JSON.parse(payload) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const mapQueueRow = (row: OpsReviewQueueRow): StoredOpsReviewQueueItem => ({
  queueId: row.queue_id,
  origin: row.origin,
  reasonCode: row.reason_code,
  status: row.status,
  priority: row.priority,
  title: row.title,
  summary: row.summary,
  evidenceNote: row.evidence_note,
  sourceId: row.source_id,
  competitionId: row.competition_id,
  dedupKey: row.dedup_key,
  noticeId: row.notice_id,
  payload: safeJsonRecord(row.payload_json),
  isActive: row.is_active === 1,
  firstDetectedAt: row.first_detected_at,
  lastDetectedAt: row.last_detected_at,
  updatedAt: row.updated_at,
  latestDecision:
    row.latest_decision && row.latest_created_at
      ? {
          actorLabel: row.latest_actor_label,
          createdAt: row.latest_created_at,
          decision: row.latest_decision,
          note: row.latest_note,
        }
      : null,
});

const getStoredOpsReviewQueueItemById = (
  database: Database.Database,
  queueId: string,
) => {
  const row = database
    .prepare(
      `
        WITH latest_decision_ids AS (
          SELECT queue_id, MAX(id) AS latest_id
          FROM ops_review_decisions
          GROUP BY queue_id
        )
        SELECT
          q.queue_id,
          q.origin,
          q.reason_code,
          q.status,
          q.priority,
          q.title,
          q.summary,
          q.evidence_note,
          q.source_id,
          q.competition_id,
          q.dedup_key,
          q.notice_id,
          q.payload_json,
          q.is_active,
          q.first_detected_at,
          q.last_detected_at,
          q.updated_at,
          d.decision AS latest_decision,
          d.actor_label AS latest_actor_label,
          d.note AS latest_note,
          d.created_at AS latest_created_at
        FROM ops_review_queue_items AS q
        LEFT JOIN latest_decision_ids AS latest ON latest.queue_id = q.queue_id
        LEFT JOIN ops_review_decisions AS d ON d.id = latest.latest_id
        WHERE q.queue_id = ?
      `,
    )
    .get(queueId) as OpsReviewQueueRow | undefined;

  return row ? mapQueueRow(row) : undefined;
};

export const getStoredOpsReviewSummary = (): StoredOpsReviewSummary => {
  if (!hasTable("ops_review_queue_items")) {
    return {
      total: 0,
      active: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      needsFollowUp: 0,
      reasons: [],
    };
  }

  try {
    const counts = readRow<{
      accepted: number;
      active: number;
      needsFollowUp: number;
      pending: number;
      rejected: number;
      total: number;
    }>(
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN is_active = 1 AND status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN is_active = 1 AND status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN is_active = 1 AND status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN is_active = 1 AND status = 'needs_follow_up' THEN 1 ELSE 0 END) AS needsFollowUp
        FROM ops_review_queue_items
      `,
    );
    const reasons = readRows<{
      count: number;
      reasonCode: string;
    }>(
      `
        SELECT reason_code AS reasonCode, COUNT(*) AS count
        FROM ops_review_queue_items
        WHERE is_active = 1
        GROUP BY reason_code
        ORDER BY count DESC, reason_code ASC
      `,
    );

    return {
      total: counts?.total ?? 0,
      active: counts?.active ?? 0,
      pending: counts?.pending ?? 0,
      accepted: counts?.accepted ?? 0,
      rejected: counts?.rejected ?? 0,
      needsFollowUp: counts?.needsFollowUp ?? 0,
      reasons,
    };
  } catch {
    return {
      total: 0,
      active: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      needsFollowUp: 0,
      reasons: [],
    };
  }
};

export const queryStoredOpsReviewQueue = ({
  activeOnly = true,
  limit = 50,
  reasonCode = "all",
  status = "pending",
}: StoredOpsReviewQueueQuery = {}): StoredOpsReviewQueueItem[] => {
  if (!hasTable("ops_review_queue_items")) {
    return [];
  }

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

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const rows = readRows<OpsReviewQueueRow>(
      `
        WITH latest_decision_ids AS (
          SELECT queue_id, MAX(id) AS latest_id
          FROM ops_review_decisions
          GROUP BY queue_id
        )
        SELECT
          q.queue_id,
          q.origin,
          q.reason_code,
          q.status,
          q.priority,
          q.title,
          q.summary,
          q.evidence_note,
          q.source_id,
          q.competition_id,
          q.dedup_key,
          q.notice_id,
          q.payload_json,
          q.is_active,
          q.first_detected_at,
          q.last_detected_at,
          q.updated_at,
          d.decision AS latest_decision,
          d.actor_label AS latest_actor_label,
          d.note AS latest_note,
          d.created_at AS latest_created_at
        FROM ops_review_queue_items AS q
        LEFT JOIN latest_decision_ids AS latest ON latest.queue_id = q.queue_id
        LEFT JOIN ops_review_decisions AS d ON d.id = latest.latest_id
        ${whereClause}
        ORDER BY
          CASE
            WHEN q.status = 'pending' THEN 0
            WHEN q.status = 'needs_follow_up' THEN 1
            WHEN q.status = 'accepted' THEN 2
            WHEN q.status = 'rejected' THEN 3
            ELSE 4
          END ASC,
          q.priority DESC,
          q.last_detected_at DESC,
          q.queue_id ASC
        LIMIT ?
      `,
      [...parameters, limit],
    );

    return rows.map(mapQueueRow);
  } catch {
    return [];
  }
};

export const writeStoredOpsReviewDecision = ({
  actorLabel = "local_operator",
  decision,
  note = null,
  queueId,
}: StoredOpsReviewDecisionInput): StoredOpsReviewQueueItem => {
  if (!STORED_OPS_REVIEW_STATUSES.includes(decision)) {
    throw new Error(`Unsupported ops review decision: ${decision}`);
  }

  return withWriteDatabase((database) => {
    const tablesReady = database
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('ops_review_queue_items', 'ops_review_decisions')",
      )
      .all() as Array<{ name: string }>;
    if (tablesReady.length < 2) {
      throw new Error("Ops review queue tables are unavailable");
    }

    const existing = database
      .prepare("SELECT queue_id FROM ops_review_queue_items WHERE queue_id = ?")
      .get(queueId) as { queue_id: string } | undefined;
    if (!existing) {
      throw new Error(`Unknown ops review queue item: ${queueId}`);
    }

    const now = new Date().toISOString();
    const transaction = database.transaction(() => {
      database
        .prepare(
          `
            INSERT INTO ops_review_decisions (queue_id, decision, actor_label, note, created_at)
            VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(queueId, decision, actorLabel, note, now);
      database
        .prepare(
          `
            UPDATE ops_review_queue_items
            SET status = ?, updated_at = ?
            WHERE queue_id = ?
          `,
        )
        .run(decision, now, queueId);
    });
    transaction();

    const updated = getStoredOpsReviewQueueItemById(database, queueId);
    if (!updated) {
      throw new Error(`Failed to reload ops review queue item: ${queueId}`);
    }
    return updated;
  });
};
