import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { MCP_MAX_ACTIVE_KEYS, MCP_PLANS, type McpPlan, mcpApiKeyCreatedSchema } from "@arch-competition/core";

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
      const subject = String(db.raw.prepare("SELECT subject FROM mcp_usage").pluck().get());
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

    db.raw.prepare("UPDATE mcp_usage SET month_count = ?").run(monthlyLimit - 1);
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
