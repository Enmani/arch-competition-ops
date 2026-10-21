/**
 * Runtime-agnostic public entry of @arch-competition/storage (safe for Cloudflare Workers:
 * no better-sqlite3, no filesystem). The Node-only pieces live in `./node.ts`
 * (`@arch-competition/storage/node`).
 */
export { createStorage, type Storage } from "./storage";
export { systemClock, type Clock } from "./context";

export { asD1Driver } from "./driver/d1";
export {
  StorageBusyError,
  StorageError,
  isStorageBusyError,
  isUniqueViolation,
} from "./driver/errors";
export type { D1DatabaseLike, D1Result, D1StatementLike, SqlParameter } from "./driver/types";
export { StorageNotFoundError, StorageValidationError } from "./domain-errors";

export { workspaceKeyForUser } from "./workspace/keys";

export type {
  StoredBuildingCategory,
  StoredDesignScope,
  StoredDiscoverSurfaceData,
  StoredFilterOptions,
  StoredOpportunityFeedItem,
  StoredOpportunityQuery,
  StoredProjectMode,
  StoredProjectType,
} from "./opportunities/types";
export type {
  StoredDuplicatePressureSummary,
  StoredOpsSnapshot,
  StoredSourceHealthItem,
} from "./ops/health";
export type {
  StoredOpsReviewDecisionInput,
  StoredOpsReviewQueueItem,
  StoredOpsReviewQueueQuery,
  StoredOpsReviewSummary,
} from "./ops/review";
export type { StoredSavedSearch } from "./workspace/saved-searches";
export type { StoredWatchlistEntry } from "./workspace/watchlist";

export {
  StoredAuthError,
  isStoredAuthError,
  type StoredAuthCredentials,
  type StoredAuthErrorCode,
  type StoredAuthSession,
  type StoredAuthSessionWithToken,
  type StoredAuthUser,
} from "./auth/types";
export { SESSION_LIFETIME_MS } from "./auth/sessions";
export { AUTH_THROTTLE_POLICIES, type AuthAttemptScope, type ThrottleDecision } from "./auth/throttle";

// Ops review vocabularies are defined once in @arch-competition/core; these names are kept
// because the ops components import them from the storage package.
export {
  OPS_REVIEW_ORIGINS as STORED_OPS_REVIEW_ORIGINS,
  OPS_REVIEW_REASON_CODES as STORED_OPS_REVIEW_REASON_CODES,
  OPS_REVIEW_STATUSES as STORED_OPS_REVIEW_STATUSES,
  type OpsReviewReasonCode as StoredOpsReviewReasonCode,
  type OpsReviewStatus as StoredOpsReviewDecisionStatus,
} from "@arch-competition/core";
