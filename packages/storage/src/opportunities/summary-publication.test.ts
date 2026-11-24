import assert from "node:assert/strict";
import test from "node:test";

import { fromBetterSqlite3 } from "../driver/better-sqlite3";
import { createStorage } from "../storage";
import { createTestStorage, seedOpportunity } from "../testing";
import { buildAggregateStatement } from "./aggregate";
import { normalizeQuery } from "./query";
import { DISCOVER_SUMMARY_FORMAT } from "./summary-publication";

test("day, format and sync state select the published summary or the exact live view", async (t) => {
  const { raw, storage, clock, cleanup } = createTestStorage({ now: "2026-11-22T23:55:00Z" });
  t.after(cleanup);
  seedOpportunity(raw, { id: "today", deadline_at: "2026-11-22", jurisdiction: "Italy" });
  seedOpportunity(raw, { id: "undated", jurisdiction: "France" });
  const payloadFor = (day: string) => {
    const statement = buildAggregateStatement(normalizeQuery(), { now: () => new Date(day) });
    return (raw.prepare(statement.sql).get(...statement.parameters!) as { payload: string }).payload;
  };
  const today = payloadFor("2026-11-22");
  const tomorrow = payloadFor("2026-11-23");

  assert.equal((await storage.opportunities.discover()).continuation, null);
  raw.prepare(`INSERT INTO discover_publication
    (id, sync_id, syncing, version, summary_format, summary_day, next_summary_day, payload_today, payload_tomorrow)
    VALUES (1, 'first-export', 0, 'first-version', ?, '2026-11-22', '2026-11-23', ?, ?)`)
    .run(DISCOVER_SUMMARY_FORMAT, today, tomorrow);
  const first = await storage.opportunities.discover({ limit: 1 });
  assert.equal(first.total, 2);
  assert.deepEqual(first.filterOptions.jurisdictions, ["France", "Italy"]);
  assert.ok(first.continuation);
  assert.deepEqual((await storage.opportunities.continue({ limit: 1, offset: 1 }, first.continuation))
    ?.map(({ id }) => id), ["undated"]);

  raw.exec("UPDATE discover_publication SET syncing = 1");
  seedOpportunity(raw, { id: "syncing", jurisdiction: "Spain" });
  assert.equal(await storage.opportunities.continue({ offset: 1 }, first.continuation), null);
  const live = await storage.opportunities.discover();
  assert.equal(live.total, 3);
  assert.deepEqual(live.filterOptions.jurisdictions, ["France", "Italy", "Spain"]);
  assert.equal(live.continuation, null);

  raw.exec("DELETE FROM competitions WHERE id = 'syncing'");
  raw.exec("UPDATE discover_publication SET syncing = 0, version = 'next-version'");
  clock.set("2026-11-23T00:00:00Z");
  assert.equal((await storage.opportunities.discover()).total, 1);

  raw.exec("UPDATE discover_publication SET summary_format = 0");
  seedOpportunity(raw, { id: "after", jurisdiction: "Portugal" });
  assert.equal((await storage.opportunities.discover()).total, 2);
  raw.exec("UPDATE discover_publication SET summary_format = " + DISCOVER_SUMMARY_FORMAT);
  clock.set("2026-11-24T00:00:00Z");
  assert.equal((await storage.opportunities.discover()).total, 2);
  raw.exec("DROP TABLE discover_publication");
  assert.equal((await storage.opportunities.discover()).total, 2);
});

test("a normal day between deadlines uses the existing single batch of two reads", async t => {
  const { raw, clock, cleanup } = createTestStorage({ now: "2026-11-25" });
  t.after(cleanup);
  raw.prepare(`INSERT INTO discover_publication
    (id, sync_id, syncing, version, summary_format, summary_day, next_summary_day, payload_today)
    VALUES (1, 'sync', 0, 'version', ?, '2026-11-24', '2026-12-03',
      (SELECT payload FROM (${buildAggregateStatement(normalizeQuery(), clock).sql})))`)
    .run(DISCOVER_SUMMARY_FORMAT, "2026-11-24");
  const reader = fromBetterSqlite3(raw);
  const batch = t.mock.method(reader, "batch");
  const prepare = t.mock.method(reader, "prepare");
  const storage = createStorage({ reader, writer: reader, clock });
  assert.equal((await storage.opportunities.discover()).total, 0);
  assert.equal(batch.mock.callCount(), 1);
  assert.equal(prepare.mock.callCount(), 2);
});
