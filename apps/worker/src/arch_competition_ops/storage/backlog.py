"""Private discovery queue, independent of the moving publication window."""

import json
from datetime import date, datetime, timedelta
from pathlib import Path

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.source_evidence import notice_evidence
from arch_competition_ops.storage.connection import connect, write_transaction


def collection_window(db, source_id, date_from, cap, days, supports_end):
    with write_transaction(db) as cx:
        cx.execute(
            "INSERT OR IGNORE INTO collection_resume(source_id,date_from,read_limit) VALUES(?,?,?)",
            (source_id, date_from, cap),
        )
        start, end, cursor = cx.execute(
            "SELECT date_from,date_to,cursor FROM collection_resume WHERE source_id=?", (source_id,)
        ).fetchone()
        end = (
            end
            or min(clock.today(), date.fromisoformat(start) + timedelta(days=days - 1)).isoformat()
        )
        cx.execute(
            "UPDATE collection_resume SET date_to=?,read_limit=? WHERE source_id=?",
            (end, cap, source_id),
        )
        return start, end if supports_end else None, cursor


def listing_deadline(payload):
    try:
        data = json.loads(payload)
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    dates = []
    for field in ("deadline", "tenderDeadline", "participationDeadline"):
        values = data.get(field)
        if values is None or values == "":
            continue
        for value in values if isinstance(values, list) else [values]:
            try:
                dates.append(date.fromisoformat(value[:10]).isoformat())
            except (ValueError, TypeError, KeyError):
                return None
    return max(dates, default=None)


def retire_unread(cx, source_id, age_days):
    expired = cx.execute(
        "UPDATE notice_backlog SET status='expired_unread' WHERE source_id=? "
        "AND status='queued' AND expires_on<?",
        (source_id, clock.today().isoformat()),
    )
    cx.execute(
        "UPDATE notice_backlog SET status='aged_out' WHERE source_id=? AND status='queued' "
        "AND first_seen<?",
        (source_id, (clock.now_utc() - timedelta(days=age_days)).isoformat()),
    )
    return expired.rowcount


def enqueue(
    db, source_id, documents, criteria, *, unfinished, cap, cursor="", end=None, age_days=30
):
    now = clock.now_utc()
    lengths = []
    new = already = 0
    with write_transaction(db) as cx:
        if criteria is not None:
            cx.execute(
                "UPDATE notice_backlog SET "
                "attempts=0,status='queued',last_error=NULL,criteria_hash=? "
                "WHERE source_id=? AND status IN ('failed','queued') AND attempts>0 "
                "AND criteria_hash IS NOT ?",
                (criteria, source_id, criteria),
            )
        for document in documents:
            version = notice_content_hash(document.payload, document.source_url)
            inserted = cx.execute(
                "INSERT OR IGNORE INTO notice_backlog "
                "(source_id,source_url,payload,content_hash,first_seen,expires_on) "
                "VALUES(?,?,?,?,?,?)",
                (
                    source_id,
                    document.source_url,
                    document.payload,
                    version,
                    now.isoformat(),
                    listing_deadline(document.payload),
                ),
            ).rowcount
            new += inserted
            if not inserted and criteria is not None:
                cx.execute(
                    "UPDATE notice_backlog "
                    "SET status='queued',last_error=NULL "
                    "WHERE source_id=? AND content_hash=? AND status='done' "
                    "AND criteria_hash IS NOT ?",
                    (source_id, version, criteria),
                )
                already += cx.execute(
                    "SELECT status='done' FROM notice_backlog WHERE source_id=? AND content_hash=?",
                    (source_id, version),
                ).fetchone()[0]
            lengths.append(len(notice_evidence(document.payload)))
        expired = retire_unread(cx, source_id, age_days)
        if unfinished:
            cx.execute(
                "UPDATE collection_resume SET cursor=? WHERE source_id=?",
                (cursor, source_id),
            )
        elif end and end < clock.today().isoformat():
            next_day = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
            cx.execute(
                "UPDATE collection_resume SET date_from=?, date_to=NULL, cursor='' "
                "WHERE source_id=?",
                (next_day, source_id),
            )
        else:
            cx.execute("DELETE FROM collection_resume WHERE source_id=?", (source_id,))
        count, stats = queue_stats(cx, source_id, new=new, lengths=lengths, unfinished=unfinished)
    return already, count, stats, expired


def queue_stats(cx, source_id, *, new=0, lengths=(), unfinished=1):
    count, oldest = cx.execute(
        "SELECT count(*),min(first_seen) FROM notice_backlog WHERE source_id=? AND status='queued'",
        (source_id,),
    ).fetchone()
    age = (clock.now_utc() - datetime.fromisoformat(oldest)).days if oldest else 0
    stats = (
        f"new={new} text_chars_min/max={min(lengths, default=0)}/{max(lengths, default=0)} "
        f"unfinished_pages_at_least={int(unfinished)} queued={count} oldest_days={age}"
    )
    for state, total in cx.execute(
        "SELECT status,count(*) FROM notice_backlog WHERE source_id=? AND status IN "
        "('expired_unread','aged_out') GROUP BY status",
        (source_id,),
    ):
        stats += f" {state}={total}"
    failures = cx.execute(
        "SELECT last_error,count(*) FROM notice_backlog WHERE source_id=? AND status='failed' "
        "GROUP BY last_error ORDER BY last_error",
        (source_id,),
    )
    stats += "".join(f" failed[{source_id}/{error}]={total}" for error, total in failures)
    return count, stats


def queued(db: Path, source_id: str, limit: int, row_ids: list[int] | None = None):
    selected = ""
    parameters = [source_id]
    if row_ids is not None:
        selected = "AND rowid IN (SELECT value FROM json_each(?)) "
        parameters.append(json.dumps(row_ids))
    with connect(db) as cx:
        return [
            CollectedSourceDocument(*row)
            for row in cx.execute(
                "SELECT source_url,payload FROM notice_backlog "
                "WHERE source_id=? AND status='queued' "
                f"{selected}ORDER BY first_seen,rowid LIMIT ?",
                [*parameters, limit],
            )
        ]


def record_failure(db, source_id, document, error, *, criteria, limit, paused=False):
    with write_transaction(db) as cx:
        status = cx.execute(
            "UPDATE notice_backlog SET attempts=attempts+?,last_error=?,criteria_hash=?, "
            "status=CASE WHEN attempts+? >= ? AND ?=0 THEN 'failed' ELSE 'queued' END "
            "WHERE source_id=? AND content_hash=? RETURNING status",
            (
                int(not paused),
                error,
                criteria,
                int(not paused),
                limit,
                int(paused),
                source_id,
                notice_content_hash(document.payload, document.source_url),
            ),
        ).fetchone()
        return status[0] if status else None


def requeue_failed(db, source_id, url=None):
    with write_transaction(db) as cx:
        return cx.execute(
            "UPDATE notice_backlog SET attempts=0,status='queued',last_error=NULL "
            "WHERE source_id=? AND status='failed' AND (? IS NULL OR source_url=?)",
            (source_id, url, url),
        ).rowcount
