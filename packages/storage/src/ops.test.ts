import assert from "node:assert/strict";
import test from "node:test";

import { StorageNotFoundError, StorageValidationError } from "./index";
import { createTestStorage, seedOpportunity, seedQueueItem, type TestStorage } from "./testing";

const withStorage = async (run: (context: TestStorage) => Promise<void>) => {
  const context = createTestStorage();
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

const countRows = (context: TestStorage, table: string) =>
  (context.raw.prepare(`SELECT COUNT(*) AS total FROM ${table}`).get() as { total: number }).total;

test("ops snapshot counts verified and primary-source records", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "a", status: "verified", evidence_level: "official_notice" });
    seedOpportunity(raw, { id: "b", evidence_level: "official_listing" });
    seedOpportunity(raw, { id: "c", evidence_level: "secondary" });

    assert.deepEqual(await storage.ops.snapshot(), { primary: 2, total: 3, verified: 1 });
  });
});

test("source health is ordered failed-first and exposes parser diagnostics", async () => {
  await withStorage(async ({ raw, storage }) => {
    const insert = raw.prepare(
      `INSERT INTO source_health (source_id, source_name, source_kind, source_tier, last_status, last_parse_failure_count, duplicate_group_count, last_error, updated_at)
       VALUES (?, ?, 'official_procurement', 'primary', ?, ?, ?, ?, '2026-04-19')`,
    );
    insert.run("ok", "Healthy source", "success", 0, 0, null);
    insert.run("dup", "Duplicate source", "success", 0, 2, null);
    insert.run("parse", "Parser source", "success", 3, 0, null);
    insert.run("bad", "Failed source", "failed", 0, 0, "timeout");

    const health = await storage.ops.sourceHealth(10);
    assert.deepEqual(health.map((item) => item.sourceId), ["bad", "parse", "dup", "ok"]);
    assert.equal(health[0].lastError, "timeout");
    assert.equal(health[1].lastParseFailureCount, 3);
    assert.equal((await storage.ops.sourceHealth(2)).length, 2);
  });
});

test("duplicate pressure is derived from canonical dedup keys", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "a", dedup_key: "k1" });
    seedOpportunity(raw, { id: "b", dedup_key: "k1" });
    seedOpportunity(raw, { id: "c", dedup_key: "k1" });
    seedOpportunity(raw, { id: "d", dedup_key: "k2" });
    seedOpportunity(raw, { id: "e", dedup_key: "k2" });
    seedOpportunity(raw, { id: "f", dedup_key: "k3" });

    assert.deepEqual(await storage.ops.duplicatePressure(), {
      duplicateGroups: 2,
      maxDuplicateGroupSize: 3,
      recordsInDuplicateGroups: 5,
    });
  });
});

test("review summary counts active items by status and reason", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedQueueItem(raw, { queue_id: "q1", reason_code: "duplicate_cluster", status: "pending" });
    seedQueueItem(raw, { queue_id: "q2", reason_code: "duplicate_cluster", status: "accepted" });
    seedQueueItem(raw, { queue_id: "q3", reason_code: "source_run_failed", status: "needs_follow_up" });
    seedQueueItem(raw, { is_active: 0, queue_id: "q4", status: "pending" });

    const summary = await storage.ops.reviewSummary();
    assert.deepEqual(
      { accepted: summary.accepted, active: summary.active, needsFollowUp: summary.needsFollowUp, pending: summary.pending, total: summary.total },
      { accepted: 1, active: 3, needsFollowUp: 1, pending: 1, total: 4 },
    );
    assert.deepEqual(summary.reasons, [
      { count: 2, reasonCode: "duplicate_cluster" },
      { count: 1, reasonCode: "source_run_failed" },
    ]);
  });
});

