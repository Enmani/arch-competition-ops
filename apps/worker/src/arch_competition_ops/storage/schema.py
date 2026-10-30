"""Worker-side DDL.

``apps/web/migrations/*.sql`` is the authority for the database structure; ``SCHEMA_SQL`` is the
worker's copy so a fresh database can be created without running the Web migrations. They must
describe the same tables, columns, and indexes (``test_schema_parity.py`` enforces it), including
the Web-owned ``auth_*`` tables, so a database pre-built by the worker matches one built by
migrations.
The Web app's migration runner tracks applied migrations in ``schema_migrations`` and applies
whatever is missing, so a worker-built database is a supported starting point.

Existing databases are upgraded in place: any column present in ``SCHEMA_SQL`` but missing from
the live ``competitions`` table is added with ``ALTER TABLE ... ADD COLUMN``, using the definition
read back from ``SCHEMA_SQL`` itself, so there is no second column list to keep in sync. Only
columns SQLite can add (nullable, or NOT NULL with a default) are upgradable; anything else is
reported as unsupported drift.
"""

from __future__ import annotations

import logging
import sqlite3
import threading
from functools import lru_cache
from pathlib import Path

from arch_competition_ops.storage.connection import connect

logger = logging.getLogger(__name__)

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
    updated_at TEXT NOT NULL
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
"""


def _statements() -> list[str]:
    # SCHEMA_SQL contains no string literals with semicolons, so a plain split is safe. Running
    # statements one by one (instead of executescript) lets them share one explicit transaction.
    code = "\n".join(line for line in SCHEMA_SQL.splitlines() if not line.lstrip().startswith("--"))
    return [statement.strip() for statement in code.split(";") if statement.strip()]


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    return (
        connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
        ).fetchone()
        is not None
    )


@lru_cache(maxsize=1)
def _expected_competition_columns() -> dict[str, tuple[str, bool, str | None, bool]]:
    """column -> (declared type, not null, default expression, is primary key) from SCHEMA_SQL."""
    reference = sqlite3.connect(":memory:")
    try:
        for statement in _statements():
            reference.execute(statement)
        return {
            row[1]: (row[2], bool(row[3]), row[4], bool(row[5]))
            for row in reference.execute("PRAGMA table_info(competitions)")
        }
    finally:
        reference.close()


def competition_columns() -> tuple[str, ...]:
    """Column names of ``competitions`` in ``SCHEMA_SQL`` order."""
    return tuple(_expected_competition_columns())


def _has_unique_index(
    connection: sqlite3.Connection, table_name: str, expected_columns: list[str]
) -> bool:
    for index_row in connection.execute(f"PRAGMA index_list({_quote_identifier(table_name)})"):
        if index_row["unique"] != 1:
            continue
        index_columns = [
            row["name"]
            for row in connection.execute(
                f"PRAGMA index_info({_quote_identifier(index_row['name'])})"
            )
        ]
        if index_columns == expected_columns:
            return True
    return False


def _ensure_workspace_watchlist_entry_uniqueness(connection: sqlite3.Connection) -> None:
    """Legacy watchlist tables lacked UNIQUE(workspace_key, opportunity_id); dedupe then add it."""
    if not _table_exists(connection, "workspace_watchlist_entries"):
        return
    if _has_unique_index(
        connection, "workspace_watchlist_entries", ["workspace_key", "opportunity_id"]
    ):
        return

    connection.execute(
        """
        DELETE FROM workspace_watchlist_entries
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY workspace_key, opportunity_id
                        ORDER BY updated_at DESC, created_at DESC, id DESC
                    ) AS row_number
                FROM workspace_watchlist_entries
            )
            WHERE row_number > 1
        )
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_watchlist_entries_workspace_opportunity
            ON workspace_watchlist_entries (workspace_key, opportunity_id)
        """
    )


def _add_missing_competition_columns(connection: sqlite3.Connection) -> None:
    existing = {row["name"] for row in connection.execute("PRAGMA table_info(competitions)")}
    expected = _expected_competition_columns()
    missing = [name for name in expected if name not in existing]

    unsupported = [
        name
        for name in missing
        if expected[name][3] or (expected[name][1] and expected[name][2] is None)
    ]
    if unsupported:
        raise RuntimeError(
            "Unsupported competitions schema drift. Missing non-additive columns: "
            + ", ".join(sorted(unsupported))
        )

    for name in missing:
        declared_type, not_null, default, _is_pk = expected[name]
        definition = declared_type
        if not_null:
            definition += " NOT NULL"
        if default is not None:
            definition += f" DEFAULT {default}"
        connection.execute(
            f"ALTER TABLE competitions ADD COLUMN {_quote_identifier(name)} {definition}"
        )


def _execute_schema_statement(connection: sqlite3.Connection, statement: str) -> None:
    try:
        connection.execute(statement)
    except sqlite3.IntegrityError as exc:
        if not statement.startswith("CREATE UNIQUE INDEX"):
            raise
        # A unique index over user-owned rows (saved searches) cannot be built while duplicates
        # exist. De-duplicating user data is the Web migration's job (0005), not the worker's, so
        # the worker leaves the index to that migration and carries on.
        logger.warning("Skipped unique index (%s): %s", statement.split()[5], exc)


def _apply_schema(db_path: Path) -> None:
    with connect(db_path) as connection:
        # IMMEDIATE so two processes starting together cannot both try to ALTER the same column.
        connection.execute("BEGIN IMMEDIATE")
        try:
            if _table_exists(connection, "competitions"):
                _add_missing_competition_columns(connection)
            for statement in _statements():
                _execute_schema_statement(connection, statement)
            _ensure_workspace_watchlist_entry_uniqueness(connection)
        except BaseException:
            connection.execute("ROLLBACK")
            raise
        connection.execute("COMMIT")


_schema_ready: set[Path] = set()
_schema_lock = threading.Lock()


def ensure_schema(db_path: Path) -> None:
    """Create or upgrade the schema once per process and database path.

    Repository functions call this on entry; after the first call it is a set lookup plus a
    ``stat``. The ``exists()`` check re-runs the setup if the file was deleted or replaced under
    a long-lived process.
    """
    key = db_path.resolve()
    with _schema_lock:
        if key in _schema_ready and key.exists():
            return
        _apply_schema(db_path)
        _schema_ready.add(key)


def reset_schema_cache() -> None:
    """Forget which databases were already set up (tests that rebuild a database in place)."""
    with _schema_lock:
        _schema_ready.clear()
