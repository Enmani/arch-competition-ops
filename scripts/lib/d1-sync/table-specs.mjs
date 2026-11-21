// Single source of truth for what the local -> D1 sync is allowed to touch.
//
// Ownership rule: the Python worker owns these four tables. User-generated tables
// (workspace_*, ops_review_decisions, auth_*) must never appear here, and the sync never
// issues DELETE against anything except the optional --prune staging flow for competitions.
// Table and column names are interpolated into SQL, so they must only come from this file or
// from the repository's own migrations (see schema-check.mjs).

export const D1_DATABASE_NAME = "arch-competition-ops";
export const DEFAULT_DB_RELATIVE_PATH = "data/competitions.sqlite";
export const DB_PATH_ENV_VAR = "ARCH_COMPETITION_OPS_DB";
export const DEFAULT_OUTPUT_RELATIVE_DIR = "artifacts/d1-sync";
export const MIGRATIONS_RELATIVE_DIR = "apps/web/migrations";

/**
 * Per-file and per-statement budgets. D1 rejects statements above 100 KB and large import
 * files are slow/fragile, so we keep generous headroom. Adjustable in one place.
 */
export const DEFAULT_LIMITS = Object.freeze({
  maxStatementsPerFile: 500,
  maxFileBytes: 1_000_000,
  maxStatementBytes: 90 * 1024,
});

export const RETENTION_FILE_NAME = "0090-retention.sql";
export const PRUNE_FILE_NAME = "0099-prune.sql";
export const MAX_DATA_FILES = 89; // 0001..0089; 0090 is reserved for retention and 0099 for prune.

// Same window as the worker's `expired_competition_retention_days` and its 7-day exclusion rule.
export const RETENTION_DAYS = 7;

export const PRUNE_STAGING_TABLE = "_sync_competition_ids";

// Human-decision columns of ops_review_queue_items. Documented here and asserted in tests:
// the DO UPDATE list below deliberately excludes them.
export const QUEUE_HUMAN_COLUMNS = Object.freeze(["status", "first_detected_at", "updated_at"]);

/**
 * `updateColumns: null` means "every column except the primary key".
 * `rowFilter` is a fixed SQL fragment (never built from input).
 * `conflictGuard` is an optional WHERE on the DO UPDATE branch.
 * `changeSignal` is a fixed SQL expression (never built from input) whose MAX() is the
 * table's incremental-sync watermark: the exporter re-sends only rows with
 * datetime(changeSignal) newer than the stored watermark (minus a small overlap).
 * It must be a value the worker stamps on EVERY insert and update of a synced column:
 *   - competitions / source_health / ai_screening_results: `updated_at` (NOT NULL, and the
 *     sync itself writes it, so any synced change moves it).
 *   - ops_review_queue_items: `updated_at` is a human column the sync never writes (see
 *     QUEUE_HUMAN_COLUMNS), so worker-side changes are signalled by `last_detected_at`,
 *     which is in the update list and moves whenever the worker re-detects an item.
 *   - source_runs: append-only run log without `updated_at`; a run is final once
 *     `completed_at` is set, so COALESCE(completed_at, started_at) is its change signal.
 */
export const SYNC_TABLES = Object.freeze([
  Object.freeze({
    name: "competitions",
    primaryKey: "id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
    changeSignal: '"updated_at"',
  }),
  Object.freeze({
    name: "source_runs",
    primaryKey: "id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
    changeSignal: 'COALESCE("completed_at", "started_at")',
  }),
  Object.freeze({
    name: "ai_screening_results",
    primaryKey: "competition_id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
    changeSignal: '"updated_at"',
  }),
  Object.freeze({
    name: "source_health",
    primaryKey: "source_id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
    changeSignal: '"updated_at"',
  }),
  Object.freeze({
    name: "ops_review_queue_items",
    primaryKey: "queue_id",
    changeSignal: '"last_detected_at"',
    rowFilter: "origin = 'worker_diagnostic'",
    updateColumns: Object.freeze([
      "reason_code",
      "priority",
      "title",
      "summary",
      "evidence_note",
      "source_id",
      "competition_id",
      "dedup_key",
      "notice_id",
      "payload_json",
      "is_active",
      "last_detected_at",
    ]),
    // Never let a worker row overwrite a same-id row that a user/submission flow created.
    conflictGuard: `"ops_review_queue_items"."origin" = 'worker_diagnostic'`,
  }),
]);
