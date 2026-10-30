-- Local worker advisory results and budget accounting. Not exported to D1.
-- SET NULL retains usage accounting when an expired opportunity is removed.
CREATE TABLE IF NOT EXISTS ai_screening_runs (
    id TEXT PRIMARY KEY,
    competition_id TEXT,
    source_url TEXT NOT NULL,
    model TEXT NOT NULL,
    input_json TEXT NOT NULL,
    status TEXT NOT NULL,
    result_json TEXT,
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL NOT NULL,
    error_code TEXT,
    response_id TEXT,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_screening_competition_model
    ON ai_screening_runs (competition_id, model, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_screening_started_at ON ai_screening_runs (started_at);
CREATE INDEX IF NOT EXISTS idx_ai_screening_source_model ON ai_screening_runs (source_url, model);

CREATE TABLE IF NOT EXISTS ai_screening_results (
    competition_id TEXT PRIMARY KEY,
    source_updated_at TEXT NOT NULL,
    model TEXT NOT NULL,
    decision TEXT NOT NULL,
    relevance_score INTEGER NOT NULL,
    result_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (competition_id) REFERENCES competitions(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_screening_results_decision ON ai_screening_results (decision);
