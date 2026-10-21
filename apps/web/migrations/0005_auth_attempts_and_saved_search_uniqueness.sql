-- 0005: authentication throttling, session cleanup index, saved-search uniqueness.
-- Ownership: these tables/indexes belong to the Web app. The Python worker never writes them,
-- and scripts/export-d1-data.mjs never syncs them.

-- 1. Sliding-window throttling for login/register. Only hashes are stored (never raw IPs/emails).
--    scope: 'login' | 'register'. Rows are pruned by the application once they leave the window.
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

-- 2. Expired-session cleanup and "sign out everywhere" lookups.
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expires_at
    ON auth_sessions (expires_at);

-- 3. Session token hashes change encoding (base64url -> lowercase hex SHA-256), so every
--    pre-existing row can no longer be matched. Remove them explicitly; users sign in again once.
DELETE FROM auth_sessions;

-- 4. Recency index for the "latest" discover sort.
CREATE INDEX IF NOT EXISTS idx_competitions_updated_at ON competitions (updated_at);

-- 5. Saved searches are unique per (workspace_key, canonical filters JSON).
--    SQLite cannot compute SHA-256 to backfill a hash column, so uniqueness is enforced on the
--    canonical filters text itself (the application always writes it in a fixed key order).
--    Safe de-duplication first: keep the most recently updated row of every duplicate group
--    (ties broken by the highest id); rows of other groups are untouched. Names of removed
--    duplicates are discarded - the surviving row keeps its own name.
DELETE FROM workspace_saved_searches
WHERE id IN (
    SELECT id
    FROM (
        SELECT
            id,
            ROW_NUMBER() OVER (
                PARTITION BY workspace_key, filters_json
                ORDER BY updated_at DESC, id DESC
            ) AS duplicate_rank
        FROM workspace_saved_searches
    )
    WHERE duplicate_rank > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_saved_searches_workspace_filters
    ON workspace_saved_searches (workspace_key, filters_json);
