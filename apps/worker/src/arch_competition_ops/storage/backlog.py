"""Private discovery queue, independent of the moving publication window."""

import json
from datetime import datetime
from pathlib import Path

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.source_evidence import notice_evidence
from arch_competition_ops.storage.connection import connect, write_transaction


def collection_window(db, source_id, date_from, cap):
    with write_transaction(db) as cx:
        cx.execute(
            "INSERT INTO collection_resume "
            "VALUES(?,?,?) "
            "ON CONFLICT(source_id) DO UPDATE "
            "SET date_from=min(date_from,excluded.date_from)",
            (source_id, date_from, cap),
        )
        return tuple(
            cx.execute(
                "SELECT date_from,read_limit FROM collection_resume WHERE source_id=?", (source_id,)
            ).fetchone()
        )


def enqueue(db, source_id, documents, criteria, *, unfinished, cap):
    now = clock.now_utc()
    lengths = []
    new = already = 0
    with write_transaction(db) as cx:
        if criteria is not None:
            cx.execute(
                "UPDATE notice_backlog SET attempts=0,status='queued',last_error=NULL,criteria_hash=? "
                "WHERE source_id=? AND status IN ('failed','queued') AND attempts>0 AND criteria_hash IS NOT ?",
                (criteria, source_id, criteria),
            )
        for document in documents:
            version = notice_content_hash(document.payload, document.source_url)
            inserted = cx.execute(
                "INSERT OR IGNORE INTO notice_backlog "
                "(source_id,source_url,payload,content_hash,first_seen) "
                "VALUES(?,?,?,?,?)",
                (source_id, document.source_url, document.payload, version, now.isoformat()),
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
        if unfinished:
            cx.execute(
                "UPDATE collection_resume SET read_limit=read_limit+? WHERE source_id=?",
                (cap, source_id),
            )
        else:
            cx.execute("DELETE FROM collection_resume WHERE source_id=?", (source_id,))
        count, stats = queue_stats(cx, source_id, new=new, lengths=lengths, unfinished=unfinished)
    return already, count, stats


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
