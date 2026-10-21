// A per-opportunity allowance of wall-clock time and outgoing requests. One record must never be
// able to turn into an unbounded number of calls to third-party sites, so every network call in
// the pipeline spends from this budget first and treats "refused" like a failed request.

export type RunBudget = {
  /** True while both time and request allowance remain. Does not spend. */
  hasRoom: () => boolean;
  /** Spend one request. Returns false (and spends nothing) when the budget is exhausted. */
  spend: () => boolean;
  remainingMs: () => number;
  requestsMade: () => number;
};

export type BudgetLimits = {
  maxRequests: number;
  totalMs: number;
};

export const createBudget = (limits: BudgetLimits, now: () => number = Date.now): RunBudget => {
  const startedAt = now();
  let made = 0;
  const remainingMs = () => Math.max(0, limits.totalMs - (now() - startedAt));
  const hasRoom = () => made < limits.maxRequests && remainingMs() > 0;
  return {
    hasRoom,
    remainingMs,
    requestsMade: () => made,
    spend: () => {
      if (!hasRoom()) {
        return false;
      }
      made += 1;
      return true;
    },
  };
};

