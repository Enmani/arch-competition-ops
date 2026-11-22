import assert from "node:assert/strict";
import test from "node:test";

import { MCP_ANONYMOUS_DAILY_BUDGET, MCP_PLANS, mcpApiKeyCreatedSchema, mcpApiKeyListSchema, mcpApiKeySchema, mcpUsageSchema } from "@arch-competition/core";
import { createTestStorage } from "@arch-competition/storage/testing";

import { createMcpKeyHandlers, createMcpUsageHandler } from "../api/mcp-keys";
import { sessionCookieName } from "../session-cookie";
import { cloudflareClientIp } from "./access";
import { createMcpHandler } from "./http";

const site = "http://localhost:3400";

test("session API issues one-time keys and MCP meters only tool calls with valid credentials", async (t) => {
  const db = createTestStorage({ now: "2026-12-31T23:59:59.999Z" });
  t.after(db.cleanup);
  const getStorage = async () => db.storage;
  const auth = { production: false, getStorage };
  const user = await db.storage.auth.register({ email: "keys@example.test", password: "test-password" });
  const { token } = await db.storage.auth.createSession({ userId: user.id });
  const cookie = `${sessionCookieName(false)}=${token}`;
  const request = (path: string, method: string, body?: unknown, additional: Record<string, string> = {}) => new Request(site + path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    headers: { origin: site, cookie, "content-type": "application/json", ...additional },
  });
  const keys = createMcpKeyHandlers(auth);
  const usage = createMcpUsageHandler(auth);
  const handle = createMcpHandler(async () => db.storage.opportunities, {
    getStorage: async () => db.storage.mcp,
    getAnonymousIp: cloudflareClientIp,
    getAnonymousSalt: () => "private-test-salt",
  }, db.clock);
  const send = (method: string, params = {}, bearer?: string, extraHeaders = {}) => handle(request("/mcp", "POST",
    { jsonrpc: "2.0", id: 1, method, params }, {
      accept: "application/json, text/event-stream",
      "cf-connecting-ip": "203.0.113.42",
      ...(bearer === undefined ? {} : { authorization: `Bearer ${bearer}` }),
      ...extraHeaders,
    }));
  const tool = { name: "get_taxonomy" };
  const use = (key?: string) => send("tools/call", tool, key);

  assert.equal((await keys.GET(request("/api/mcp/keys", "GET", undefined, { cookie: "" }))).status, 401);
  assert.equal((await keys.POST(request("/api/mcp/keys", "POST", { name: "CLI" }, { origin: "https://other.test" }))).status, 403);
  assert.equal((await keys.POST(request("/api/mcp/keys", "POST", { name: "" }))).status, 400);
  const created = await keys.POST(request("/api/mcp/keys", "POST", { name: "CLI" }));
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("cache-control"), "no-store");
  const { item, key } = mcpApiKeyCreatedSchema.parse(await created.json());
  const listed = mcpApiKeyListSchema.parse(await (await keys.GET(request("/api/mcp/keys", "GET"))).json());
  assert.deepEqual(listed.items, [item]);

  const initialize = { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } };
  for (const bearer of [undefined, key]) {
    assert.equal((await send("initialize", initialize, bearer)).status, 200);
    assert.equal((await send("tools/list", {}, bearer)).headers.get("x-quota-remaining"), null);
  }
  assert.equal((await send("tools/call", tool, undefined, { accept: "text/plain" })).status, 406);
  assert.equal(db.raw.prepare("SELECT COUNT(*) FROM mcp_usage").pluck().get(), 0);
  const withoutKey = await Promise.all(Array.from({ length: MCP_PLANS.anonymous.minuteLimit + 1 }, () => use()));
  assert.equal(withoutKey.filter((response) => response.status === 200).length, MCP_PLANS.anonymous.minuteLimit);
  const blocked = withoutKey.find((response) => response.status === 429);
  assert.ok(blocked);
  assert.equal(blocked.headers.get("retry-after"), "1");
  assert.equal(blocked.headers.get("x-ratelimit-remaining"), "0");
  assert.match((await blocked.json()).error.message, /Get a free API key.*\/en\/dashboard/);

  db.raw.prepare("UPDATE mcp_usage SET month_count = ? WHERE subject = 'global:anonymous'")
    .run(MCP_ANONYMOUS_DAILY_BUDGET);
  const daily = await use();
  assert.equal(daily.status, 429);
  assert.equal(daily.headers.get("retry-after"), "1");
  assert.equal(daily.headers.get("x-quota-remaining"), String(MCP_PLANS.anonymous.monthlyLimit - MCP_PLANS.anonymous.minuteLimit));
  const dailyError = await daily.json();
  assert.equal(dailyError.error.code, -32029);
  assert.match(dailyError.error.message, /Anonymous access is paused for today because the shared daily limit was reached/);
  assert.match(dailyError.error.message, /keep using a free API key\. Get one at http:\/\/localhost:3400\/en\/dashboard/);

  const first = await use(key);
  assert.equal(first.status, 200);
  assert.equal(first.headers.get("x-ratelimit-plan"), "free");
  assert.equal(first.headers.get("x-ratelimit-limit"), String(MCP_PLANS.free.minuteLimit));
  assert.equal(first.headers.get("x-quota-remaining"), String(MCP_PLANS.free.monthlyLimit - 1));
  const account = mcpUsageSchema.parse(await (await usage(request("/api/mcp/usage", "GET"))).json());
  assert.equal(account.month.used, 1);
  const invalid = await use("wrong");
  assert.equal(invalid.status, 401);
  assert.match((await invalid.json()).error.message, /Invalid or revoked API key/);

  const revoked = await keys.DELETE(request("/api/mcp/keys", "DELETE", { id: item.id }));
  assert.equal(revoked.status, 200);
  assert.equal(mcpApiKeySchema.parse(await revoked.json()).revokedAt, db.clock.now().toISOString());
  assert.equal((await use(key)).status, 401);
  assert.equal((await send("tools/list", {}, key)).status, 401);
  assert.equal((await send("tools/list")).status, 200);
  assert.equal((await db.storage.mcp.getUsage(user.id)).month.used, 1);

  db.clock.set("2027-01-01T00:00:00.000Z");
  const afterMidnight = await use();
  assert.equal(afterMidnight.status, 200);
  assert.equal(afterMidnight.headers.get("retry-after"), null);
  assert.equal(afterMidnight.headers.get("x-quota-remaining"), String(MCP_PLANS.anonymous.monthlyLimit - 1));
});
