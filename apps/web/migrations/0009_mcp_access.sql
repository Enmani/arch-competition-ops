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
    paid_until INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS mcp_usage (
    subject TEXT PRIMARY KEY,
    user_id TEXT REFERENCES auth_users(id) ON DELETE CASCADE,
    month_start INTEGER NOT NULL,
    month_count INTEGER NOT NULL,
    minute_start INTEGER NOT NULL,
    minute_count INTEGER NOT NULL
);
