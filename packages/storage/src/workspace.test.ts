import assert from "node:assert/strict";
import test from "node:test";

import { StorageNotFoundError, StorageValidationError, workspaceKeyForUser } from "./index";
import { createTestStorage, seedOpportunity, type TestStorage } from "./testing";

const withStorage = async (run: (context: TestStorage) => Promise<void>) => {
  const context = createTestStorage();
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

test("workspace keys are derived from the user id", () => {
  assert.equal(workspaceKeyForUser("abc-123"), "user:abc-123");
  assert.throws(() => workspaceKeyForUser("  "), StorageValidationError);
});

test("watchlist entries are created idempotently, listed newest first, and removed", async () => {
  await withStorage(async ({ clock, raw, storage }) => {
    seedOpportunity(raw, { id: "one", title: "One" });
    seedOpportunity(raw, { id: "two", title: "Two" });
    const workspaceKey = workspaceKeyForUser("u1");

    const first = await storage.watchlist.add({ opportunityId: "one", workspaceKey });
    clock.set("2026-04-19T13:00:00.000Z");
    await storage.watchlist.add({ opportunityId: "two", workspaceKey });
    clock.set("2026-04-19T14:00:00.000Z");
    const again = await storage.watchlist.add({ opportunityId: "one", workspaceKey });

    assert.equal(again.id, first.id);
    assert.equal(again.createdAt, first.createdAt);
    assert.notEqual(again.updatedAt, first.updatedAt);
    assert.deepEqual(await storage.watchlist.listIds(workspaceKey), ["one", "two"]);
    assert.equal((await storage.watchlist.list({ workspaceKey })).length, 2);
    assert.equal(await storage.watchlist.isWatched({ opportunityId: "two", workspaceKey }), true);

    assert.equal(await storage.watchlist.remove({ opportunityId: "two", workspaceKey }), true);
    assert.equal(await storage.watchlist.remove({ opportunityId: "two", workspaceKey }), false);
    assert.equal(await storage.watchlist.isWatched({ opportunityId: "two", workspaceKey }), false);
  });
});

test("watchlist writes reject unknown opportunity ids without inserting anything", async () => {
  await withStorage(async ({ raw, storage }) => {
    await assert.rejects(
      storage.watchlist.add({ opportunityId: "missing", workspaceKey: workspaceKeyForUser("u1") }),
      StorageNotFoundError,
    );
    assert.equal((raw.prepare("SELECT COUNT(*) AS total FROM workspace_watchlist_entries").get() as { total: number }).total, 0);
  });
});

test("concurrent identical watch requests leave exactly one row", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "one", title: "One" });
    const workspaceKey = workspaceKeyForUser("u1");
    await Promise.all(Array.from({ length: 20 }, () => storage.watchlist.add({ opportunityId: "one", workspaceKey })));

    assert.equal((raw.prepare("SELECT COUNT(*) AS total FROM workspace_watchlist_entries").get() as { total: number }).total, 1);
  });
});

test("one user cannot read, probe or delete another user's workspace", async () => {
  await withStorage(async ({ raw, storage }) => {
    seedOpportunity(raw, { id: "one", title: "One" });
    const alice = workspaceKeyForUser("alice");
    const bob = workspaceKeyForUser("bob");

    await storage.watchlist.add({ opportunityId: "one", workspaceKey: alice });
    const saved = await storage.savedSearches.create({ filters: { jurisdiction: "italy" }, name: "Italy", workspaceKey: alice });

    assert.deepEqual(await storage.watchlist.listIds(bob), []);
    assert.equal(await storage.watchlist.isWatched({ opportunityId: "one", workspaceKey: bob }), false);
    assert.equal(await storage.watchlist.remove({ opportunityId: "one", workspaceKey: bob }), false);
    assert.deepEqual(await storage.savedSearches.list({ workspaceKey: bob }), []);
    assert.equal(await storage.savedSearches.delete({ id: saved.id, workspaceKey: bob }), false);

    assert.deepEqual(await storage.watchlist.listIds(alice), ["one"]);
    assert.equal((await storage.savedSearches.list({ workspaceKey: alice })).length, 1);
  });
});

test("saved searches store canonical filters and ignore paging fields", async () => {
  await withStorage(async ({ storage }) => {
    const workspaceKey = workspaceKeyForUser("u1");
    const saved = await storage.savedSearches.create({
      filters: {
        buildingCategories: ["housing", "education"],
        jurisdiction: "france",
        limit: 36,
        offset: 72,
        sort: "latest",
      },
      name: "  Housing   in France ",
      workspaceKey,
    });

    assert.equal(saved.name, "Housing in France");
    assert.deepEqual(saved.filters, {
      buildingCategories: ["education", "housing"],
      jurisdiction: "france",
      sort: "latest",
    });

    assert.equal(await storage.savedSearches.delete({ id: saved.id, workspaceKey }), true);
    assert.equal(await storage.savedSearches.delete({ id: saved.id, workspaceKey }), false);
  });
});

test("saved searches validate name and require at least one filter", async () => {
  await withStorage(async ({ storage }) => {
    const workspaceKey = workspaceKeyForUser("u1");
    await assert.rejects(storage.savedSearches.create({ filters: { jurisdiction: "italy" }, name: "  ", workspaceKey }), StorageValidationError);
    await assert.rejects(storage.savedSearches.create({ filters: { jurisdiction: "italy" }, name: "x".repeat(81), workspaceKey }), StorageValidationError);
    await assert.rejects(storage.savedSearches.create({ filters: { limit: 10 }, name: "Empty", workspaceKey }), StorageValidationError);
  });
});

test("equivalent saved searches are one row even under concurrent creation; the latest name wins", async () => {
  await withStorage(async ({ raw, storage }) => {
    const workspaceKey = workspaceKeyForUser("u1");
    const results = await Promise.all(
      Array.from({ length: 25 }, (_, index) =>
        storage.savedSearches.create({
          filters: { jurisdiction: "italy", projectTypes: index % 2 === 0 ? ["urban_planning", "building_project"] : ["building_project", "urban_planning"] },
          name: `Name ${index}`,
          workspaceKey,
        }),
      ),
    );

    assert.equal(new Set(results.map((item) => item.id)).size, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS total FROM workspace_saved_searches").get() as { total: number }).total, 1);

    const renamed = await storage.savedSearches.create({
      filters: { jurisdiction: "italy", projectTypes: ["building_project", "urban_planning"] },
      name: "Final name",
      workspaceKey,
    });
    assert.equal(renamed.id, results[0].id);
    assert.equal(renamed.name, "Final name");
  });
});

test("the same filters in different workspaces are separate saved searches", async () => {
  await withStorage(async ({ storage }) => {
    const filters = { jurisdiction: "italy" };
    const a = await storage.savedSearches.create({ filters, name: "A", workspaceKey: workspaceKeyForUser("a") });
    const b = await storage.savedSearches.create({ filters, name: "B", workspaceKey: workspaceKeyForUser("b") });
    assert.notEqual(a.id, b.id);
  });
});
