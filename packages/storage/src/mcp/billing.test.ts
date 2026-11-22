import assert from "node:assert/strict";
import test from "node:test";

import { createTestStorage } from "../testing";

test("checkout claims keep their interval and ignore saves from a replaced attempt", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const user = await db.storage.auth.register({ email: "checkout@example.test", password: "test-password" });
  const store = db.storage.mcpBilling;
  await store.setCustomer(user.id, "cus_fixture");
  const input = { userId: user.id, expiresAt: Math.floor(db.clock.now().getTime() / 1000) + 7200, locale: "en" } as const;
  const month = await store.claimCheckout({ ...input, previousAttempt: null, interval: "month" });
  assert.equal(month?.checkoutInterval, "month");
  assert.ok(month.checkoutAttemptId);
  const year = await store.claimCheckout({ ...input, previousAttempt: month.checkoutAttemptId, interval: "year" });
  assert.equal(year?.checkoutInterval, "year");
  assert.ok(year.checkoutAttemptId);
  assert.notEqual(year.checkoutAttemptId, month.checkoutAttemptId);
  const contested = await store.claimCheckout({ ...input, previousAttempt: month.checkoutAttemptId, interval: "month" });
  assert.deepEqual(contested, year);
  await store.saveCheckoutSession(user.id, year.checkoutAttemptId, "cs_test_year");
  await store.saveCheckoutSession(user.id, month.checkoutAttemptId, "cs_test_month");
  assert.deepEqual(await store.findAccount({ userId: user.id }), { ...year, checkoutSessionId: "cs_test_year" });
});

test("Stripe event ids are unique and concurrent snapshots only update the captured revision", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const user = await db.storage.auth.register({ email: "events@example.test", password: "test-password" });
  const store = db.storage.mcpBilling;
  const account = await store.setCustomer(user.id, "cus_fixture");
  const event = { eventId: "evt_new", userId: user.id, revision: account.revision, paidUntil: 0 };
  const stale = { ...event, eventId: "evt_stale", paidUntil: 1_900_000_000 };
  assert.deepEqual(await Promise.all([store.applyEvent(event), store.applyEvent(event), store.applyEvent(stale)]),
    ["applied", "duplicate", "retry"]);
  assert.equal(await store.hasEvent(stale.eventId), false);
  const latest = await store.findAccount({ userId: user.id });
  assert.ok(latest);
  assert.equal(latest.revision, account.revision + 1);
  assert.equal((await db.storage.mcp.getUsage(user.id)).plan, "free");
  assert.equal(await store.applyEvent({ ...stale, revision: latest.revision, paidUntil: 0 }), "applied");
  assert.equal((await db.storage.mcp.getUsage(user.id)).plan, "free");
});
