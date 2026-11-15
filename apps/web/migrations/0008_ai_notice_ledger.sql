-- Local worker ledger of notices already screened, so an unchanged notice is never triaged,
-- fetched or assessed twice. A row means: this source listed exactly this content
-- (content_hash) and it was decided under exactly these screening criteria (criteria_hash).
-- Changed content (a corrigendum, a moved deadline) or changed criteria produce a new key and
-- are screened again. Not exported to D1.
CREATE TABLE IF NOT EXISTS ai_notice_ledger (
    source_id TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    criteria_hash TEXT NOT NULL,
    outcome TEXT NOT NULL,
    source_url TEXT NOT NULL,
    recorded_at TEXT NOT NULL,
    PRIMARY KEY (source_id, content_hash, criteria_hash)
);
CREATE INDEX IF NOT EXISTS idx_ai_notice_ledger_recorded_at ON ai_notice_ledger (recorded_at);
