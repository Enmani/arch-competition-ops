import assert from "node:assert/strict";
import test from "node:test";

import { competitionDetailSchema, competitionPageSchema, MCP_MAX_OFFSET, MCP_MAX_RESPONSE_BYTES, REGIONS } from "@arch-competition/core";
import { createTestStorage, seedOpportunity } from "@arch-competition/storage/testing";

import { createMcpHandler } from "./http";

const testAccess = (db: ReturnType<typeof createTestStorage>) => {
  let anonymousSubjects = 0;
  return {
    getStorage: async () => db.storage.mcp,
    // Tool semantics tests use distinct anonymous callers. Quota tests use a fixed IP.
    getAnonymousIp: () => String(++anonymousSubjects),
    getAnonymousSalt: () => "local-test",
  };
};

const headers = { accept: "application/json, text/event-stream", "content-type": "application/json" };
const post = (body: unknown, extraHeaders = {}) => new Request("http://localhost:3400/mcp", {
  method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify(body),
});
const rpc = (method: string, params = {}) => ({ jsonrpc: "2.0", id: 1, method, params });
const call = async (handle: ReturnType<typeof createMcpHandler>, name: string, args = {}) => {
  const response = await handle(post(rpc("tools/call", { name, arguments: args })));
  assert.equal(response.status, 200);
  const message = await response.json();
  assert.equal(message.id, 1);
  return message.result;
};
const noReads = async (): Promise<never> => { throw new Error("Unexpected storage access"); };

test("anonymous MCP discovery returns JSON, exactly four documented tools and no session", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const handle = createMcpHandler(noReads, testAccess(db));
  const response = await handle(post(rpc("initialize", {
    protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" },
  })));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(response.headers.get("mcp-session-id"), null);
  assert.equal((await response.json()).result.serverInfo.name, "arch-competition-ops");
  assert.equal((await handle(post({ jsonrpc: "2.0", method: "notifications/initialized" }))).status, 202);

  const list = await (await handle(post(rpc("tools/list")))).json();
  assert.deepEqual(list.result.tools.map((tool: { name: string }) => tool.name).sort(),
    ["get_competition", "get_taxonomy", "list_closing_soon", "search_competitions"]);
  for (const tool of list.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true);
    assert.equal(tool.outputSchema.type, "object");
    assert.ok(tool.description.length > 0);
  }
  const filterSchema = list.result.tools.find((tool: { name: string }) => tool.name === "search_competitions").inputSchema;
  assert.equal(filterSchema.properties.limit.maximum, 25);
  assert.deepEqual(filterSchema.required ?? [], []);
  const taxonomy = await call(handle, "get_taxonomy");
  assert.deepEqual(taxonomy.structuredContent.region, REGIONS);
  assert.deepEqual(taxonomy.structuredContent.participationFee, ["free", "paid", "unknown"]);
});

test("search filters before paging, preserves fee evidence and returns verifiable detail", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const handle = createMcpHandler(async () => db.storage.opportunities, testAccess(db), db.clock);
  const common = {
    jurisdiction: "italy", regions: '["europe"]', project_types: '["building_project"]',
    deadline_at: "2026-05-01", licensed_architect_required: 1, registration_fee_eur: 0,
  };
  for (const id of ["aa", "bb"]) seedOpportunity(db.raw, {
    ...common, id, qualification_score: 0, submission_fee_eur: 0, official_url: "https://example.org/buyer", evidence_note: "Official notice checked",
  });
  seedOpportunity(db.raw, { ...common, id: "partial", qualification_score: null, submission_fee_eur: null });
  seedOpportunity(db.raw, { ...common, id: "paid", registration_fee_eur: null, submission_fee_eur: 20 });
  seedOpportunity(db.raw, { id: "different", ...common, regions: '["asia"]', submission_fee_eur: 0 });
  const filters = {
    jurisdiction: "italy", region: "europe", projectTypes: ["building_project"], participationFee: "free",
    deadlineAfter: "2026-05-01", deadlineBefore: "2026-05-01", licensedArchitectRequired: true, limit: 1,
  };
  const search = async (args: Record<string, unknown>) =>
    competitionPageSchema.parse((await call(handle, "search_competitions", args)).structuredContent);
  const first = await search(filters);
  assert.deepEqual(first.competitions.map((item) => item.slug), ["aa"]);
  assert.equal(first.next_offset, 1);
  assert.equal(first.hasMore, true);
  assert.equal(first.competitions[0].official_url, "https://example.org/buyer");
  assert.equal(first.competitions[0].source_url, "https://example.org/notice");
  assert.equal(first.competitions[0].evidence_note, "Official notice checked");
  const last = await search({ ...filters, offset: first.next_offset });
  assert.deepEqual(last.competitions.map((item) => item.slug), ["bb"]);
  assert.equal(last.next_offset, null);
  assert.equal(last.hasMore, false);
  assert.deepEqual((await search({ participationFee: "unknown" })).competitions.map((item) => item.slug), ["partial"]);
  assert.deepEqual((await search({ participationFee: "paid" })).competitions.map((item) => item.slug), ["paid"]);
  assert.equal((await search({ ...filters, deadlineBefore: "9999-12-31" })).competitions[0].slug, "aa");
  const detail = async (slug: string) => competitionDetailSchema.parse((await call(handle, "get_competition", { slug })).structuredContent);
  const item = await detail("aa");
  assert.equal(item.qualification_score, 0);
  assert.equal((await detail("partial")).qualification_score, null);
  assert.equal(item.official_url, "https://example.org/buyer");
  assert.equal(item.source_url, "https://example.org/notice");
  assert.equal(item.evidence_note, "Official notice checked");
  assert.equal((await detail("partial")).official_url, null);
  assert.equal((await detail("partial")).submission_fee_eur, null);
  const missing = await call(handle, "get_competition", { slug: "absent" });
  assert.equal(missing.isError, true);
  assert.match(missing.content[0].text, /exact slug/);
});

