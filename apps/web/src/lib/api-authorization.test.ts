import assert from "node:assert/strict";
import test from "node:test";

import { seedOpportunity, seedQueueItem } from "@arch-competition/storage/testing";

import { createOpsReviewDecisionHandlers, createOpsReviewListHandlers } from "./api/ops-review";
import { createSavedSearchHandlers } from "./api/saved-searches";
import { createWatchlistHandlers } from "./api/watchlists";
import { ORIGIN, buildRequest, createApiTestContext, readError, type ApiTestContext } from "./api-test-support";

const withContext = async (
  run: (context: ApiTestContext) => Promise<void>,
  options?: Parameters<typeof createApiTestContext>[0],
) => {
  const context = createApiTestContext(options);
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

const json = (response: Response) => response.json() as Promise<Record<string, unknown>>;

test("watchlist routes reject anonymous callers with 401 and the shared error shape", async () => {
  await withContext(async ({ deps }) => {
    const handlers = createWatchlistHandlers(deps);
    for (const response of [
      await handlers.GET(buildRequest("/api/watchlists")),
      await handlers.POST(buildRequest("/api/watchlists", { body: { opportunityId: "x" }, method: "POST" })),
      await handlers.DELETE(buildRequest("/api/watchlists", { body: { opportunityId: "x" }, method: "DELETE" })),
    ]) {
      assert.equal(response.status, 401);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.equal((await readError(response)).code, "unauthenticated");
    }
  });
});

test("a signed-in user can watch, list and unwatch; the workspace comes from the session", async () => {
  await withContext(async (context) => {
    seedOpportunity(context.test.raw, { id: "one", title: "One" });
    const alice = await context.signIn("alice@example.com");
    const handlers = createWatchlistHandlers(context.deps);

    const created = await handlers.POST(buildRequest("/api/watchlists", { body: { opportunityId: "one" }, cookie: alice.cookie, method: "POST" }));
    assert.equal(created.status, 201);
    assert.equal(((await json(created)).item as { workspaceKey: string }).workspaceKey, `user:${alice.userId}`);

    const listed = await json(await handlers.GET(buildRequest("/api/watchlists", { cookie: alice.cookie })));
    assert.deepEqual(listed.watchedOpportunityIds, ["one"]);
    assert.ok(!("workspaceKey" in listed), "the workspace key is not exposed to clients");

    const removed = await handlers.DELETE(buildRequest("/api/watchlists", { body: { opportunityId: "one" }, cookie: alice.cookie, method: "DELETE" }));
    assert.deepEqual(await json(removed), { alreadyDeleted: false, deleted: true, opportunityId: "one" });
  });
});

test("users cannot read, modify or probe each other's watchlist, even by sending a workspace key", async () => {
  await withContext(async (context) => {
    seedOpportunity(context.test.raw, { id: "one", title: "One" });
    const alice = await context.signIn("alice@example.com");
    const bob = await context.signIn("bob@example.com");
    const handlers = createWatchlistHandlers(context.deps);

    await handlers.POST(buildRequest("/api/watchlists", { body: { opportunityId: "one" }, cookie: alice.cookie, method: "POST" }));

    const bobList = await json(await handlers.GET(buildRequest("/api/watchlists", { cookie: bob.cookie })));
    assert.deepEqual(bobList.watchedOpportunityIds, []);

    const bobDelete = await json(await handlers.DELETE(buildRequest("/api/watchlists", { body: { opportunityId: "one" }, cookie: bob.cookie, method: "DELETE" })));
    assert.equal(bobDelete.alreadyDeleted, true);

    const smuggled = await handlers.POST(buildRequest("/api/watchlists", { body: { opportunityId: "one", workspaceKey: `user:${alice.userId}` }, cookie: bob.cookie, method: "POST" }));
    assert.equal(smuggled.status, 400);

    const aliceList = await json(await handlers.GET(buildRequest("/api/watchlists", { cookie: alice.cookie })));
    assert.deepEqual(aliceList.watchedOpportunityIds, ["one"]);
  });
});

test("watchlist writes validate the body: unknown opportunity 404, wrong content type 415, bad JSON and schema 400", async () => {
  await withContext(async (context) => {
    const alice = await context.signIn("alice@example.com");
    const handlers = createWatchlistHandlers(context.deps);
    const post = (options: Parameters<typeof buildRequest>[1]) => handlers.POST(buildRequest("/api/watchlists", { cookie: alice.cookie, method: "POST", ...options }));

    const unknown = await post({ body: { opportunityId: "missing" } });
    assert.equal(unknown.status, 404);
    assert.equal((await readError(unknown)).code, "not_found");

    const wrongType = await post({ body: JSON.stringify({ opportunityId: "x" }), contentType: "text/plain" });
    assert.equal(wrongType.status, 415);
    assert.equal((await readError(wrongType)).code, "unsupported_media_type");

    assert.equal((await post({ body: JSON.stringify({ opportunityId: "x" }), contentType: null })).status, 415);
    assert.equal((await post({ body: "{not json" })).status, 400);
    assert.equal((await post({ body: { opportunityId: "" } })).status, 400);
    assert.equal((await post({ body: { opportunityId: 42 } })).status, 400);
  });
});

test("cross-origin writes are rejected before authentication is even considered", async () => {
  await withContext(async (context) => {
    seedOpportunity(context.test.raw, { id: "one", title: "One" });
    const alice = await context.signIn("alice@example.com");
    const handlers = createWatchlistHandlers(context.deps);
    const attempt = (origin: string | null, headers: Record<string, string> = {}) =>
      handlers.POST(buildRequest("/api/watchlists", { body: { opportunityId: "one" }, cookie: alice.cookie, headers, method: "POST", origin }));

    const evil = await attempt("https://evil.example");
    assert.equal(evil.status, 403);
    assert.equal((await readError(evil)).code, "csrf_rejected");
    assert.equal((await attempt("null")).status, 403);
    assert.equal((await attempt(null)).status, 403, "no Origin, no Sec-Fetch-Site, no Referer");
    assert.equal((await attempt(null, { "sec-fetch-site": "cross-site" })).status, 403);
    assert.equal((await attempt(null, { "sec-fetch-site": "same-origin" })).status, 201);
    assert.equal((await attempt(ORIGIN)).status, 201);
  });
});

test("saved searches require sign-in, are private per user and validate their input", async () => {
  await withContext(async (context) => {
    const alice = await context.signIn("alice@example.com");
    const bob = await context.signIn("bob@example.com");
    const handlers = createSavedSearchHandlers(context.deps);

    assert.equal((await handlers.GET(buildRequest("/api/saved-searches"))).status, 401);
    assert.equal((await handlers.POST(buildRequest("/api/saved-searches", { body: { name: "x", searchParams: { jurisdiction: "italy" } }, method: "POST" }))).status, 401);

    const created = await handlers.POST(buildRequest("/api/saved-searches", { body: { name: "Italy", searchParams: { jurisdiction: "italy", projectType: ["urban_planning"] } }, cookie: alice.cookie, method: "POST" }));
    assert.equal(created.status, 201);
    const item = (await json(created)).item as { filters: unknown; id: number };
    assert.deepEqual(item.filters, { jurisdiction: "italy", projectTypes: ["urban_planning"] });

    assert.deepEqual((await json(await handlers.GET(buildRequest("/api/saved-searches", { cookie: bob.cookie })))).items, []);
    const bobDelete = await json(await handlers.DELETE(buildRequest("/api/saved-searches", { body: { id: item.id }, cookie: bob.cookie, method: "DELETE" })));
    assert.equal(bobDelete.alreadyDeleted, true);
    assert.equal(((await json(await handlers.GET(buildRequest("/api/saved-searches", { cookie: alice.cookie })))).items as unknown[]).length, 1);

    const noFilters = await handlers.POST(buildRequest("/api/saved-searches", { body: { name: "Empty", searchParams: {} }, cookie: alice.cookie, method: "POST" }));
    assert.equal(noFilters.status, 400);
    const badFilter = await handlers.POST(buildRequest("/api/saved-searches", { body: { name: "Bad", searchParams: { projectType: "castle" } }, cookie: alice.cookie, method: "POST" }));
    assert.equal(badFilter.status, 400);
    const longName = await handlers.POST(buildRequest("/api/saved-searches", { body: { name: "x".repeat(81), searchParams: { jurisdiction: "italy" } }, cookie: alice.cookie, method: "POST" }));
    assert.equal(longName.status, 400);
  });
});

const ADMIN_ENVIRONMENT = { ARCH_OPS_ADMIN_EMAILS: " Boss@Example.com , second@example.com" };

test("ops review is administrator-only for reading and deciding: 401 anonymous, 403 for everyone else", async () => {
  await withContext(async (context) => {
    seedQueueItem(context.test.raw, { queue_id: "q1" });
    const member = await context.signIn("member@example.com");
    const list = createOpsReviewListHandlers(context.deps);
    const decide = createOpsReviewDecisionHandlers(context.deps);
    const decision = (cookie?: string) =>
      decide.PATCH(buildRequest("/api/ops/review/q1", { body: { decision: "accepted" }, cookie, method: "PATCH" }), { params: Promise.resolve({ queueId: "q1" }) });

    assert.equal((await list.GET(buildRequest("/api/ops/review"))).status, 401);
    assert.equal((await decision()).status, 401);

    // No ARCH_OPS_ADMIN_EMAILS configured: nobody is an administrator.
    const forbiddenRead = await list.GET(buildRequest("/api/ops/review", { cookie: member.cookie }));
    assert.equal(forbiddenRead.status, 403);
    assert.equal((await readError(forbiddenRead)).code, "forbidden");
    assert.equal((await decision(member.cookie)).status, 403);
    assert.equal((context.test.raw.prepare("SELECT COUNT(*) AS total FROM ops_review_decisions").get() as { total: number }).total, 0);
  });
});

test("administrators (case-insensitive ARCH_OPS_ADMIN_EMAILS) can read the queue; the actor is always the session email", async () => {
  await withContext(
    async (context) => {
      seedQueueItem(context.test.raw, { queue_id: "q1" });
      const admin = await context.signIn("BOSS@example.com");
      const list = createOpsReviewListHandlers(context.deps);
      const decide = createOpsReviewDecisionHandlers(context.deps);
      const patch = (body: unknown, queueId = "q1") =>
        decide.PATCH(buildRequest(`/api/ops/review/${queueId}`, { body, cookie: admin.cookie, method: "PATCH" }), { params: Promise.resolve({ queueId }) });

      const listed = await json(await list.GET(buildRequest("/api/ops/review", { cookie: admin.cookie })));
      assert.equal((listed.items as unknown[]).length, 1);
      assert.ok(!("reviewEnabled" in listed));

      const forged = await patch({ actorLabel: "someone else", decision: "accepted" });
      assert.equal(forged.status, 400);

      const accepted = await patch({ decision: "accepted", note: "  looks right " });
      assert.equal(accepted.status, 200);
      const { item } = (await json(accepted)) as { item: { latestDecision: { actorLabel: string; note: string } } };
      assert.equal(item.latestDecision.actorLabel, "boss@example.com");
      assert.equal(item.latestDecision.note, "looks right");

      assert.equal((await patch({ decision: "accepted", note: "x".repeat(2001) })).status, 400);
      assert.equal((await patch({ decision: "approve" })).status, 400);
      const missing = await patch({ decision: "accepted" }, "nope");
      assert.equal(missing.status, 404);
      assert.equal((await list.GET(buildRequest("/api/ops/review?status=bogus", { cookie: admin.cookie }))).status, 400);
    },
    { environment: ADMIN_ENVIRONMENT },
  );
});

test("ops decisions are CSRF-protected and require JSON", async () => {
  await withContext(
    async (context) => {
      seedQueueItem(context.test.raw, { queue_id: "q1" });
      const admin = await context.signIn("boss@example.com");
      const decide = createOpsReviewDecisionHandlers(context.deps);
      const patch = (options: Parameters<typeof buildRequest>[1]) =>
        decide.PATCH(buildRequest("/api/ops/review/q1", { cookie: admin.cookie, method: "PATCH", ...options }), { params: Promise.resolve({ queueId: "q1" }) });

      assert.equal((await patch({ body: { decision: "accepted" }, origin: "https://evil.example" })).status, 403);
      assert.equal((await patch({ body: JSON.stringify({ decision: "accepted" }), contentType: "text/plain" })).status, 415);
      assert.equal((await patch({ body: { decision: "accepted" } })).status, 200);
    },
    { environment: ADMIN_ENVIRONMENT },
  );
});
