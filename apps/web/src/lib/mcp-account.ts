import {
  MCP_PRICING, mcpBillingReturnSchema, type McpApiKey, type McpBillingReturn, type McpPlan, type McpUsage,
} from "@arch-competition/core";

import type { ApiFailure } from "./api-client";

/**
 * Decisions behind the account page (API keys, usage, plan) as pure functions, so the rules are
 * tested without a browser. Limits and prices always come from core's MCP_PLANS / MCP_PRICING
 * or from the usage response; nothing here restates a number.
 */

/* --------------------------------- usage --------------------------------- */

type UsageWindow = McpUsage["month"];
export type UsageLevel = "ok" | "near" | "full";

/** "near" from 80 % of the limit, "full" once the limit is reached. */
export const usageLevel = ({ used, limit }: Pick<UsageWindow, "limit" | "used">): UsageLevel => {
  if (used >= limit) return "full";
  return used / limit >= 0.8 ? "near" : "ok";
};

export const usagePercent = ({ used, limit }: Pick<UsageWindow, "limit" | "used">) =>
  Math.min(100, Math.max(0, Math.round((used / limit) * 100)));

const LEVEL_RANK: Record<UsageLevel, number> = { ok: 0, near: 1, full: 2 };

/** What to suggest when a window is near or at its limit; depends on the plan. */
export type UsageAdvice = "none" | "getKey" | "upgrade" | "waitReset";

export const usageAdvice = (usage: Pick<McpUsage, "minute" | "month" | "plan">): UsageAdvice => {
  const worst = [usageLevel(usage.month), usageLevel(usage.minute)].sort((a, b) => LEVEL_RANK[b] - LEVEL_RANK[a])[0];
  if (worst === "ok") return "none";
  if (usage.plan === "anonymous") return "getKey";
  // A free account at its per-minute limit only has to wait; upgrading is the answer to the month.
  if (usage.plan === "free" && usageLevel(usage.month) !== "ok") return "upgrade";
  return "waitReset";
};

/* -------------------------------- pricing -------------------------------- */

type Pricing = { month: number; year: number };

/** What a year costs less than twelve months, as an amount and a whole percentage. */
export const annualSavings = (pricing: Pricing = MCP_PRICING) => {
  const twelveMonths = pricing.month * 12;
  const amount = Math.max(0, twelveMonths - pricing.year);
  return { amount, percent: twelveMonths > 0 ? Math.round((amount / twelveMonths) * 100) : 0 };
};

/* ---------------------------------- keys ---------------------------------- */

export const isActiveKey = (key: Pick<McpApiKey, "revokedAt">) => key.revokedAt === null;

export const activeKeyCount = (keys: Pick<McpApiKey, "revokedAt">[]) => keys.filter(isActiveKey).length;

export const canCreateKey = (keys: Pick<McpApiKey, "revokedAt">[], maxActiveKeys: number) =>
  activeKeyCount(keys) < maxActiveKeys;

/** Active keys first, newest first within each group. */
export const sortKeys = <Key extends Pick<McpApiKey, "createdAt" | "revokedAt">>(keys: Key[]) =>
  [...keys].sort((a, b) => {
    if (isActiveKey(a) !== isActiveKey(b)) return isActiveKey(a) ? -1 : 1;
    return b.createdAt.localeCompare(a.createdAt);
  });

/** Default name for a new key: "Default", then "Default 2", ... skipping names in use. */
export const suggestKeyName = (keys: Pick<McpApiKey, "name">[], base: string) => {
  const names = new Set(keys.map((key) => key.name));
  if (!names.has(base)) return base;
  let index = 2;
  while (names.has(`${base} ${index}`)) index += 1;
  return `${base} ${index}`;
};

/* ------------------------- return from Stripe ------------------------- */

export const readBillingReturn = (value: string | null): McpBillingReturn | null => {
  const parsed = mcpBillingReturnSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

/** After a successful checkout the webhook may lag: re-read usage a few times, then stop. */
export const BILLING_CONFIRM_ATTEMPTS = 5;
export const BILLING_CONFIRM_INTERVAL_MS = 3_000;

export type BillingConfirmStep = "confirmed" | "poll" | "pending";

/** `attempt` counts the usage reads already made after returning from checkout. */
export const billingConfirmStep = (plan: McpPlan, attempt: number): BillingConfirmStep => {
  if (plan === "paid") return "confirmed";
  return attempt >= BILLING_CONFIRM_ATTEMPTS ? "pending" : "poll";
};

/** Drops `billing=` from the current URL, keeping every other parameter and the hash. */
export const withoutBillingParam = (href: string) => {
  const url = new URL(href);
  url.searchParams.delete("billing");
  return `${url.pathname}${url.search}${url.hash}`;
};

/* ------------------------------ failures ------------------------------ */

export type McpOperation = "checkout" | "createKey" | "listKeys" | "portal" | "revokeKey" | "usage";

/** The one thing the user can do next after a failed request. */
export type McpNextStep =
  | "fixInput"
  | "openPortal"
  | "refreshList"
  | "reload"
  | "retry"
  | "retryLater"
  | "revokeOne"
  | "signIn"
  | "startCheckout";

export const mcpNextStep = (operation: McpOperation, failure: ApiFailure): McpNextStep => {
  if (failure.kind === "unauthenticated") return "signIn";
  if (failure.kind === "forbidden") return "reload";
  if (failure.status === 409 && operation === "createKey") return "revokeOne";
  if (failure.status === 409 && operation === "checkout") return "openPortal";
  if (failure.status === 404 && operation === "revokeKey") return "refreshList";
  if (failure.status === 404 && operation === "portal") return "startCheckout";
  if (failure.kind === "invalid_request") return operation === "createKey" ? "fixInput" : "reload";
  if (failure.kind === "network") return "retry";
  return "retryLater";
};
