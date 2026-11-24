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
    row_ids: Iterable[int],
) -> None:
    """Record the version selected from the queue, even if the hash algorithm changed."""
    rows = list(row_ids)
    if not rows:
        return
    now = clock.now_utc()
    with write_transaction(db_path) as connection:
        connection.executemany(
            "INSERT INTO ai_notice_ledger "
            "(source_id, content_hash, criteria_hash, outcome, source_url, recorded_at) "
            "SELECT source_id,content_hash,?,?,source_url,? FROM notice_backlog "
            "WHERE rowid=? AND source_id=? AND status='queued' "
            "ON CONFLICT (source_id, content_hash, criteria_hash) DO UPDATE SET "
            "outcome = excluded.outcome, source_url = excluded.source_url, "
            "recorded_at = excluded.recorded_at",
            [(criteria_hash, outcome, now.isoformat(), row_id, source_id) for row_id in rows],
        )
        connection.executemany(
            "UPDATE notice_backlog SET status='done',attempts=attempts+1,last_error=NULL,"
            "retry_at=NULL,transient_count=0,terminal_at=?,criteria_hash=? "
            "WHERE source_id=? AND rowid=? AND status='queued'",
            [(now.isoformat(), criteria_hash, source_id, row_id) for row_id in rows],
        )
        connection.execute(
            "DELETE FROM ai_notice_ledger WHERE recorded_at < ?",
            ((now - timedelta(days=_RETENTION_DAYS)).isoformat(),),
        )
