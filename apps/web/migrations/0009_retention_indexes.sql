-- Indexes for the retention deletes in scripts/lib/d1-sync/retention.mjs (0090-retention.sql).
-- Without them each daily retention run full-scans the tables it prunes, which is a steady
-- D1 rows-read cost on top of the sync itself. Only the DELETE predicates that lack a
-- usable index are covered:
--   * DELETE by deadline: competitions.deadline_at < cutoff
--       -> no index on deadline_at existed.
--   * DELETE by AI exclusion: ai_screening_results.decision = 'exclude' AND updated_at < cutoff
--     (joined to competitions on competition_id, which is the results primary key)
--       -> only a single-column index on decision existed; the composite also serves the
--          updated_at range.
--   * Sweep of orphaned results: competition_id NOT IN (SELECT id FROM competitions)
--       -> both sides are primary keys already; no index needed.
--   * The watchlist guard reads workspace_watchlist_entries by opportunity_id, which
--     already has idx_workspace_watchlist_entries_opportunity (0001).
CREATE INDEX IF NOT EXISTS idx_competitions_deadline_at ON competitions (deadline_at);
CREATE INDEX IF NOT EXISTS idx_ai_screening_results_decision_updated ON ai_screening_results (decision, updated_at);