test("review queue returns active items ordered by status then priority and honours filters", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedQueueItem(raw, { priority: 1, queue_id: "low", status: "pending" });
    seedQueueItem(raw, { priority: 9, queue_id: "high", status: "pending" });
    seedQueueItem(raw, { priority: 5, queue_id: "follow", status: "needs_follow_up" });
    seedQueueItem(raw, { is_active: 0, priority: 99, queue_id: "inactive", status: "pending" });
    seedQueueItem(raw, { queue_id: "reason", reason_code: "evidence_conflict", status: "pending" });

    assert.deepEqual((await storage.ops.reviewQueue()).map((item) => item.queueId), ["high", "low", "reason"]);
    assert.deepEqual((await storage.ops.reviewQueue({ status: "all" })).map((item) => item.queueId), ["high", "low", "reason", "follow"]);
    assert.deepEqual((await storage.ops.reviewQueue({ reasonCode: "evidence_conflict" })).map((item) => item.queueId), ["reason"]);
    assert.equal((await storage.ops.reviewQueue({ activeOnly: false, status: "all" })).length, 5);
  });
});

test("a malformed queue payload degrades to an empty object", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedQueueItem(raw, { payload_json: "not json", queue_id: "bad" });
    assert.deepEqual((await storage.ops.reviewQueue())[0].payload, {});
  });
});

test("a decision updates the queue status and the audit row together and reports the latest decision", async () => {
  await withStorage(async (context) => {
    const { clock, raw, storage } = context;
    seedQueueItem(raw, { queue_id: "q1" });

    clock.set("2026-04-19T13:00:00.000Z");
    const first = await storage.ops.writeDecision({ actorLabel: "admin@example.com", decision: "needs_follow_up", note: "  check source  ", queueId: "q1" });
    assert.equal(first.status, "needs_follow_up");
    assert.deepEqual(first.latestDecision, {
      actorLabel: "admin@example.com",
      createdAt: "2026-04-19T13:00:00.000Z",
      decision: "needs_follow_up",
      note: "check source",
    });

    clock.set("2026-04-19T14:00:00.000Z");
    const second = await storage.ops.writeDecision({ actorLabel: "admin@example.com", decision: "accepted", queueId: "q1" });
    assert.equal(second.status, "accepted");
    assert.equal(second.latestDecision?.decision, "accepted");
    assert.equal(second.latestDecision?.note, null);
    assert.equal(countRows(context, "ops_review_decisions"), 2);
  });
});

test("an unknown queue item writes nothing (atomic decision)", async () => {
  await withStorage(async (context) => {
    seedQueueItem(context.raw, { queue_id: "q1" });
    await assert.rejects(
      context.storage.ops.writeDecision({ actorLabel: "admin@example.com", decision: "accepted", queueId: "nope" }),
      StorageNotFoundError,
    );
    assert.equal(countRows(context, "ops_review_decisions"), 0);
    assert.equal((await context.storage.ops.reviewQueue())[0].status, "pending");
  });
});

test("decisions validate the decision value, the note length and the actor label", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedQueueItem(raw, { queue_id: "q1" });
    await assert.rejects(storage.ops.writeDecision({ actorLabel: "a@b.co", decision: "approve" as never, queueId: "q1" }), StorageValidationError);
    await assert.rejects(storage.ops.writeDecision({ actorLabel: "a@b.co", decision: "accepted", note: "x".repeat(2001), queueId: "q1" }), StorageValidationError);
    await assert.rejects(storage.ops.writeDecision({ actorLabel: "  ", decision: "accepted", queueId: "q1" }), StorageValidationError);
  });
});

test("concurrent decisions never lose an audit row", async () => {
  await withStorage(async (context) => {
    seedQueueItem(context.raw, { queue_id: "q1" });
    await Promise.all(
      (["accepted", "rejected", "needs_follow_up", "pending", "accepted"] as const).map((decision) =>
        context.storage.ops.writeDecision({ actorLabel: "admin@example.com", decision, queueId: "q1" }),
      ),
    );
    assert.equal(countRows(context, "ops_review_decisions"), 5);
  });
});
