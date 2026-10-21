import type { DiscoverFilters } from "@arch-competition/core";

import { createStorageContext, type StorageContextOptions } from "./context";
import { authenticateUser, registerUser } from "./auth/users";
import { createSession, deleteAllSessionsForUser, deleteSession, getSession } from "./auth/sessions";
import {
  checkAuthThrottle,
  clearLoginFailures,
  recordAuthAttempt,
} from "./auth/throttle";
import {
  getDiscoverSurfaceData,
  getOpportunitiesByIds,
  getOpportunityBySlug,
  queryOpportunityFeed,
} from "./opportunities/repository";
import { getDuplicatePressureSummary, getOpsSnapshot, getSourceHealth } from "./ops/health";
import {
  getOpsReviewSummary,
  queryOpsReviewQueue,
  writeOpsReviewDecision,
  type StoredOpsReviewDecisionInput,
  type StoredOpsReviewQueueQuery,
} from "./ops/review";
import {
  createSavedSearch,
  deleteSavedSearch,
  listSavedSearches,
} from "./workspace/saved-searches";
import {
  addWatchlistEntry,
  isOpportunityWatched,
  listWatchedOpportunityIds,
  listWatchlistEntries,
  removeWatchlistEntry,
} from "./workspace/watchlist";

/**
 * The storage facade the web app consumes. It is runtime-agnostic: hand it D1 drivers (see
 * `asD1Driver`) on Cloudflare or the better-sqlite3 adapter (see `@arch-competition/storage/node`)
 * locally; the same code and the same SQL run in both.
 */
export const createStorage = (options: StorageContextOptions) => {
  const context = createStorageContext(options);

  return {
    auth: {
      authenticate: (credentials: Parameters<typeof authenticateUser>[1]) => authenticateUser(context, credentials),
      checkThrottle: (subject: Parameters<typeof checkAuthThrottle>[1]) => checkAuthThrottle(context, subject),
      clearLoginFailures: (subject: Parameters<typeof clearLoginFailures>[1]) =>
        clearLoginFailures(context, subject),
      createSession: (input: Parameters<typeof createSession>[1]) => createSession(context, input),
      deleteAllSessions: (userId: string) => deleteAllSessionsForUser(context, userId),
      deleteSession: (token: string | null | undefined) => deleteSession(context, token),
      getSession: (token: string | null | undefined) => getSession(context, token),
      recordAttempt: (subject: Parameters<typeof recordAuthAttempt>[1]) => recordAuthAttempt(context, subject),
      register: (credentials: Parameters<typeof registerUser>[1]) => registerUser(context, credentials),
    },
    opportunities: {
      discover: (filters?: DiscoverFilters) => getDiscoverSurfaceData(context, filters),
      feed: (filters?: DiscoverFilters) => queryOpportunityFeed(context, filters),
      getByIds: (ids: string[]) => getOpportunitiesByIds(context, ids),
      getBySlug: (slug: string) => getOpportunityBySlug(context, slug),
    },
    ops: {
      duplicatePressure: () => getDuplicatePressureSummary(context),
      reviewQueue: (query?: StoredOpsReviewQueueQuery) => queryOpsReviewQueue(context, query),
      reviewSummary: () => getOpsReviewSummary(context),
      snapshot: () => getOpsSnapshot(context),
      sourceHealth: (limit?: number) => getSourceHealth(context, limit),
      writeDecision: (input: StoredOpsReviewDecisionInput) => writeOpsReviewDecision(context, input),
    },
    savedSearches: {
      create: (input: Parameters<typeof createSavedSearch>[1]) => createSavedSearch(context, input),
      delete: (input: Parameters<typeof deleteSavedSearch>[1]) => deleteSavedSearch(context, input),
      list: (input: Parameters<typeof listSavedSearches>[1]) => listSavedSearches(context, input),
    },
    watchlist: {
      add: (input: Parameters<typeof addWatchlistEntry>[1]) => addWatchlistEntry(context, input),
      isWatched: (input: Parameters<typeof isOpportunityWatched>[1]) => isOpportunityWatched(context, input),
      list: (input: Parameters<typeof listWatchlistEntries>[1]) => listWatchlistEntries(context, input),
      listIds: (workspaceKey: string) => listWatchedOpportunityIds(context, workspaceKey),
      remove: (input: Parameters<typeof removeWatchlistEntry>[1]) => removeWatchlistEntry(context, input),
    },
  };
};

export type Storage = ReturnType<typeof createStorage>;
