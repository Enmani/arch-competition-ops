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
from arch_competition_ops.storage.schema_sql import SCHEMA_SQL

logger = logging.getLogger(__name__)


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
            for table, column, definition in (
                ("collection_resume", "date_to", "TEXT"),
                ("collection_resume", "cursor", "TEXT NOT NULL DEFAULT ''"),
                ("notice_backlog", "expires_on", "TEXT"),
            ):
                if column not in {
                    row[1] for row in connection.execute(f"PRAGMA table_info({table})")
                }:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")
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
