"""SQLite connection policy shared by every repository function.

The database file is shared with the Next.js app and with overlapping worker batches, so every
connection applies the same settings:

* ``journal_mode=WAL`` so Node readers are not blocked by a Python writer (and vice versa);
* ``busy_timeout`` so a short lock wait does not surface as ``SQLITE_BUSY``;
* ``foreign_keys=ON`` so the watchlist foreign key to ``competitions`` is actually enforced.

``connect`` always closes the connection (a bare ``with sqlite3.connect()`` only ends the
transaction). Connections run in autocommit mode (``isolation_level=None``) and writers open an
explicit ``BEGIN IMMEDIATE`` through ``write_transaction``, which takes the write lock up front so
read-modify-write sequences cannot interleave with another writer.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

BUSY_TIMEOUT_MS = 15_000


def _configure(connection: sqlite3.Connection) -> None:
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout = {BUSY_TIMEOUT_MS}")
    connection.execute("PRAGMA foreign_keys = ON")
    # Switching modes can fail on filesystems without shared-memory support; the DB then simply
    # stays in its current mode, so the returned mode is intentionally not asserted.
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA synchronous = NORMAL")


@contextmanager
def connect(db_path: Path) -> Iterator[sqlite3.Connection]:
    """Open a configured connection and close it on exit (no implicit transaction)."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path, timeout=BUSY_TIMEOUT_MS / 1000, isolation_level=None)
    try:
        _configure(connection)
        yield connection
    finally:
        connection.close()


@contextmanager
def write_transaction(db_path: Path) -> Iterator[sqlite3.Connection]:
    """One atomic unit of work: ``BEGIN IMMEDIATE`` ... ``COMMIT``, ``ROLLBACK`` on any error."""
    with connect(db_path) as connection:
        connection.execute("BEGIN IMMEDIATE")
        try:
            yield connection
        except BaseException:
            connection.execute("ROLLBACK")
            raise
        else:
            connection.execute("COMMIT")
