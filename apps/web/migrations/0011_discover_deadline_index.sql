-- Matches the discover deadline sort and its UTC date lower bound.
CREATE INDEX IF NOT EXISTS idx_competitions_discover_deadline ON competitions (
    COALESCE(deadline_at, '9999-12-31') ASC,
    COALESCE(qualification_score, 0) DESC,
    updated_at DESC,
    id ASC
) WHERE status NOT IN ('archived', 'discarded');
