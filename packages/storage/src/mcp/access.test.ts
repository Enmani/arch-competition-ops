import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MCP_ANONYMOUS_DAILY_BUDGET, MCP_MAX_ACTIVE_KEYS, MCP_PLANS, type McpPlan, mcpApiKeyCreatedSchema } from "@arch-competition/core";

import { createTestStorage } from "../testing";

const addUser = (db: ReturnType<typeof createTestStorage>, id: string) => {
  const now = db.clock.now().toISOString();
  db.raw.prepare("INSERT INTO auth_users VALUES (?, ?, ?, ?, ?)").run(id, `${id}@example.test`, "unused", now, now);
};

test("API keys hash the secret and atomically enforce the per-user limit", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const mcp = db.storage.mcp;
  addUser(db, "member");
  addUser(db, "other");

  const all = await Promise.all(Array.from({ length: MCP_MAX_ACTIVE_KEYS + 4 }, () => mcp.createKey("member", "CLI")));
  assert.equal(all.filter(Boolean).length, MCP_MAX_ACTIVE_KEYS);
  const { item, key } = mcpApiKeyCreatedSchema.parse(all.find(Boolean));
  assert.equal(item.prefix, key.split(".")[0]);
  assert.equal((db.raw.prepare("SELECT token_hash FROM api_keys WHERE id = ?").pluck().get(item.id)),
    createHash("sha256").update(key).digest("hex"));
  const listed = await mcp.listKeys("member");
  assert.equal(listed.length, MCP_MAX_ACTIVE_KEYS);
  assert.ok(!JSON.stringify(listed).includes(key));
  assert.deepEqual(await mcp.listKeys("other"), []);
  assert.equal(await mcp.revokeKey("other", item.id), null);
  assert.equal(await mcp.authenticateKey(key.slice(0, -1) + (key.endsWith("A") ? "B" : "A")), null);

  const principal = await mcp.authenticateKey(key);
  assert.ok(principal);
  await mcp.reserveCall(principal);
  assert.equal((await mcp.listKeys("member")).find(({ id }) => id === item.id)?.lastUsedAt, db.clock.now().toISOString());
  const revoked = await mcp.revokeKey("member", item.id);
  db.clock.set("2026-04-20T12:00:00Z");
  assert.deepEqual(await mcp.revokeKey("member", item.id), revoked);
  assert.ok(revoked?.revokedAt);
  assert.equal(await mcp.authenticateKey(key), null);
  assert.equal(await mcp.reserveCall(principal), null, "revocation also blocks an already verified principal");
  assert.ok(await mcp.createKey("member", "Replacement"));
});

const expectedLimits = {
  anonymous: { monthlyLimit: 100, minuteLimit: 5 },
  free: { monthlyLimit: 300, minuteLimit: 20 },
  paid: { monthlyLimit: 5_000, minuteLimit: 60 },
} satisfies Record<McpPlan, { monthlyLimit: number; minuteLimit: number }>;

