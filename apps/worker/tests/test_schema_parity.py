"""The worker's SCHEMA_SQL must describe the same database as apps/web/migrations/*.sql.

The migrations are the authority for structure; this test fails whenever either side drifts,
instead of waiting for a column to be missing at runtime.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

from arch_competition_ops.storage.schema import SCHEMA_SQL

MIGRATIONS_DIR = Path(__file__).resolve().parents[2] / "web" / "migrations"

# No exceptions: every table and index the Web migrations create must also be in SCHEMA_SQL.
WEB_ONLY_TABLES: set[str] = set()
WEB_ONLY_INDEXES: set[str] = set()


def _worker_database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    connection.executescript(SCHEMA_SQL)
    return connection


def _migrated_database() -> sqlite3.Connection:
    connection = sqlite3.connect(":memory:")
    migrations = sorted(MIGRATIONS_DIR.glob("*.sql"))
    assert migrations, f"no migrations found in {MIGRATIONS_DIR}"
    for migration in migrations:
        connection.executescript(migration.read_text(encoding="utf-8"))
    return connection


def _tables(connection: sqlite3.Connection) -> set[str]:
    return {
        row[0]
        for row in connection.execute(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
        )
    }


def _columns(connection: sqlite3.Connection, table: str) -> dict[str, tuple]:
    """name -> (declared type, NOT NULL, default, primary-key position); order is irrelevant."""
    return {
        row[1]: (row[2].upper(), bool(row[3]), row[4], row[5])
        for row in connection.execute(f"PRAGMA table_info({table})")
    }


def _indexes(connection: sqlite3.Connection, table: str) -> dict[str, tuple]:
    """Index name -> (unique, ((column, descending), ...)).

    Implicit indexes (PRIMARY KEY / UNIQUE constraints) carry generated names, so they are keyed
    by their definition instead.
    """
    result: dict[str, tuple] = {}
    for row in connection.execute(f"PRAGMA index_list({table})"):
        name, unique, origin = row[1], bool(row[2]), row[3]
        columns = tuple(
            (info[2], bool(info[3]))
            for info in connection.execute(f"PRAGMA index_xinfo({name})")
            if info[5]  # key columns only (skip the trailing rowid)
        )
        key = name if origin == "c" else f"<{origin}:{columns}>"
        result[key] = (unique, columns)
    return result


def _foreign_keys(connection: sqlite3.Connection, table: str) -> set[tuple]:
    return {
        (row[3], row[2], row[4])  # from column, referenced table, referenced column
        for row in connection.execute(f"PRAGMA foreign_key_list({table})")
    }


def test_the_worker_and_the_web_app_have_the_same_tables() -> None:
    worker, web = _tables(_worker_database()), _tables(_migrated_database())

    assert web - worker == WEB_ONLY_TABLES
    assert worker - web == set()


def test_every_shared_table_has_identical_columns() -> None:
    worker, web = _worker_database(), _migrated_database()

    for table in sorted(_tables(worker)):
        assert _columns(worker, table) == _columns(web, table), f"column mismatch in {table}"


def test_every_shared_table_has_identical_indexes_and_foreign_keys() -> None:
    worker, web = _worker_database(), _migrated_database()

    for table in sorted(_tables(worker)):
        worker_indexes = _indexes(worker, table)
        web_indexes = {
            name: definition
            for name, definition in _indexes(web, table).items()
            if name not in WEB_ONLY_INDEXES
        }
        assert worker_indexes == web_indexes, f"index mismatch in {table}"
        assert _foreign_keys(worker, table) == _foreign_keys(web, table), f"FK mismatch in {table}"


def test_competition_source_identity_columns_exist_on_both_sides() -> None:
    for connection in (_worker_database(), _migrated_database()):
        columns = _columns(connection, "competitions")
        assert columns["source_id"][0] == "TEXT" and not columns["source_id"][1]
        assert columns["source_name"][0] == "TEXT" and not columns["source_name"][1]
        assert columns["organizer"][1]  # organizer stays NOT NULL ('' when unknown)
