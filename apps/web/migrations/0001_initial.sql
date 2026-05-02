CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    organizer TEXT NOT NULL,
    authority_name TEXT,
    official_url TEXT,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL,
    opportunity_type TEXT NOT NULL,
    jurisdiction TEXT,
    procedure_type TEXT,
    official_notice_id TEXT,
    regions TEXT NOT NULL,
    languages TEXT NOT NULL,
    competition_types TEXT NOT NULL,
    audience TEXT NOT NULL,
    cpv_codes TEXT NOT NULL,
    implementation_path TEXT,
    licensed_architect_required INTEGER,
    local_partner_required INTEGER,
    registration_fee_eur REAL,
    submission_fee_eur REAL,
    estimated_contract_value_eur REAL,
    estimated_contract_value_text TEXT,
    prize_summary TEXT,
    deadline_at TEXT,
    eligibility_summary TEXT,
    brief_pdf_url TEXT,
    documents_portal_url TEXT,
    extraction_confidence REAL NOT NULL,
    evidence_level TEXT NOT NULL,
    qualification_score REAL,
    evidence_note TEXT,
    last_verified_at TEXT,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_competitions_dedup_key ON competitions (dedup_key);
CREATE INDEX IF NOT EXISTS idx_competitions_official_url ON competitions (official_url);
CREATE INDEX IF NOT EXISTS idx_competitions_notice_id ON competitions (official_notice_id);

CREATE TABLE IF NOT EXISTS source_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    document_count INTEGER NOT NULL DEFAULT 0,
    upserted_count INTEGER NOT NULL DEFAULT 0,
    parse_failure_count INTEGER NOT NULL DEFAULT 0,
    duplicate_group_count INTEGER NOT NULL DEFAULT 0,
    max_duplicate_group_size INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source_id ON source_runs (source_id);
CREATE INDEX IF NOT EXISTS idx_source_runs_completed_at ON source_runs (completed_at);

CREATE TABLE IF NOT EXISTS source_health (
    source_id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_tier TEXT NOT NULL,
    last_status TEXT NOT NULL,
    last_run_started_at TEXT,
    last_run_completed_at TEXT,
    last_success_at TEXT,
    last_document_count INTEGER NOT NULL DEFAULT 0,
    last_upserted_count INTEGER NOT NULL DEFAULT 0,
    last_parse_failure_count INTEGER NOT NULL DEFAULT 0,
    duplicate_group_count INTEGER NOT NULL DEFAULT 0,
    max_duplicate_group_size INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_health_updated_at ON source_health (updated_at);

CREATE TABLE IF NOT EXISTS ops_review_queue_items (
    queue_id TEXT PRIMARY KEY,
    origin TEXT NOT NULL DEFAULT 'worker_diagnostic',
    reason_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_note TEXT,
    source_id TEXT,
    competition_id TEXT,
    dedup_key TEXT,
    notice_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    first_detected_at TEXT NOT NULL,
    last_detected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_review_queue_active_status
    ON ops_review_queue_items (is_active, status, priority DESC, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_review_queue_reason
    ON ops_review_queue_items (reason_code, is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_ops_review_queue_competition_id
    ON ops_review_queue_items (competition_id);
CREATE INDEX IF NOT EXISTS idx_ops_review_queue_source_id
    ON ops_review_queue_items (source_id);

CREATE TABLE IF NOT EXISTS ops_review_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    actor_label TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(queue_id) REFERENCES ops_review_queue_items(queue_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_review_decisions_queue_id
    ON ops_review_decisions (queue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_key TEXT NOT NULL,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_saved_searches_workspace_updated
    ON workspace_saved_searches (workspace_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_watchlist_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_key TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(opportunity_id) REFERENCES competitions(id),
    UNIQUE(workspace_key, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_watchlist_entries_workspace_updated
    ON workspace_watchlist_entries (workspace_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_watchlist_entries_opportunity
    ON workspace_watchlist_entries (opportunity_id);

CREATE TABLE IF NOT EXISTS auth_users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires
    ON auth_sessions (user_id, expires_at);
