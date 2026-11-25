"""Private discovery queue, independent of the moving publication window."""

import hashlib
import json
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.lifecycle import closed_lifecycle_reason
from arch_competition_ops.screening.source_evidence import (
    exclusion_identity,
    notice_evidence,
    notice_text,
)
from arch_competition_ops.screening.structured import competing_dates
from arch_competition_ops.storage.connection import connect, write_transaction
from arch_competition_ops.storage.screening import exclude_published_by_lifecycle

URGENT_DEADLINE_DAYS = 14
UNKNOWN_DEADLINE_SHARE = 0.2


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


def retire_closed(cx, source_id, *, source=None, criteria=None) -> int:
    """Retire queued notices whose official structured lifecycle state is already awarded/closed."""
    rows = cx.execute(
        "SELECT rowid, source_url, payload FROM items WHERE source_id=? AND status='queued'",
        (source_id,),
    ).fetchall()
    now_iso = clock.now_utc().isoformat()
    updates: list[tuple[str, str, str | None, int]] = []
    for row_id, source_url, payload in rows:
        closed = closed_lifecycle_reason(payload)
        if closed is None:
            continue
        code, quote = closed
        if source is not None:
            exclude_published_by_lifecycle(
                cx,
                exclusion_identity(source, payload, source_url),
                code=code,
                quote=quote,
            )
        updates.append((f"closed_lifecycle/{code}", now_iso, criteria, row_id))
    if updates:
        cx.executemany(
            "UPDATE items SET status='closed_lifecycle', last_error=?, retry_at=NULL, "
            "terminal_at=?, criteria_hash=? WHERE rowid=? AND status='queued'",
            updates,
        )
    return len(updates)


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
    source=None,
):
    now = clock.now_utc()
    versions = set()
    lengths = []
    new = already = revisited = 0
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
                revisited += 1
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
                    "SELECT status IN ('done','closed_lifecycle') FROM items "
                    "WHERE source_id=? AND content_hash=?",
                    (source_id, version),
                ).fetchone()[0]
            lengths.append(len(notice_evidence(document.payload)))
        closed = retire_closed(cx, source_id, source=source, criteria=criteria)
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
        count, stats = queue_stats(
            cx,
            source_id,
            new=new,
            revisited=revisited,
            closed_now=closed,
            lengths=lengths,
            unfinished=unfinished,
        )
    if repeated:
        stats += " paging_reset=repeated_page"
    return already, count, stats, expired


def queue_stats(cx, source_id, *, new=0, revisited=0, closed_now=0, lengths=(), unfinished=1):
    count, oldest = cx.execute(
        "SELECT count(*),min(coalesce(queued_at,first_seen)) FROM items "
        "WHERE source_id=? AND status='queued'",
        (source_id,),
    ).fetchone()
    age = (clock.now_utc() - datetime.fromisoformat(oldest)).days if oldest else 0
    stats = (
        f"new={new} revisited={revisited} "
        f"text_chars_min/max={min(lengths, default=0)}/{max(lengths, default=0)} "
        f"unfinished_pages_at_least={int(unfinished)} queued={count} oldest_days={age}"
    )
    if closed_now:
        stats += f" retired_closed={closed_now}"
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
        "('expired_unread','aged_out','closed_lifecycle') GROUP BY status",
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


def _prioritize_rows(
    rows: list[tuple[int, str | None, str]],
    *,
    limit: int,
    today: date,
    urgent_days: int = URGENT_DEADLINE_DAYS,
    unknown_share: float = UNKNOWN_DEADLINE_SHARE,
) -> list[int]:
    """Deadline-aware EDF ordering with a reserved share so undated notices cannot starve."""
    if limit <= 0 or not rows:
        return []
    today_iso = today.isoformat()
    urgent_cutoff = (today + timedelta(days=urgent_days)).isoformat()
    urgent = sorted(
        (row for row in rows if row[1] and today_iso <= row[1] <= urgent_cutoff),
        key=lambda row: (row[1], row[2], row[0]),
    )
    later = sorted(
        (row for row in rows if row[1] and row[1] > urgent_cutoff),
        key=lambda row: (row[1], row[2], row[0]),
    )
    past = sorted(
        (row for row in rows if row[1] and row[1] < today_iso),
        key=lambda row: (row[1], row[2], row[0]),
    )
    unknown = sorted(
        (row for row in rows if not row[1]),
        key=lambda row: (row[2], row[0]),
    )
    dated = [*urgent, *later, *past]
    unknown_reserve = min(len(unknown), max(1, int(limit * unknown_share)) if limit >= 5 else 0)
    dated_take = min(len(dated), limit - unknown_reserve)
    chosen = [row[0] for row in dated[:dated_take]]
    chosen.extend(row[0] for row in unknown[:unknown_reserve])
    if len(chosen) < limit:
        for row in dated[dated_take:]:
            if len(chosen) >= limit:
                break
            chosen.append(row[0])
    if len(chosen) < limit:
        for row in unknown[unknown_reserve:]:
            if len(chosen) >= limit:
                break
            chosen.append(row[0])
    return chosen


