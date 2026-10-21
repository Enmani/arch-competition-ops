// Helpers for tests only; nothing in the runtime code imports this file.
import type { RunBudget } from "./net/budget";

/** A budget that never refuses. */
export const unlimitedBudget = (): RunBudget => ({
  hasRoom: () => true,
  remainingMs: () => Number.POSITIVE_INFINITY,
  requestsMade: () => 0,
  spend: () => true,
});
