import { getCloudflareContext } from "@opennextjs/cloudflare";
import {
  STORED_OPS_REVIEW_REASON_CODES,
  STORED_OPS_REVIEW_STATUSES,
  authenticateD1AuthUser,
  countD1AuthUsers,
  createD1AuthSession,
  createD1AuthUser,
  createD1SavedSearch,
  createD1WatchlistEntry,
  deleteD1AuthSession,
  deleteD1AuthSessionsForUser,
  deleteD1SavedSearch,
  deleteD1WatchlistEntry,
  getD1AuthSession,
  getD1DiscoverSurfaceData,
  getD1DuplicatePressureSummary,
  getD1OpportunityFeedItemBySlug,
  getD1OpsReviewSummary,
  getD1OpsSnapshot,
  getD1SourceHealth,
  isD1OpportunityWatched,
  listD1WatchedOpportunityIds,
  queryD1OpportunityFeed,
  queryD1OpsReviewQueue,
  queryD1SavedSearches,
  queryD1WatchlistEntries,
  writeD1OpsReviewDecision,
  type D1DatabaseLike,
  type StoredAuthErrorCode,
  type StoredAuthLoginInput,
  type StoredAuthSession,
  type StoredAuthSessionCreateInput,
  type StoredAuthSessionWithToken,
  type StoredAuthUser,
  type StoredAuthUserCreateInput,
  type StoredDiscoverSurfaceData,
  type StoredDuplicatePressureSummary,
  type StoredOpportunityFeedItem,
  type StoredOpportunityQuery,
  type StoredOpsReviewDecisionInput,
  type StoredOpsReviewDecisionStatus,
  type StoredOpsReviewQueueItem,
  type StoredOpsReviewQueueQuery,
  type StoredOpsReviewReasonCode,
  type StoredOpsReviewSummary,
  type StoredSavedSearch,
  type StoredSavedSearchCreateInput,
  type StoredSavedSearchDeleteInput,
  type StoredSavedSearchQuery,
  type StoredSourceHealthItem,
  type StoredWatchlistEntry,
  type StoredWatchlistEntryCreateInput,
  type StoredWatchlistEntryDeleteInput,
  type StoredWatchlistEntryQuery,
} from "@arch-competition/storage/cloudflare";

type LocalStorageModule = {
  authenticateStoredAuthUser: (input: StoredAuthLoginInput) => StoredAuthUser | null;
  countStoredAuthUsers: () => number;
  createStoredAuthSession: (input: StoredAuthSessionCreateInput) => StoredAuthSessionWithToken;
  createStoredAuthUser: (input: StoredAuthUserCreateInput) => StoredAuthUser;
  createStoredSavedSearch: (input: StoredSavedSearchCreateInput) => StoredSavedSearch;
  createStoredWatchlistEntry: (input: StoredWatchlistEntryCreateInput) => StoredWatchlistEntry;
  deleteStoredAuthSession: (token: string | null | undefined) => boolean;
  deleteStoredAuthSessionsForUser: (userId: string) => number;
  deleteStoredSavedSearch: (input: StoredSavedSearchDeleteInput) => boolean;
  deleteStoredWatchlistEntry: (input: StoredWatchlistEntryDeleteInput) => boolean;
  getStoredAuthSession: (token: string | null | undefined) => StoredAuthSession | null;
  getStoredDiscoverSurfaceData: (filters?: StoredOpportunityQuery) => StoredDiscoverSurfaceData;
  getStoredDuplicatePressureSummary: () => StoredDuplicatePressureSummary;
  getStoredOpportunityFeedItemBySlug: (slug: string) => StoredOpportunityFeedItem | undefined;
  getStoredOpsReviewSummary: () => StoredOpsReviewSummary;
  getStoredOpsSnapshot: () => { primary: number; total: number; verified: number };
  getStoredSourceHealth: (limit?: number) => StoredSourceHealthItem[];
  isStoredOpportunityWatched: (input: StoredWatchlistEntryCreateInput) => boolean;
  listStoredWatchedOpportunityIds: (workspaceKey: string) => string[];
  queryStoredOpportunityFeed: (filters?: StoredOpportunityQuery) => StoredOpportunityFeedItem[];
  queryStoredOpsReviewQueue: (query?: StoredOpsReviewQueueQuery) => StoredOpsReviewQueueItem[];
  queryStoredSavedSearches: (query: StoredSavedSearchQuery) => StoredSavedSearch[];
  queryStoredWatchlistEntries: (query: StoredWatchlistEntryQuery) => StoredWatchlistEntry[];
  writeStoredOpsReviewDecision: (input: StoredOpsReviewDecisionInput) => StoredOpsReviewQueueItem;
};

