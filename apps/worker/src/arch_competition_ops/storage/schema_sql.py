"""Worker SQL mirror of the Web migrations."""

SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    organizer TEXT NOT NULL,
    source_id TEXT,
    source_name TEXT,
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
    project_types TEXT NOT NULL DEFAULT '[]',
    building_categories TEXT NOT NULL DEFAULT '[]',
    official_sectors TEXT NOT NULL DEFAULT '[]',
    built_asset_types TEXT NOT NULL DEFAULT '[]',
    design_scopes TEXT NOT NULL DEFAULT '[]',
    project_modes TEXT NOT NULL DEFAULT '[]',
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
    location_label TEXT,
    geo_lat REAL,
    geo_lng REAL,
    geo_source TEXT,
    geo_confidence REAL,
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
    updated_at TEXT NOT NULL,
    display_title TEXT,
    display_title_zh TEXT,
    display_title_en TEXT,
    display_title_source TEXT
);

CREATE INDEX IF NOT EXISTS idx_competitions_dedup_key ON competitions (dedup_key);
CREATE INDEX IF NOT EXISTS idx_competitions_official_url ON competitions (official_url);
CREATE INDEX IF NOT EXISTS idx_competitions_notice_id ON competitions (official_notice_id);
CREATE INDEX IF NOT EXISTS idx_competitions_status_deadline ON competitions (status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_competitions_jurisdiction ON competitions (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_competitions_discovered_at ON competitions (discovered_at);
CREATE INDEX IF NOT EXISTS idx_competitions_contract_value
    ON competitions (estimated_contract_value_eur);
CREATE INDEX IF NOT EXISTS idx_competitions_updated_at ON competitions (updated_at);
CREATE INDEX IF NOT EXISTS idx_competitions_discover_deadline ON competitions (
    COALESCE(deadline_at, '9999-12-31') ASC,
    COALESCE(qualification_score, 0) DESC,
    updated_at DESC,
    id ASC
) WHERE status NOT IN ('archived', 'discarded');

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

-- Worker-only collection state; D1 only serves published facts and decisions.
CREATE TABLE IF NOT EXISTS notice_backlog (
    source_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    payload TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued',
    first_seen TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    criteria_hash TEXT,
    expires_on TEXT,
    queued_at TEXT,
    PRIMARY KEY(source_id, content_hash)
);
CREATE INDEX IF NOT EXISTS idx_backlog_queue ON notice_backlog(status, first_seen);
CREATE INDEX IF NOT EXISTS idx_backlog_source_url ON notice_backlog(source_id, source_url);
CREATE TABLE IF NOT EXISTS backlog_retention (
    id INTEGER PRIMARY KEY CHECK (id=1),
    removed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collection_coverage_gaps (
    source_id TEXT NOT NULL,
    date_from TEXT NOT NULL,
    date_through TEXT NOT NULL,
    PRIMARY KEY(source_id, date_from, date_through)
);
CREATE TABLE IF NOT EXISTS collection_resume (
    source_id TEXT PRIMARY KEY,
    date_from TEXT NOT NULL,
    read_limit INTEGER NOT NULL,
    date_to TEXT,
    cursor TEXT NOT NULL DEFAULT ''
);

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
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_saved_searches_workspace_filters
    ON workspace_saved_searches (workspace_key, filters_json);

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

-- Web-owned tables (authentication). The worker never reads or writes them; they are created here
-- only so a database pre-built by the worker is structurally identical to one built by migrations.
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
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions (expires_at);

CREATE TABLE IF NOT EXISTS auth_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scope TEXT NOT NULL,
    ip_hash TEXT NOT NULL,
    email_hash TEXT,
    attempted_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auth_attempts_scope_ip_time
    ON auth_attempts (scope, ip_hash, attempted_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_scope_ip_email_time
    ON auth_attempts (scope, ip_hash, email_hash, attempted_at);
CREATE INDEX IF NOT EXISTS idx_auth_attempts_time
    ON auth_attempts (attempted_at);

CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    prefix TEXT NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_used_at TEXT,
    revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys (user_id, revoked_at, created_at);

CREATE TABLE IF NOT EXISTS mcp_billing_accounts (
    user_id TEXT PRIMARY KEY REFERENCES auth_users(id) ON DELETE CASCADE,
    paid_until INTEGER NOT NULL DEFAULT 0,
    stripe_customer_id TEXT,
    billing_revision INTEGER NOT NULL DEFAULT 0,
    checkout_expires_at INTEGER,
    checkout_locale TEXT,
    checkout_interval TEXT CHECK (checkout_interval IN ('month', 'year')),
    checkout_attempt_id TEXT,
    checkout_session_id TEXT
);

CREATE TABLE IF NOT EXISTS mcp_usage (
    subject TEXT PRIMARY KEY,
    user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
    month_start INTEGER NOT NULL,
    month_count INTEGER NOT NULL,
    minute_start INTEGER NOT NULL,
    minute_count INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_mcp_billing_customer
    ON mcp_billing_accounts (stripe_customer_id);

CREATE TABLE IF NOT EXISTS mcp_stripe_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    billing_revision INTEGER NOT NULL,
    processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_stripe_events_user ON mcp_stripe_events (user_id);

CREATE TABLE IF NOT EXISTS discover_publication (
    id INTEGER PRIMARY KEY CONSTRAINT sync_owns_publication CHECK (id = 1),
    sync_id TEXT NOT NULL,
    syncing INTEGER NOT NULL CHECK (syncing IN (0, 1)),
    version TEXT,
    summary_format INTEGER,
    summary_day TEXT,
    next_summary_day TEXT,
    payload_today TEXT,
    payload_tomorrow TEXT
);
"""
