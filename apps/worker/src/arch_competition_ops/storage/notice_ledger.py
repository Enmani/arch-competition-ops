"""Which listed notices have already been screened under the current criteria."""

from __future__ import annotations

from collections.abc import Iterable
from datetime import timedelta
from pathlib import Path
from typing import Literal

from arch_competition_ops import clock
from arch_competition_ops.storage.connection import write_transaction

LedgerOutcome = Literal["assessed"]

# Notices are listed for weeks, not years; older rows can only match a re-published identical
# notice, which is then simply screened again.
_RETENTION_DAYS = 400


def record_screened(
    db_path: Path,
    *,
    source_id: str,
    criteria_hash: str,
    outcome: LedgerOutcome,
    entries: Iterable[tuple[str, str]],
) -> None:
    """Record ``(content_hash, source_url)`` pairs once their outcome is durably known."""
    rows = list(entries)
    if not rows:
        return
    now = clock.now_utc()
    with write_transaction(db_path) as connection:
        connection.executemany(
            "INSERT INTO ai_notice_ledger "
            "(source_id, content_hash, criteria_hash, outcome, source_url, recorded_at) "
            "VALUES (?, ?, ?, ?, ?, ?) "
            "ON CONFLICT (source_id, content_hash, criteria_hash) DO UPDATE SET "
            "outcome = excluded.outcome, source_url = excluded.source_url, "
            "recorded_at = excluded.recorded_at",
            [
                (source_id, content_hash, criteria_hash, outcome, url, now.isoformat())
                for content_hash, url in rows
            ],
        )
        connection.executemany(
            "UPDATE notice_backlog SET status='done',attempts=attempts+1,last_error=NULL,"
            "criteria_hash=? WHERE source_id=? AND content_hash=?",
            [(criteria_hash, source_id, key) for key, _url in rows],
        )
        connection.execute(
            "DELETE FROM ai_notice_ledger WHERE recorded_at < ?",
            ((now - timedelta(days=_RETENTION_DAYS)).isoformat(),),
        )