declare global {
  interface CloudflareEnv {
    DB?: D1DatabaseLike;
  }
}

export {
  STORED_OPS_REVIEW_REASON_CODES,
  STORED_OPS_REVIEW_STATUSES,
  type StoredAuthErrorCode,
  type StoredAuthSession,
  type StoredAuthUser,
  type StoredDiscoverSurfaceData,
  type StoredDuplicatePressureSummary,
  type StoredOpportunityFeedItem,
  type StoredOpportunityQuery,
  type StoredOpsReviewDecisionStatus,
  type StoredOpsReviewQueueItem,
  type StoredOpsReviewQueueQuery,
  type StoredOpsReviewReasonCode,
  type StoredOpsReviewSummary,
  type StoredSavedSearch,
  type StoredSourceHealthItem,
  type StoredWatchlistEntry,
};

export const getCloudflareD1Database = async () => {
  if (
    process.env.NODE_ENV === "development" &&
    process.env.ARCH_COMPETITION_USE_D1_IN_DEV !== "1"
  ) {
    return null;
  }

  try {
    const { env } = await getCloudflareContext({ async: true });
    return env.DB ?? null;
  } catch {
    return null;
  }
};

const loadLocalStorage = async () => {
  const configuredPackageName = process.env.ARCH_COMPETITION_LOCAL_STORAGE_PACKAGE;
  if (configuredPackageName) {
    return import(/* webpackIgnore: true */ configuredPackageName) as Promise<LocalStorageModule>;
  }

  return import("@arch-competition/storage") as Promise<LocalStorageModule>;
};

const withStorage = async <T>(
  handlers: {
    d1: (database: D1DatabaseLike) => Promise<T>;
    local: (storage: LocalStorageModule) => T | Promise<T>;
  },
) => {
  const database = await getCloudflareD1Database();
  if (database) {
    return handlers.d1(database);
  }

  const storage = await loadLocalStorage();
  return handlers.local(storage);
};

export const getWebDiscoverSurfaceData = async (
  filters: StoredOpportunityQuery = {},
): Promise<StoredDiscoverSurfaceData> =>
  withStorage({
    d1: (database) => getD1DiscoverSurfaceData(database, filters),
    local: (storage) => storage.getStoredDiscoverSurfaceData(filters),
  });

export const queryWebOpportunityFeed = async (
  filters: StoredOpportunityQuery = {},
): Promise<StoredOpportunityFeedItem[]> =>
  withStorage({
    d1: (database) => queryD1OpportunityFeed(database, filters),
    local: (storage) => storage.queryStoredOpportunityFeed(filters),
  });

export const getWebOpportunityFeedItemBySlug = async (slug: string) =>
  withStorage({
    d1: (database) => getD1OpportunityFeedItemBySlug(database, slug),
    local: (storage) => storage.getStoredOpportunityFeedItemBySlug(slug),
  });

export const getWebOpsSnapshot = async () =>
  withStorage({
    d1: (database) => getD1OpsSnapshot(database),
    local: (storage) => storage.getStoredOpsSnapshot(),
  });

export const getWebSourceHealth = async (
  limit = 20,
): Promise<StoredSourceHealthItem[]> =>
  withStorage({
    d1: (database) => getD1SourceHealth(database, limit),
    local: (storage) => storage.getStoredSourceHealth(limit),
  });

export const getWebDuplicatePressureSummary = async (): Promise<StoredDuplicatePressureSummary> =>
  withStorage({
    d1: (database) => getD1DuplicatePressureSummary(database),
    local: (storage) => storage.getStoredDuplicatePressureSummary(),
  });

export const getWebOpsReviewSummary = async (): Promise<StoredOpsReviewSummary> =>
  withStorage({
    d1: (database) => getD1OpsReviewSummary(database),
    local: (storage) => storage.getStoredOpsReviewSummary(),
  });

export const queryWebOpsReviewQueue = async (
  query: StoredOpsReviewQueueQuery = {},
): Promise<StoredOpsReviewQueueItem[]> =>
  withStorage({
    d1: (database) => queryD1OpsReviewQueue(database, query),
    local: (storage) => storage.queryStoredOpsReviewQueue(query),
  });

export const writeWebOpsReviewDecision = async (
  input: StoredOpsReviewDecisionInput,
): Promise<StoredOpsReviewQueueItem> =>
  withStorage({
    d1: (database) => writeD1OpsReviewDecision(database, input),
    local: (storage) => storage.writeStoredOpsReviewDecision(input),
  });

