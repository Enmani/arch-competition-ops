import assert from "node:assert/strict";
import test from "node:test";

import { issueContinuation, readContinuation } from "./continuation";
import { normalizeQuery } from "./query";

test("continuation matches normalized conditions and expires at UTC midnight", () => {
  const issue = new Date("2026-11-22T23:58:00Z");
  const query = normalizeQuery({ limit: 1, licensedArchitectRequired: false, projectTypes: ["building_project", "urban_planning"] });
  const token = issueContinuation("published", issue, query);
  assert.ok(token);
  const next = normalizeQuery({ ...query, limit: 36, offset: 1, projectTypes: ["urban_planning", "building_project"] });
  assert.deepEqual(readContinuation(token, new Date("2026-11-22T23:59:59.999Z"), next), {
    asOf: issue, version: "published",
  });
  assert.equal(readContinuation(token, new Date("2026-11-23T00:00:00Z"), next), null);
  assert.equal(readContinuation(token, issue, { ...next, licensedArchitectRequired: true }), null);
  assert.equal(readContinuation(token, issue, query), null);
});
