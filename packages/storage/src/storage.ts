import { applyStripeEvent, claimCheckout, findBillingAccount, hasStripeEvent, saveCheckoutSession, setBillingCustomer } from "./mcp/billing";
import { authenticateMcpKey, createMcpKey, listMcpKeys, revokeMcpKey } from "./mcp/keys";
import { getMcpUsage, reserveMcpCall, type McpCallPrincipal } from "./mcp/usage";

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
  continueOpportunityList,
  getDiscoverSurfaceData,
  getOpportunitiesByIds,
  getOpportunityBySlug,
  getOpportunityList,
  getOpportunityLocation,
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
    mcp: {
      authenticateKey: (key: string) => authenticateMcpKey(context, key),
      createKey: (userId: string, name: string) => createMcpKey(context, userId, name),
      listKeys: (userId: string) => listMcpKeys(context, userId),
      revokeKey: (userId: string, id: string) => revokeMcpKey(context, userId, id),
      getUsage: (userId: string) => getMcpUsage(context, userId),
      reserveCall: (principal: McpCallPrincipal) => reserveMcpCall(context, principal),
    },
    mcpBilling: {
      applyEvent: (input: Parameters<typeof applyStripeEvent>[1]) => applyStripeEvent(context, input),
      claimCheckout: (input: Parameters<typeof claimCheckout>[1]) => claimCheckout(context, input),
      findAccount: (account: Parameters<typeof findBillingAccount>[1]) => findBillingAccount(context, account),
      hasEvent: (eventId: string) => hasStripeEvent(context, eventId),
      saveCheckoutSession: (userId: string, attemptId: string, sessionId: string) => saveCheckoutSession(context, userId, attemptId, sessionId),
      setCustomer: (userId: string, customerId: string) => setBillingCustomer(context, userId, customerId),
    },
    opportunities: {
      discover: (filters?: DiscoverFilters, restoredLimit?: number) =>
        getDiscoverSurfaceData(context, filters, restoredLimit),
      continue: (filters: DiscoverFilters, token: string) => continueOpportunityList(context, filters, token),
      list: (filters?: DiscoverFilters) => getOpportunityList(context, filters),
      getLocation: (slug: string) => getOpportunityLocation(context, slug),
      feed: (filters?: DiscoverFilters, asOf?: Date) => queryOpportunityFeed(context, filters, asOf),
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