test("closing soon uses inclusive UTC days and excludes expired and undated records", async (t) => {
  const db = createTestStorage({ now: "2026-12-31T23:59:00Z" });
  t.after(db.cleanup);
  const handle = createMcpHandler(async () => db.storage.opportunities, testAccess(db), db.clock);
  for (const deadline of [null, "2026-12-30", "2026-12-31", "2027-01-01T23:59:00Z", "2027-01-02"]) {
    seedOpportunity(db.raw, { id: deadline ?? "missing", deadline_at: deadline });
  }
  const closingSoon = async (args: Record<string, unknown>) => competitionPageSchema.parse(
    (await call(handle, "list_closing_soon", { days: 2, ...args })).structuredContent,
  );
  const first = await closingSoon({ limit: 1 });
  assert.equal(first.hasMore, true);
  assert.equal(first.next_offset, 1);
  assert.equal(first.competitions[0].deadline_at, "2026-12-31");
  const last = await closingSoon({ limit: 1, offset: first.next_offset });
  assert.equal(last.hasMore, false);
  assert.equal(last.next_offset, null);
  assert.equal(last.competitions[0].deadline_at, "2027-01-01T23:59:00Z");
});

test("the default page has ten rows, the largest page has 25, and its cursor resumes after the last row", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  for (let index = 0; index < 26; index++) {
    seedOpportunity(db.raw, { id: String(index).padStart(2, "0") });
  }
  const handle = createMcpHandler(async () => db.storage.opportunities, testAccess(db), db.clock);
  const search = async (args = {}) => competitionPageSchema.parse((await call(handle, "search_competitions", args)).structuredContent);
  assert.equal((await search()).competitions.length, 10);
  const first = await search({ limit: 25 });
  assert.equal(first.competitions.length, 25);
  assert.equal(first.next_offset, 25);
  const last = await search({ limit: 25, offset: first.next_offset });
  assert.deepEqual(last.competitions.map((item) => item.slug), ["25"]);
  assert.equal(last.hasMore, false);
  assert.equal(last.next_offset, null);

  const exact = await search({ limit: 13, offset: 13 });
  assert.equal(exact.competitions.length, 13);
  assert.equal(exact.hasMore, false);
  assert.equal(exact.next_offset, null);
});

test("hasMore still indicates matching records when the next offset is outside the limit", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  db.raw.transaction(() => {
    for (let index = 0; index <= MCP_MAX_OFFSET + 1; index++) {
      seedOpportunity(db.raw, { id: String(index).padStart(4, "0") });
    }
  })();
  const handle = createMcpHandler(async () => db.storage.opportunities, testAccess(db), db.clock);
  const search = async (offset: number) => competitionPageSchema.parse(
    (await call(handle, "search_competitions", { limit: 1, offset })).structuredContent,
  );

  const previous = await search(MCP_MAX_OFFSET - 1);
  assert.equal(previous.hasMore, true);
  assert.equal(previous.next_offset, MCP_MAX_OFFSET);
  const maximum = await search(MCP_MAX_OFFSET);
  assert.equal(maximum.competitions[0].slug, String(MCP_MAX_OFFSET));
  assert.equal(maximum.hasMore, true);
  assert.equal(maximum.next_offset, null);
});

