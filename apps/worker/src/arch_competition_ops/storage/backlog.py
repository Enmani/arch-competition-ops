"""Private discovery queue, independent of the moving publication window."""

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.source_evidence import notice_evidence, notice_text
from arch_competition_ops.screening.structured import competing_dates
from arch_competition_ops.storage.connection import connect, write_transaction


def _refresh_criteria(cx, source_id, criteria):
    if criteria is not None:
        cx.execute(
            "UPDATE items SET "
            "attempts=0,status='queued',last_error=NULL,retry_at=NULL,transient_count=0,"
            "terminal_at=NULL,queued_at=?,criteria_hash=? "
            "WHERE source_id=? AND status IN ('failed','queued') AND (attempts>0 OR "
            "transient_count>0) "
            "AND criteria_hash IS NOT ?",
            (clock.now_utc().isoformat(), criteria, source_id, criteria),
        )


def collection_window(db, source_id, date_from, cap, days, supports_end, criteria=None):
    with write_transaction(db) as cx:
        _refresh_criteria(cx, source_id, criteria)
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
        if not supports_end:
            floor = (clock.today() - timedelta(days=days - 1)).isoformat()
            if start < floor:
                through = (date.fromisoformat(floor) - timedelta(days=1)).isoformat()
                cx.execute(
                    "INSERT OR IGNORE INTO collection_coverage_gaps VALUES(?,?,?)",
                    (source_id, start, through),
                )
            start = max(start, floor)
        return start, end if supports_end else None, cursor


def reset_cursor(db, source_id, *, gap=False):
    with write_transaction(db) as cx:
        if gap:
            _mark_gap(cx, source_id)
        else:
            cx.execute(
                "UPDATE collection_resume SET cursor='',listing_hash=NULL WHERE source_id=?",
                (source_id,),
            )


def _mark_gap(cx, source_id):
    cx.execute(
        "INSERT OR IGNORE INTO collection_coverage_gaps "
        "SELECT source_id,date_from,date_to FROM collection_resume WHERE source_id=?",
        (source_id,),
    )
    cx.execute("DELETE FROM collection_resume WHERE source_id=?", (source_id,))


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
    day = max(dates, default=None)
    if day and competing_dates(notice_text(payload, collected=True), day):
        return None
    return day


def retire_unread(cx, source_id, age_days):
    expired = cx.execute(
        "UPDATE items SET status='expired_unread',terminal_at=? WHERE source_id=? "
        "AND status='queued' AND expires_on<?",
        (clock.now_utc().isoformat(), source_id, clock.today().isoformat()),
    )
    cx.execute(
        "UPDATE items SET status='aged_out',terminal_at=? WHERE source_id=? AND "
        "status='queued' "
        "AND COALESCE(queued_at,first_seen)<?",
        (
            clock.now_utc().isoformat(),
            source_id,
            (clock.now_utc() - timedelta(days=age_days)).isoformat(),
        ),
    )
    return expired.rowcount