for (const plan of Object.keys(expectedLimits) as McpPlan[]) {
  test(`${plan}: concurrent admission and both UTC window boundaries`, async (t) => {
    const db = createTestStorage({ now: "2026-12-31T23:57:59.999Z" });
    t.after(db.cleanup);
    const mcp = db.storage.mcp;
    const { minuteLimit, monthlyLimit } = expectedLimits[plan];
    assert.deepEqual(MCP_PLANS[plan], expectedLimits[plan]);
    const originalIp = "2001:db8::1";
    const accountId = "member";
    const date = (iso: string) => Date.parse(iso) / 1000;
    const nextMonth = "2027-01-01T00:00:00.000Z";

    addUser(db, accountId);
    if (plan === "paid") {
      db.raw.prepare("INSERT INTO mcp_billing_accounts (user_id, paid_until) VALUES (?, ?)")
        .run(accountId, date(nextMonth) + 60);
    }
    const key = await mcp.createKey(accountId, "CLI");
    const second = await mcp.createKey(accountId, "Another CLI");
    assert.ok(key && second);
    const principal = await mcp.authenticateKey(key.key);
    const secondPrincipal = await mcp.authenticateKey(second.key);
    assert.ok(principal && secondPrincipal);
    const call = (index = 0) => mcp.reserveCall(plan === "anonymous"
      ? { anonymousIp: originalIp, salt: "private-test-salt" }
      : index % 2 === 0 ? principal : secondPrincipal);

    const burst = await Promise.all(Array.from({ length: minuteLimit + 4 }, (_, index) => call(index)));
    assert.equal(burst.filter((result) => result?.retryAfter === 0).length, minuteLimit);
    assert.equal(burst.filter((result) => result?.retryAfter === 1).length, 4);
    assert.equal(burst.at(-1)?.usage.plan, plan);
    assert.equal(burst.at(-1)?.usage.month.limit, monthlyLimit);
    assert.equal(burst.at(-1)?.usage.minute.limit, minuteLimit);
    assert.equal(burst.at(-1)?.usage.month.used, minuteLimit);
    assert.equal(burst.at(-1)?.usage.minute.used, minuteLimit);
    if (plan === "anonymous") {
      const subject = String(db.raw.prepare("SELECT subject FROM mcp_usage WHERE subject GLOB 'anon:*'").pluck().get());
      const hash = createHash("sha256").update(JSON.stringify(["private-test-salt", originalIp])).digest("hex");
      assert.equal(subject, `anon:${hash}`);
    } else {
      assert.equal((await mcp.getUsage(accountId)).month.used, minuteLimit);
    }

    db.clock.set("2026-12-31T23:58:00.000Z");
    const nextMinute = await call();
    assert.equal(nextMinute?.retryAfter, 0);
    assert.equal(nextMinute?.usage.minute.used, 1);
    assert.equal(nextMinute?.usage.month.used, minuteLimit + 1);

    db.raw.prepare("UPDATE mcp_usage SET month_count = ? WHERE subject != 'global:anonymous'").run(monthlyLimit - 1);
    db.clock.set("2026-12-31T23:59:59.999Z");
    const monthlyBurst = await Promise.all([call(), call(), call()]);
    assert.equal(monthlyBurst.filter((result) => result?.retryAfter === 0).length, 1);
    assert.equal(monthlyBurst.filter((result) => result?.retryAfter === 1).length, 2);
    assert.equal(monthlyBurst.at(-1)?.usage.month.used, monthlyLimit);
    assert.equal(monthlyBurst.at(-1)?.usage.minute.used, 1);
    assert.equal(monthlyBurst.at(-1)?.usage.month.resetsAt, nextMonth);

    db.clock.set(nextMonth);
    const reset = await call();
    assert.equal(reset?.retryAfter, 0);
    assert.equal(reset?.usage.minute.used, 1);
    assert.equal(reset?.usage.month.used, 1);
  });
}

