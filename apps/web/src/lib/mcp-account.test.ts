import assert from "node:assert/strict";
import test from "node:test";

import { MCP_PRICING } from "@arch-competition/core";

import type { ApiFailure } from "./api-client";
import {
  BILLING_CONFIRM_ATTEMPTS, activeKeyCount, annualSavings, billingConfirmStep, canCreateKey, mcpNextStep,
  readBillingReturn, sortKeys, suggestKeyName, usageAdvice, usageLevel, usagePercent, withoutBillingParam,
} from "./mcp-account";

const window = (used: number, limit: number) => ({ limit, resetsAt: "2026-12-01T00:00:00.000Z", used });

test("usage level: near from 80 % of the limit, full at the limit", () => {
  assert.equal(usageLevel(window(0, 100)), "ok");
  assert.equal(usageLevel(window(79, 100)), "ok");
  assert.equal(usageLevel(window(80, 100)), "near");
  assert.equal(usageLevel(window(99, 100)), "near");
  assert.equal(usageLevel(window(100, 100)), "full");
  assert.equal(usageLevel(window(120, 100)), "full");
  assert.equal(usagePercent(window(120, 100)), 100);
  assert.equal(usagePercent(window(1, 3)), 33);
});

test("usage advice depends on the plan and on which window is short", () => {
  const usage = (plan: "anonymous" | "free" | "paid", month: number, minute: number) => ({
    minute: window(minute, 10), month: window(month, 100), plan,
  });
  assert.equal(usageAdvice(usage("free", 10, 1)), "none");
  assert.equal(usageAdvice(usage("free", 85, 1)), "upgrade");
  assert.equal(usageAdvice(usage("free", 100, 1)), "upgrade");
  // Only the minute window is short: waiting is enough.
  assert.equal(usageAdvice(usage("free", 10, 10)), "waitReset");
  assert.equal(usageAdvice(usage("paid", 100, 1)), "waitReset");
  assert.equal(usageAdvice(usage("anonymous", 100, 1)), "getKey");
});

test("yearly savings are computed from the configured prices", () => {
  const twelve = MCP_PRICING.month * 12;
  assert.deepEqual(annualSavings(), {
    amount: twelve - MCP_PRICING.year,
    percent: Math.round(((twelve - MCP_PRICING.year) / twelve) * 100),
  });
  assert.deepEqual(annualSavings({ month: 10, year: 100 }), { amount: 20, percent: 17 });
  assert.deepEqual(annualSavings({ month: 10, year: 130 }), { amount: 0, percent: 0 });
});

test("key rules: active count, room for one more, order and default name", () => {
  const keys = [
    { createdAt: "2026-11-01T00:00:00.000Z", name: "Default", revokedAt: null },
    { createdAt: "2026-11-03T00:00:00.000Z", name: "Old", revokedAt: "2026-11-04T00:00:00.000Z" },
    { createdAt: "2026-11-02T00:00:00.000Z", name: "Default 2", revokedAt: null },
  ];
  assert.equal(activeKeyCount(keys), 2);
  assert.equal(canCreateKey(keys, 3), true);
  assert.equal(canCreateKey(keys, 2), false);
  assert.deepEqual(sortKeys(keys).map((key) => key.name), ["Default 2", "Default", "Old"]);
  assert.equal(suggestKeyName([], "Default"), "Default");
  assert.equal(suggestKeyName(keys, "Default"), "Default 3");
});

test("billing return: only the three known values are read", () => {
  assert.equal(readBillingReturn("success"), "success");
  assert.equal(readBillingReturn("cancel"), "cancel");
  assert.equal(readBillingReturn("portal"), "portal");
  assert.equal(readBillingReturn("paid"), null);
  assert.equal(readBillingReturn(null), null);
});

test("billing confirmation polls a bounded number of times", () => {
  assert.equal(billingConfirmStep("paid", 1), "confirmed");
  assert.equal(billingConfirmStep("free", 1), "poll");
  assert.equal(billingConfirmStep("free", BILLING_CONFIRM_ATTEMPTS - 1), "poll");
  assert.equal(billingConfirmStep("free", BILLING_CONFIRM_ATTEMPTS), "pending");
  assert.equal(billingConfirmStep("paid", BILLING_CONFIRM_ATTEMPTS), "confirmed");
});

test("the billing parameter is removed and everything else kept", () => {
  assert.equal(withoutBillingParam("https://x.test/en/dashboard?billing=success"), "/en/dashboard");
  assert.equal(withoutBillingParam("https://x.test/en/dashboard?a=1&billing=cancel#mcp-plan"), "/en/dashboard?a=1#mcp-plan");
});

test("every failure maps to one next step", () => {
  const failure = (status: number, kind: ApiFailure["kind"], retryAfterSeconds: number | null = null): ApiFailure => ({
    kind, retryAfterSeconds, status,
  });
  assert.equal(mcpNextStep("createKey", failure(401, "unauthenticated")), "signIn");
  assert.equal(mcpNextStep("checkout", failure(401, "unauthenticated")), "signIn");
  assert.equal(mcpNextStep("createKey", failure(400, "invalid_request")), "fixInput");
  assert.equal(mcpNextStep("createKey", failure(415, "invalid_request")), "fixInput");
  assert.equal(mcpNextStep("checkout", failure(400, "invalid_request")), "reload");
  assert.equal(mcpNextStep("revokeKey", failure(403, "forbidden")), "reload");
  assert.equal(mcpNextStep("createKey", failure(409, "generic")), "revokeOne");
  assert.equal(mcpNextStep("revokeKey", failure(404, "generic")), "refreshList");
  assert.equal(mcpNextStep("checkout", failure(409, "generic")), "openPortal");
  assert.equal(mcpNextStep("portal", failure(404, "generic")), "startCheckout");
  assert.equal(mcpNextStep("checkout", failure(503, "unavailable", 60)), "retryLater");
  assert.equal(mcpNextStep("usage", failure(503, "unavailable", 5)), "retryLater");
  assert.equal(mcpNextStep("usage", failure(500, "generic")), "retryLater");
  assert.equal(mcpNextStep("listKeys", failure(0, "network")), "retry");
});