def enqueue(
    db,
    source_id,
    documents,
    criteria,
    *,
    unfinished,
    cap,
    cursor="",
    end=None,
    age_days=30,
    repeated=False,
):
    now = clock.now_utc()
    versions = set()
    lengths = []
    new = already = 0
    with write_transaction(db) as cx:
        _refresh_criteria(cx, source_id, criteria)
        for document in documents:
            version = notice_content_hash(document.payload, document.source_url)
            versions.add(version)
            inserted = cx.execute(
                "INSERT OR IGNORE INTO items "
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
            if not inserted:
                cx.execute(
                    "UPDATE items SET payload=? WHERE source_id=? AND content_hash=? "
                    "AND status='queued' AND payload=''",
                    (document.payload, source_id, version),
                )
            if not inserted and criteria is not None:
                cx.execute(
                    "UPDATE items "
                    "SET status='queued',attempts=0,last_error=NULL,retry_at=NULL,"
                    "terminal_at=NULL,transient_count=0,empty_reads=0,payload=?,queued_at=? "
                    "WHERE source_id=? AND content_hash=? AND status='done' "
                    "AND criteria_hash IS NOT ?",
                    (document.payload, now.isoformat(), source_id, version, criteria),
                )
                already += cx.execute(
                    "SELECT status='done' FROM items WHERE source_id=? AND content_hash=?",
                    (source_id, version),
                ).fetchone()[0]
            lengths.append(len(notice_evidence(document.payload)))
        expired = retire_unread(cx, source_id, age_days)
        signature = hashlib.sha256("".join(sorted(versions)).encode()).hexdigest()
        previous = cx.execute(
            "SELECT cursor,listing_hash FROM collection_resume WHERE source_id=?", (source_id,)
        ).fetchone()
        repeated = repeated or bool(
            unfinished
            and previous
            and previous[0]
            and (previous[0] == cursor or (versions and previous[1] == signature))
        )
        if repeated:
            _mark_gap(cx, source_id)
        elif unfinished:
            cx.execute(
                "UPDATE collection_resume SET cursor=?,listing_hash=? WHERE source_id=?",
                (cursor, signature, source_id),
            )
        elif end and end < clock.today().isoformat():
            next_day = (date.fromisoformat(end) + timedelta(days=1)).isoformat()
            cx.execute(
                "UPDATE collection_resume SET date_from=?, date_to=NULL, cursor='',"
                "listing_hash=NULL "
                "WHERE source_id=?",
                (next_day, source_id),
            )
        else:
            cx.execute("DELETE FROM collection_resume WHERE source_id=?", (source_id,))
        count, stats = queue_stats(cx, source_id, new=new, lengths=lengths, unfinished=unfinished)
    if repeated:
        stats += " paging_reset=repeated_page"
    return already, count, stats, expired


def queue_stats(cx, source_id, *, new=0, lengths=(), unfinished=1):
    count, oldest = cx.execute(
        "SELECT count(*),min(coalesce(queued_at,first_seen)) FROM items "
        "WHERE source_id=? AND status='queued'",
        (source_id,),
    ).fetchone()
    age = (clock.now_utc() - datetime.fromisoformat(oldest)).days if oldest else 0
    stats = (
        f"new={new} text_chars_min/max={min(lengths, default=0)}/{max(lengths, default=0)} "
        f"unfinished_pages_at_least={int(unfinished)} queued={count} oldest_days={age}"
    )
    waiting, retry = cx.execute(
        "SELECT count(*),min(retry_at) FROM items WHERE source_id=? "
        "AND status='queued' AND last_error NOT LIKE 'no_readable_text/%' AND retry_at>?",
        (source_id, clock.now_utc().isoformat()),
    ).fetchone()
    if waiting:
        stats += f" deferred_transient={waiting} next_retry={retry}"
    gaps = cx.execute(
        "SELECT min(date_from),max(date_through),count(*) FROM collection_coverage_gaps "
        "WHERE source_id=?",
        (source_id,),
    ).fetchone()
    if gaps[2]:
        stats += f" unavailable_windows={gaps[2]} earliest_from={gaps[0]} latest_through={gaps[1]}"
    for state, total in cx.execute(
        "SELECT status,count(*) FROM items WHERE source_id=? AND status IN "
        "('expired_unread','aged_out') GROUP BY status",
        (source_id,),
    ):
        stats += f" {state}={total}"
    for state, error, total in cx.execute(
        "SELECT status,last_error,count(*) FROM items WHERE source_id=? "
        "AND last_error LIKE 'no_readable_text/%' GROUP BY status,last_error",
        (source_id,),
    ):
        stats += f" {error}[{source_id}/{state}]={total}"
    failures = cx.execute(
        "SELECT last_error,count(*) FROM items WHERE source_id=? AND status='failed' "
        "GROUP BY last_error ORDER BY last_error",
        (source_id,),
    )
    stats += "".join(f" failed[{source_id}/{error}]={total}" for error, total in failures)
    return count, stats


@dataclass(frozen=True)
class QueuedNotice:
    row_id: int
    document: CollectedSourceDocument


def queued(db: Path, source_id: str, limit: int, row_ids: list[int] | None = None):
    selected = ""
    parameters = [source_id, clock.now_utc().isoformat()]
    if row_ids is not None:
        selected = "AND rowid IN (SELECT value FROM json_each(?)) "
        parameters.append(json.dumps(row_ids))
    with connect(db) as cx:
        return [
            QueuedNotice(row[0], CollectedSourceDocument(*row[1:]))
            for row in cx.execute(
                "SELECT rowid,source_url,CASE WHEN empty_reads>0 THEN "
                "json_object('pendingDetailUrl',coalesce(json_extract("
                "CASE WHEN json_valid(payload) "
                "THEN payload END,'$.pendingDetailUrl'),source_url)) ELSE payload END "
                "FROM items "
                "WHERE source_id=? AND status='queued' "
                "AND (retry_at IS NULL OR retry_at<=?) "
                f"{selected}ORDER BY first_seen,rowid LIMIT ?",
                [*parameters, limit],
            )
        ]


def record_unreadable(db, row_id, url_class, limit):
    now = clock.now_utc()
    with write_transaction(db) as cx:
        row = cx.execute(
            "UPDATE items SET empty_reads=empty_reads+1,transient_count=0,last_error=?,"
            "status=CASE WHEN empty_reads+1>=? THEN 'no_readable_text' ELSE 'queued' END,"
            "terminal_at=CASE WHEN empty_reads+1>=? THEN ? END,"
            "retry_at=CASE WHEN empty_reads+1<? THEN ? END "
            "WHERE rowid=? AND status='queued' RETURNING status",
            (
                f"no_readable_text/{url_class}",
                limit,
                limit,
                now.isoformat(),
                limit,
                (now + timedelta(days=1)).isoformat(),
                row_id,
            ),
        ).fetchone()
        return row[0] if row else None


def record_failure(db, row_id, error, *, criteria, limit):
    with write_transaction(db) as cx:
        row = cx.execute(
            "UPDATE items SET attempts=attempts+1,last_error=?,criteria_hash=?, "
            "retry_at=NULL,transient_count=0, "
            "status=CASE WHEN attempts+1>=? THEN 'failed' ELSE 'queued' END, "
            "terminal_at=CASE WHEN attempts+1>=? THEN ? END "
            "WHERE rowid=? AND status='queued' RETURNING status",
            (error, criteria, limit, limit, clock.now_utc().isoformat(), row_id),
        ).fetchone()
        return row[0] if row else None


def defer(db, row_id, error, criteria):
    now = clock.now_utc()
    with write_transaction(db) as cx:
        row = cx.execute(
            "UPDATE items SET transient_count=min(6,transient_count+1),last_error=?,"
            "criteria_hash=? WHERE rowid=? AND status='queued' RETURNING transient_count",
            (error, criteria, row_id),
        ).fetchone()
        if row is None:
            return None
        retry = (now + timedelta(hours=min(24, 2 ** (row[0] - 1)))).isoformat()
        cx.execute("UPDATE items SET retry_at=? WHERE rowid=?", (retry, row_id))
        return retry


def terminal_notices(db, source_id):
    from arch_competition_ops.screening.notice_urls import public_url

    with connect(db) as cx:
        for row in cx.execute(
            "SELECT status,last_error,attempts,empty_reads,source_url,content_hash "
            "FROM items "
            "WHERE source_id=? AND status IN "
            "('failed','aged_out','expired_unread','no_readable_text') "
            "ORDER BY first_seen,rowid",
            (source_id,),
        ):
            yield {**dict(row), "source_url": public_url(row["source_url"])}


def requeue_failed(db, source_id, url=None, version=None):
    with write_transaction(db) as cx:
        return cx.execute(
            "UPDATE items SET empty_reads=0,attempts=0,status='queued',last_error=NULL,"
            "retry_at=NULL,transient_count=0,terminal_at=NULL,queued_at=? "
            "WHERE source_id=? AND status IN ('failed','no_readable_text') "
            "AND (? IS NULL OR source_url=?) "
            "AND (? IS NULL OR content_hash=?)",
            (clock.now_utc().isoformat(), source_id, url, url, version, version),
        ).rowcount