def select_batch_queue(
    db: Path,
    source_ids: list[str],
    *,
    per_source_floor: int,
    urgent_days: int = URGENT_DEADLINE_DAYS,
    unknown_share: float = UNKNOWN_DEADLINE_SHARE,
) -> list[tuple[str, list[int]]]:
    """Allocate per-source guaranteed slots first, then share unused remainder round-robin."""
    if not source_ids or per_source_floor <= 0:
        return []
    now_iso = clock.now_utc().isoformat()
    today = clock.today()
    by_source: dict[str, list[tuple[int, str | None, str]]] = {sid: [] for sid in source_ids}
    with connect(db) as cx:
        for source_id, row_id, expires_on, first_seen in cx.execute(
            "SELECT source_id, rowid, expires_on, first_seen FROM items "
            "WHERE status='queued' AND (retry_at IS NULL OR retry_at<=?) "
            "AND source_id IN (SELECT value FROM json_each(?))",
            (now_iso, json.dumps(source_ids)),
        ):
            if source_id in by_source:
                by_source[source_id].append((row_id, expires_on, first_seen))

    chosen: dict[str, list[int]] = {}
    leftover: dict[str, list[int]] = {}
    for sid in source_ids:
        rows = by_source[sid]
        floor_ids = _prioritize_rows(
            rows,
            limit=per_source_floor,
            today=today,
            urgent_days=urgent_days,
            unknown_share=unknown_share,
        )
        chosen[sid] = floor_ids
        picked = set(floor_ids)
        remaining_rows = [row for row in rows if row[0] not in picked]
        leftover[sid] = _prioritize_rows(
            remaining_rows,
            limit=len(remaining_rows),
            today=today,
            urgent_days=urgent_days,
            unknown_share=unknown_share,
        )

    total_budget = per_source_floor * len(source_ids)
    spare = max(0, total_budget - sum(len(ids) for ids in chosen.values()))
    active = [sid for sid in source_ids if leftover[sid]]
    while spare > 0 and active:
        next_active: list[str] = []
        for sid in active:
            if spare <= 0:
                break
            chosen[sid].append(leftover[sid].pop(0))
            spare -= 1
            if leftover[sid]:
                next_active.append(sid)
        active = next_active

    return [(sid, chosen[sid]) for sid in sorted(source_ids) if chosen[sid]]


def queued(db: Path, source_id: str, limit: int, row_ids: list[int] | None = None):
    now_iso = clock.now_utc().isoformat()
    with connect(db) as cx:
        if row_ids is not None:
            if not row_ids or limit <= 0:
                return []
            target_ids = row_ids[:limit]
            rows_by_id = {
                row[0]: QueuedNotice(row[0], CollectedSourceDocument(*row[1:]))
                for row in cx.execute(
                    "SELECT rowid,source_url,CASE WHEN empty_reads>0 THEN "
                    "json_object('pendingDetailUrl',coalesce(json_extract("
                    "CASE WHEN json_valid(payload) "
                    "THEN payload END,'$.pendingDetailUrl'),source_url)) ELSE payload END "
                    "FROM items "
                    "WHERE source_id=? AND status='queued' "
                    "AND (retry_at IS NULL OR retry_at<=?) "
                    "AND rowid IN (SELECT value FROM json_each(?))",
                    (source_id, now_iso, json.dumps(target_ids)),
                )
            }
            return [rows_by_id[row_id] for row_id in target_ids if row_id in rows_by_id]

        candidates = cx.execute(
            "SELECT rowid, expires_on, first_seen FROM items "
            "WHERE source_id=? AND status='queued' "
            "AND (retry_at IS NULL OR retry_at<=?)",
            (source_id, now_iso),
        ).fetchall()
        selected_ids = _prioritize_rows(
            [(row[0], row[1], row[2]) for row in candidates],
            limit=limit,
            today=clock.today(),
        )
        if not selected_ids:
            return []
        rows_by_id = {
            row[0]: QueuedNotice(row[0], CollectedSourceDocument(*row[1:]))
            for row in cx.execute(
                "SELECT rowid,source_url,CASE WHEN empty_reads>0 THEN "
                "json_object('pendingDetailUrl',coalesce(json_extract("
                "CASE WHEN json_valid(payload) "
                "THEN payload END,'$.pendingDetailUrl'),source_url)) ELSE payload END "
                "FROM items "
                "WHERE source_id=? AND rowid IN (SELECT value FROM json_each(?))",
                (source_id, json.dumps(selected_ids)),
            )
        }
        return [rows_by_id[row_id] for row_id in selected_ids if row_id in rows_by_id]


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
