"""Persistence for derived display titles. They are metadata about ``title``, not new facts."""

from __future__ import annotations

import sqlite3
from collections.abc import Collection, Mapping
from pathlib import Path
from typing import Any

from arch_competition_ops.storage.connection import connect, write_transaction
from arch_competition_ops.storage.schema import ensure_schema


def list_title_candidates(
    db_path: Path, *, competition_ids: Collection[str] | None = None
) -> list[sqlite3.Row]:
    """Rows with their stored display state, upcoming deadlines first."""
    ensure_schema(db_path)
    where, parameters = "", []
    if competition_ids is not None:
        if not competition_ids:
            return []
        where = f"WHERE id IN ({', '.join('?' for _ in competition_ids)})"
        parameters.extend(competition_ids)
    sql = (
        "SELECT id, title, jurisdiction, display_title, display_title_zh, display_title_en, "
        f"display_title_source FROM competitions {where} "
        "ORDER BY COALESCE(deadline_at, '9999-12-31'), id"
    )
    with connect(db_path) as connection:
        return connection.execute(sql, parameters).fetchall()


def write_display_titles(db_path: Path, updates: Collection[Mapping[str, Any]]) -> int:
    """Store derived titles; returns how many rows changed.

    Each update carries the ``title`` it was derived from. A row whose title changed in the
    meantime (a concurrent ingest) is skipped, so a stale derivation never overwrites a newer one.
    ``updated_at`` is left alone: this is not a newer notice, and it must not make screening stale.
    """
    if not updates:
        return 0
    ensure_schema(db_path)
    changed = 0
    with write_transaction(db_path) as connection:
        for update in updates:
            cursor = connection.execute(
                """
                UPDATE competitions
                SET display_title = :display_title,
                    display_title_zh = :display_title_zh,
                    display_title_en = :display_title_en,
                    display_title_source = :display_title_source
                WHERE id = :id AND title = :title
                """,
                {"display_title_zh": None, "display_title_en": None, **update},
            )
            changed += cursor.rowcount
    return changed
