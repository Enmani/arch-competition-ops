-- Source identity: organizer stays the real buyer (or empty when unknown); the publishing
-- platform is stored separately so records no longer masquerade platform names as buyers.
ALTER TABLE competitions ADD COLUMN source_id TEXT;
ALTER TABLE competitions ADD COLUMN source_name TEXT;

-- Discover feed filters and sorts: status+deadline, country, capture time, contract value.
CREATE INDEX IF NOT EXISTS idx_competitions_status_deadline ON competitions (status, deadline_at);
CREATE INDEX IF NOT EXISTS idx_competitions_jurisdiction ON competitions (jurisdiction);
CREATE INDEX IF NOT EXISTS idx_competitions_discovered_at ON competitions (discovered_at);
CREATE INDEX IF NOT EXISTS idx_competitions_contract_value ON competitions (estimated_contract_value_eur);
