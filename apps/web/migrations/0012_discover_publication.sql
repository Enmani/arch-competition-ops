-- A singleton contains the current publication and the two UTC days it covers.
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
