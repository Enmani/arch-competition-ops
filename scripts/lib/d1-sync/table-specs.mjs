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

export const PRUNE_FILE_NAME = "0099-prune.sql";
export const MAX_DATA_FILES = 98; // 0001..0098; 0099 is reserved for prune.

export const PRUNE_STAGING_TABLE = "_sync_competition_ids";

// Human-decision columns of ops_review_queue_items. Documented here and asserted in tests:
// the DO UPDATE list below deliberately excludes them.
export const QUEUE_HUMAN_COLUMNS = Object.freeze(["status", "first_detected_at", "updated_at"]);

/**
 * `updateColumns: null` means "every column except the primary key".
 * `rowFilter` is a fixed SQL fragment (never built from input).
 * `conflictGuard` is an optional WHERE on the DO UPDATE branch.
 */
export const SYNC_TABLES = Object.freeze([
  Object.freeze({
    name: "competitions",
    primaryKey: "id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
  }),
  Object.freeze({
    name: "source_runs",
    primaryKey: "id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
  }),
  Object.freeze({
    name: "ai_screening_results",
    primaryKey: "competition_id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
  }),
  Object.freeze({
    name: "source_health",
    primaryKey: "source_id",
    rowFilter: null,
    updateColumns: null,
    conflictGuard: null,
  }),
  Object.freeze({
    name: "ops_review_queue_items",
    primaryKey: "queue_id",
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
