"""Operator review queue persistence."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.storage.connection import write_transaction
from arch_competition_ops.storage.schema import ensure_schema

OPS_REVIEW_STATUSES = {"pending", "accepted", "rejected", "needs_follow_up"}


def sync_review_queue_items(
    db_path: Path,
    *,
    items: list[dict[str, Any]],
) -> int:
    """Upsert worker-generated queue items and deactivate worker items no longer detected.

    A decision (``accepted``/``rejected``) is only reopened as ``pending`` when the item's
    ``payload_json`` changed. The payload is serialized with sorted keys, so string equality is
    the same test as comparing a hash of it. Operators therefore keep their decision across the
    refresh that runs after every ingest and verify, until the underlying facts actually change.
    """
    ensure_schema(db_path)
    now = clock.now_utc().isoformat()
    active_worker_queue_ids: list[str] = []

    with write_transaction(db_path) as connection:
        for raw_item in items:
            queue_id = str(raw_item["queue_id"])
            origin = str(raw_item.get("origin") or "worker_diagnostic")
            payload = {
                "queue_id": queue_id,
                "origin": origin,
                "reason_code": str(raw_item["reason_code"]),
                "status": str(raw_item.get("status") or "pending"),
                "priority": int(raw_item.get("priority") or 0),
                "title": str(raw_item["title"]),
                "summary": str(raw_item["summary"]),
                "evidence_note": raw_item.get("evidence_note"),
                "source_id": raw_item.get("source_id"),
                "competition_id": raw_item.get("competition_id"),
                "dedup_key": raw_item.get("dedup_key"),
                "notice_id": raw_item.get("notice_id"),
                "payload_json": json.dumps(raw_item.get("payload") or {}, sort_keys=True),
                "first_detected_at": str(raw_item.get("first_detected_at") or now),
                "last_detected_at": str(raw_item.get("last_detected_at") or now),
                "updated_at": str(raw_item.get("updated_at") or now),
            }

            if payload["status"] not in OPS_REVIEW_STATUSES:
                raise ValueError(f"Unsupported review queue status: {payload['status']}")

            connection.execute(
                """
                INSERT INTO ops_review_queue_items (
                    queue_id, origin, reason_code, status, priority, title, summary,
                    evidence_note, source_id, competition_id, dedup_key, notice_id,
                    payload_json, is_active, first_detected_at, last_detected_at, updated_at
                ) VALUES (
                    :queue_id, :origin, :reason_code, :status, :priority, :title, :summary,
                    :evidence_note, :source_id, :competition_id, :dedup_key, :notice_id,
                    :payload_json, 1, :first_detected_at, :last_detected_at, :updated_at
                )
                ON CONFLICT(queue_id) DO UPDATE SET
                    origin = excluded.origin,
                    reason_code = excluded.reason_code,
                    status = CASE
                        WHEN ops_review_queue_items.status IN ('accepted', 'rejected')
                            AND ops_review_queue_items.payload_json != excluded.payload_json
                            THEN excluded.status
                        ELSE ops_review_queue_items.status
                    END,
                    priority = excluded.priority,
                    title = excluded.title,
                    summary = excluded.summary,
                    evidence_note = excluded.evidence_note,
                    source_id = excluded.source_id,
                    competition_id = excluded.competition_id,
                    dedup_key = excluded.dedup_key,
                    notice_id = excluded.notice_id,
                    payload_json = excluded.payload_json,
                    is_active = 1,
                    last_detected_at = excluded.last_detected_at,
                    updated_at = excluded.updated_at
                """,
                payload,
            )

            if origin == "worker_diagnostic":
                active_worker_queue_ids.append(queue_id)

        if active_worker_queue_ids:
            placeholders = ", ".join("?" for _ in active_worker_queue_ids)
            connection.execute(
                f"""
                UPDATE ops_review_queue_items
                SET is_active = 0, updated_at = ?
                WHERE origin = 'worker_diagnostic' AND queue_id NOT IN ({placeholders})
                """,
                (now, *active_worker_queue_ids),
            )
        else:
            connection.execute(
                """
                UPDATE ops_review_queue_items
                SET is_active = 0, updated_at = ?
                WHERE origin = 'worker_diagnostic'
                """,
                (now,),
            )

    return len(items)


def record_review_queue_decision(
    db_path: Path,
    *,
    queue_id: str,
    decision: str,
    actor_label: str | None = None,
    note: str | None = None,
) -> None:
    ensure_schema(db_path)
    normalized_decision = decision.strip()
    if normalized_decision not in OPS_REVIEW_STATUSES:
        raise ValueError(f"Unsupported review decision: {normalized_decision}")

    created_at = clock.now_utc().isoformat()

    with write_transaction(db_path) as connection:
        row = connection.execute(
            "SELECT queue_id FROM ops_review_queue_items WHERE queue_id = ?",
            (queue_id,),
        ).fetchone()
        if row is None:
            raise LookupError(f"Unknown review queue item: {queue_id}")

        connection.execute(
            """
            INSERT INTO ops_review_decisions (queue_id, decision, actor_label, note, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (queue_id, normalized_decision, actor_label, note, created_at),
        )
        connection.execute(
            """
            UPDATE ops_review_queue_items
            SET status = ?, updated_at = ?
            WHERE queue_id = ?
            """,
            (normalized_decision, created_at, queue_id),
        )
