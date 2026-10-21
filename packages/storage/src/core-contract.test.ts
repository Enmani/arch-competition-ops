import assert from "node:assert/strict";
import test from "node:test";

import {
  DISCOVER_DEFAULT_LIMIT,
  DISCOVER_MAX_LIMIT,
  apiErrorSchema,
  createLogger,
  opsReviewDecisionSchema,
  opsReviewListQuerySchema,
  parseDiscoverFilters,
  parseDiscoverQuery,
  savedSearchCreateSchema,
  watchlistMutationSchema,
} from "@arch-competition/core";

// These tests exercise @arch-competition/core. They live in the storage package only because
// the repository's `test:storage` script is the one test entry point that runs packages/*.

test("lenient discover parsing maps query names, drops invalid parts and clamps numbers", () => {
  const result = parseDiscoverQuery({
    buildingCategory: ["education", "nonsense"],
    deadlineAfter: "2026-02-31",
    limit: "9999",
    offset: "-4",
    projectType: "urban_planning",
    publishedWithinDays: "1000000000",
    search: "  school   hall ",
    sort: "bogus",
  });
  assert.ok(result.ok);
  assert.deepEqual(result.filters, {
    buildingCategories: ["education"],
    limit: DISCOVER_MAX_LIMIT,
    offset: 0,
    projectTypes: ["urban_planning"],
    publishedWithinDays: 3650,
    search: "school hall",
  });
});

test("strict discover parsing reports invalid enums and dates for the API boundary", () => {
  const result = parseDiscoverQuery({ deadlineBefore: "tomorrow", projectType: "castle" }, "strict");
  assert.equal(result.ok, false);
  assert.ok(!result.ok && result.issues.length === 2);
});

test("discover parsing ignores blank values and normalizes booleans", () => {
  const result = parseDiscoverQuery({ includeExpired: "true", jurisdiction: "   ", licensedArchitectRequired: "false", limit: "" });
  assert.ok(result.ok);
  assert.deepEqual(result.filters, { includeExpired: true, licensedArchitectRequired: false });
  assert.equal(parseDiscoverFilters({ includeExpired: "maybe" }, "strict").ok, false);
  assert.equal(DISCOVER_DEFAULT_LIMIT, 24);
});

test("saved-search JSON is parsed with the same schema", () => {
  const result = parseDiscoverFilters({ buildingCategories: ["housing"], minEstimatedValueEur: 1e15, sort: "latest" }, "strict");
  assert.ok(result.ok);
  assert.deepEqual(result.filters, { buildingCategories: ["housing"], minEstimatedValueEur: 1_000_000_000_000, sort: "latest" });
});

test("API body schemas reject unknown keys, including a client-supplied actor label", () => {
  assert.equal(opsReviewDecisionSchema.safeParse({ decision: "accepted" }).success, true);
  assert.equal(opsReviewDecisionSchema.safeParse({ actorLabel: "someone else", decision: "accepted" }).success, false);
  assert.equal(opsReviewDecisionSchema.safeParse({ decision: "accepted", note: "x".repeat(2001) }).success, false);
  assert.equal(opsReviewDecisionSchema.safeParse({ decision: "maybe" }).success, false);
  assert.equal(watchlistMutationSchema.safeParse({ opportunityId: "abc", extra: 1 }).success, false);
  assert.equal(watchlistMutationSchema.safeParse({ opportunityId: "  " }).success, false);
  assert.equal(savedSearchCreateSchema.safeParse({ name: "n", searchParams: { sort: "latest" } }).success, true);
  assert.equal(savedSearchCreateSchema.safeParse({ name: "", searchParams: {} }).success, false);
});

test("ops list query defaults and bounds", () => {
  const defaults = opsReviewListQuerySchema.parse({ activeOnly: null, limit: null, reasonCode: null, status: null });
  assert.deepEqual(defaults, { activeOnly: "true", limit: 50, reasonCode: "all", status: "pending" });
  assert.equal(opsReviewListQuerySchema.parse({ activeOnly: null, limit: "9999", reasonCode: null, status: null }).limit, 200);
  assert.equal(opsReviewListQuerySchema.safeParse({ activeOnly: null, limit: null, reasonCode: "x", status: null }).success, false);
});

test("the shared error envelope is { error: { code, message } }", () => {
  assert.equal(apiErrorSchema.safeParse({ error: { code: "forbidden", message: "No." } }).success, true);
  assert.equal(apiErrorSchema.safeParse({ error: "plain string" }).success, false);
});

test("the logger redacts credentials, keeps emails and reduces errors to diagnostics", () => {
  const lines: string[] = [];
  const sink = { debug: () => undefined, error: (line: string) => lines.push(line), info: () => undefined, warn: () => undefined };
  const logger = createLogger("test", sink);
  logger.error("auth.failed", {
    email: "user@example.com",
    error: new Error("boom"),
    nested: { cookie: "session=abc", password: "hunter2", sessionToken: "t" },
    password: "hunter2",
    token: "abc",
  });

  const entry = JSON.parse(lines[0]);
  assert.equal(entry.email, "user@example.com");
  assert.equal(entry.password, "[redacted]");
  assert.equal(entry.token, "[redacted]");
  assert.equal(entry.nested.cookie, "[redacted]");
  assert.equal(entry.nested.sessionToken, "[redacted]");
  assert.equal(entry.error.message, "boom");
  assert.ok(!lines[0].includes("hunter2"));
});
