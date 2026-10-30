import assert from "node:assert/strict";
import test from "node:test";

import { createTestStorage, seedOpportunity } from "./testing";

test("current AI exclusions hide from feed/count/facets; human decisions and stale advice survive", async () => {
  const { raw, storage, cleanup } = createTestStorage();
  try {
    for (const [id, status] of [["excluded", "discovered"], ["review", "discovered"], ["stale", "discovered"], ["human", "shortlisted"]]) {
      seedOpportunity(raw, { id, title: id, status });
      const row = raw.prepare("SELECT updated_at FROM competitions WHERE id = ?").get(id) as { updated_at: string };
      raw.prepare(`INSERT INTO ai_screening_results
        (competition_id, source_updated_at, model, decision, relevance_score, result_json, updated_at)
        VALUES (?, ?, 'gpt-6-luna', ?, 10, '{}', ?)`)
        .run(id, id === "stale" ? "old" : row.updated_at, id === "review" ? "needs_review" : "exclude", row.updated_at);
    }
    const result = await storage.opportunities.discover({});
    assert.equal(result.total, 3);
    assert.deepEqual(result.opportunities.map((r) => r.id).sort(), ["human", "review", "stale"]);
    assert.ok(await storage.opportunities.getBySlug("excluded"));
    raw.prepare("DELETE FROM competitions WHERE id = 'excluded'").run();
    const count = raw.prepare("SELECT COUNT(*) n FROM ai_screening_results WHERE competition_id = 'excluded'").get() as { n: number };
    assert.equal(count.n, 0);
  } finally {
    cleanup();
  }
});