test("anonymous daily admission is shared across IPs and keyed plans bypass it", async (t) => {
  const db = createTestStorage({ now: "2026-04-19T23:59:58.999Z" });
  t.after(db.cleanup);
  const call = (anonymousIp: string) => db.storage.mcp.reserveCall({ anonymousIp, salt: "fixture" });
  const daily = db.raw.prepare("SELECT month_count FROM mcp_usage WHERE subject = 'global:anonymous'").pluck();
  const anonymous = db.raw.prepare("SELECT * FROM mcp_usage WHERE subject GLOB 'anon:*' ORDER BY subject");

  assert.equal(MCP_ANONYMOUS_DAILY_BUDGET, 20_000);
  for (let attempt = 0; attempt < MCP_PLANS.anonymous.minuteLimit; attempt++) {
    assert.equal((await call("2001:db8::1"))?.retryAfter, 0);
  }
  assert.equal((await call("2001:db8::1"))?.retryAfter, 2);
  assert.equal(daily.get(), MCP_PLANS.anonymous.minuteLimit, "a per-IP refusal does not use the daily budget");
  db.raw.prepare("UPDATE mcp_usage SET month_count = ? WHERE subject = 'global:anonymous'")
    .run(MCP_ANONYMOUS_DAILY_BUDGET - 2);
  const burst = await Promise.all(Array.from({ length: 12 }, (_, i) => call(`2001:db8::${i + 2}`)));
  assert.equal(burst.filter((result) => result?.retryAfter === 0).length, 2);
  assert.equal(burst.filter((result) => result?.dailyBudgetReached && result.retryAfter === 2).length, 10);
  assert.equal(daily.get(), MCP_ANONYMOUS_DAILY_BUDGET);
  const beforeRefusal = anonymous.all();
  assert.equal(beforeRefusal.length, 3, "only admitted IPs have rows");

  db.clock.set("2026-04-19T23:59:59.999Z");
  const admittedIp = burst.findIndex((result) => result?.retryAfter === 0) + 2;
  const refusal = await call(`2001:db8::${admittedIp}`);
  assert.equal(refusal?.dailyBudgetReached, true);
  assert.equal(refusal?.retryAfter, 1);
  assert.equal(refusal?.usage.month.used, 1);
  assert.equal(refusal?.usage.minute.used, 1);
  assert.deepEqual(anonymous.all(), beforeRefusal);

  for (const plan of ["free", "paid"]) {
    addUser(db, plan);
    if (plan === "paid") {
      db.raw.prepare("INSERT INTO mcp_billing_accounts (user_id, paid_until) VALUES (?, ?)").run(plan, Date.parse("2026-04-20T01:00:00Z") / 1000);
    }
    const created = await db.storage.mcp.createKey(plan, "Fixture");
    assert.ok(created);
    const reserved = await db.storage.mcp.reserveCall({ id: created.item.id, userId: plan });
    assert.equal(reserved?.usage.plan, plan);
    assert.equal(reserved?.retryAfter, 0);
    assert.equal(reserved?.dailyBudgetReached, false);
  }
  assert.equal(daily.get(), MCP_ANONYMOUS_DAILY_BUDGET);
  assert.deepEqual(anonymous.all(), beforeRefusal);

  db.clock.set("2026-04-20T00:00:00.000Z");
  const reset = await call("2001:db8::1");
  assert.equal(reset?.retryAfter, 0);
  assert.equal(reset?.usage.month.used, MCP_PLANS.anonymous.minuteLimit + 1, "the monthly count continues");
  assert.equal(reset?.usage.minute.used, 1);
  assert.equal(daily.get(), 1);
  assert.equal(db.raw.prepare("SELECT COUNT(*) FROM mcp_usage WHERE subject = 'global:anonymous'").pluck().get(), 1);
});

test("last_used_at changes at most once per hour per key", async (t) => {
  const db = createTestStorage({ now: "2026-04-19T12:00:00.125Z" });
  t.after(db.cleanup);
  addUser(db, "member");
  const key = await db.storage.mcp.createKey("member", "Fixture");
  assert.ok(key);
  const principal = { id: key.item.id, userId: "member" };
  const lastUsed = db.raw.prepare("SELECT last_used_at FROM api_keys WHERE id = ?").pluck();
  assert.equal(lastUsed.get(principal.id), null);

  assert.equal((await db.storage.mcp.reserveCall(principal))?.retryAfter, 0);
  const initial = "2026-04-19T12:00:00.125Z";
  assert.equal(lastUsed.get(principal.id), initial);

  db.clock.set("2026-04-19T13:00:00.124Z");
  assert.equal((await db.storage.mcp.reserveCall(principal))?.retryAfter, 0);
  assert.equal(lastUsed.get(principal.id), initial);

  db.clock.set("2026-04-19T13:00:00.125Z");
  assert.equal((await db.storage.mcp.reserveCall(principal))?.retryAfter, 0);
  assert.equal(lastUsed.get(principal.id), "2026-04-19T13:00:00.125Z");
});