test("bad arguments return corrective errors before storage access", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const handle = createMcpHandler(noReads, testAccess(db));
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ["search_competitions", { limit: 26 }, /25/],
    ["search_competitions", { offset: 1001 }, /1000/],
    ["search_competitions", { deadlineBefore: "2026-02-30" }, /YYYY-MM-DD/],
    ["search_competitions", { projectTypes: ["wrong"] }, /building_project/],
    ["search_competitions", { participationFee: "cheap" }, /free/],
    ["search_competitions", { licensedArchitectRequired: [true] }, /boolean/],
    ["search_competitions", { deadlineAfter: "2026-02-02", deadlineBefore: "2026-02-01" }, /on or before/],
    ["get_competition", {}, /slug/],
    ["list_closing_soon", { days: 91 }, /90/],
    ["get_taxonomy", { scope: "private" }, /scope/],
  ];
  for (const [name, args, hint] of cases) {
    const result = await call(handle, name, args);
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, hint);
  }
});

test("transport rejects streaming, foreign origins, batches and oversized requests", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const handle = createMcpHandler(noReads, testAccess(db));
  const get = await handle(new Request("http://localhost:3400/mcp", { headers: { accept: "text/event-stream" } }));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get("allow"), "POST");
  assert.equal((await handle(post(rpc("tools/list"), { origin: "https://foreign.example" }))).status, 403);
  assert.equal((await handle(post([rpc("tools/list")]))).status, 400);
  assert.equal((await handle(post(rpc("tools/list", { junk: "x".repeat(16384) })))).status, 413);
});

test("oversized output is reported without truncating evidence", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  seedOpportunity(db.raw, { id: "long", evidence_note: "证".repeat(25000) });
  const handle = createMcpHandler(async () => db.storage.opportunities, testAccess(db), db.clock);
  const response = await handle(post(rpc("tools/call", { name: "get_competition", arguments: { slug: "long" } })));
  const payload = await response.json();
  assert.equal(payload.id, 1);
  assert.match(payload.error.message, /128 KiB/);
  assert.equal(payload.result, undefined);
});

test("both MCP lists reduce the page to fit the full JSON-RPC response and advance by returned rows", async (t) => {
  const db = createTestStorage();
  t.after(db.cleanup);
  const note = '证"\\'.repeat(7_000);
  const url = "https://example.org/buyer";
  for (const id of ["a", "b", "c"]) {
    seedOpportunity(db.raw, { id, deadline_at: "2026-04-19", official_url: url, evidence_note: note });
  }
  seedOpportunity(db.raw, { id: "d", deadline_at: "2026-04-19", evidence_note: "证".repeat(25_000) });
  const handle = createMcpHandler(async () => db.storage.opportunities, testAccess(db), db.clock);
  for (const name of ["search_competitions", "list_closing_soon"]) {
    const id = "测试".repeat(100);
    const request = async (offset: number) => {
      const response = await handle(post({ ...rpc("tools/call", { name, arguments: { offset } }), id }));
      assert.equal(response.status, 200);
      const bytes = await response.arrayBuffer();
      assert.ok(bytes.byteLength <= MCP_MAX_RESPONSE_BYTES);
      const message = JSON.parse(new TextDecoder().decode(bytes));
      assert.equal(message.id, id);
      return message.result;
    };
    const first = competitionPageSchema.parse((await request(0)).structuredContent);
    assert.deepEqual(first.competitions.map((item) => item.slug), ["a"]);
    assert.equal(first.competitions[0].official_url, url);
    assert.equal(first.competitions[0].source_url, "https://example.org/notice");
    assert.equal(first.competitions[0].evidence_note, note);
    assert.equal(first.hasMore, true);
    assert.equal(first.next_offset, 1);
    const next = competitionPageSchema.parse((await request(first.next_offset!)).structuredContent);
    assert.deepEqual(next.competitions.map((item) => item.slug), ["b"]);
    assert.equal(next.next_offset, 2);
    const oversize = await request(3);
    assert.equal(oversize.isError, true);
    assert.match(oversize.content[0].text, /competition exceeds 128 KiB/);
  }
});