export const queryWebSavedSearches = async (
  query: StoredSavedSearchQuery,
): Promise<StoredSavedSearch[]> =>
  withStorage({
    d1: (database) => queryD1SavedSearches({ database, ...query }),
    local: (storage) => storage.queryStoredSavedSearches(query),
  });

export const createWebSavedSearch = async (
  input: StoredSavedSearchCreateInput,
): Promise<StoredSavedSearch> =>
  withStorage({
    d1: (database) => createD1SavedSearch({ database, ...input }),
    local: (storage) => storage.createStoredSavedSearch(input),
  });

export const deleteWebSavedSearch = async (
  input: StoredSavedSearchDeleteInput,
) =>
  withStorage({
    d1: (database) => deleteD1SavedSearch({ database, ...input }),
    local: (storage) => storage.deleteStoredSavedSearch(input),
  });

export const queryWebWatchlistEntries = async (
  query: StoredWatchlistEntryQuery,
): Promise<StoredWatchlistEntry[]> =>
  withStorage({
    d1: (database) => queryD1WatchlistEntries({ database, ...query }),
    local: (storage) => storage.queryStoredWatchlistEntries(query),
  });

export const listWebWatchedOpportunityIds = async (workspaceKey: string): Promise<string[]> =>
  withStorage({
    d1: (database) => listD1WatchedOpportunityIds(database, workspaceKey),
    local: (storage) => storage.listStoredWatchedOpportunityIds(workspaceKey),
  });

export const isWebOpportunityWatched = async (
  input: StoredWatchlistEntryCreateInput,
) =>
  withStorage({
    d1: (database) => isD1OpportunityWatched({ database, ...input }),
    local: (storage) => storage.isStoredOpportunityWatched(input),
  });

export const createWebWatchlistEntry = async (
  input: StoredWatchlistEntryCreateInput,
): Promise<StoredWatchlistEntry> =>
  withStorage({
    d1: (database) => createD1WatchlistEntry({ database, ...input }),
    local: (storage) => storage.createStoredWatchlistEntry(input),
  });

export const deleteWebWatchlistEntry = async (
  input: StoredWatchlistEntryDeleteInput,
) =>
  withStorage({
    d1: (database) => deleteD1WatchlistEntry({ database, ...input }),
    local: (storage) => storage.deleteStoredWatchlistEntry(input),
  });

export const createWebAuthUser = async (
  input: StoredAuthUserCreateInput,
): Promise<StoredAuthUser> =>
  withStorage({
    d1: (database) => createD1AuthUser(database, input),
    local: (storage) => storage.createStoredAuthUser(input),
  });

export const authenticateWebAuthUser = async (
  input: StoredAuthLoginInput,
): Promise<StoredAuthUser | null> =>
  withStorage({
    d1: (database) => authenticateD1AuthUser(database, input),
    local: (storage) => storage.authenticateStoredAuthUser(input),
  });

export const createWebAuthSession = async (
  input: StoredAuthSessionCreateInput,
): Promise<StoredAuthSessionWithToken> =>
  withStorage({
    d1: (database) => createD1AuthSession(database, input),
    local: (storage) => storage.createStoredAuthSession(input),
  });

export const getWebAuthSession = async (
  token: string | null | undefined,
): Promise<StoredAuthSession | null> =>
  withStorage({
    d1: (database) => getD1AuthSession(database, token),
    local: (storage) => storage.getStoredAuthSession(token),
  });

export const deleteWebAuthSession = async (token: string | null | undefined) =>
  withStorage({
    d1: (database) => deleteD1AuthSession(database, token),
    local: (storage) => storage.deleteStoredAuthSession(token),
  });

export const countWebAuthUsers = async () =>
  withStorage({
    d1: (database) => countD1AuthUsers(database),
    local: (storage) => storage.countStoredAuthUsers(),
  });

export const deleteWebAuthSessionsForUser = async (userId: string) =>
  withStorage({
    d1: (database) => deleteD1AuthSessionsForUser(database, userId),
    local: (storage) => storage.deleteStoredAuthSessionsForUser(userId),
  });

export const isAuthStorageError = (
  error: unknown,
): error is Error & { code: StoredAuthErrorCode } => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as unknown as { code?: unknown }).code;
  return (
    typeof code === "string" &&
    ["email_taken", "invalid_email", "unknown_user", "weak_password"].includes(code)
  );
};
