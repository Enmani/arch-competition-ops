ALTER TABLE mcp_billing_accounts ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE mcp_billing_accounts ADD COLUMN billing_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE mcp_billing_accounts ADD COLUMN checkout_expires_at INTEGER;
ALTER TABLE mcp_billing_accounts ADD COLUMN checkout_locale TEXT;
ALTER TABLE mcp_billing_accounts ADD COLUMN checkout_interval TEXT CHECK (checkout_interval IN ('month', 'year'));
ALTER TABLE mcp_billing_accounts ADD COLUMN checkout_attempt_id TEXT;
ALTER TABLE mcp_billing_accounts ADD COLUMN checkout_session_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_mcp_billing_customer
    ON mcp_billing_accounts (stripe_customer_id);

CREATE TABLE IF NOT EXISTS mcp_stripe_events (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
    billing_revision INTEGER NOT NULL,
    processed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mcp_stripe_events_user ON mcp_stripe_events (user_id);
