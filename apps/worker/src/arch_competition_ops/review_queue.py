from __future__ import annotations

import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from arch_competition_ops.storage.database import connect, ensure_schema, sync_review_queue_items


LOW_CONFIDENCE_THRESHOLD = 0.8
CONFLICT_KEYWORDS = (
    "conflict",
    "mismatch",
    "disagree",
    "official source wins",
    "official notice wins",
)


def _build_source_review_candidates(db_path: Path) -> list[dict[str, object | None]]:
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT
                source_id,
                source_name,
                last_status,
                last_run_started_at,
                last_run_completed_at,
                last_parse_failure_count,
                duplicate_group_count,
                max_duplicate_group_size,
                last_error
            FROM source_health
            ORDER BY source_name ASC
            """
        ).fetchall()

    candidates: list[dict[str, object | None]] = []
    for row in rows:
        detected_at = row["last_run_completed_at"] or row["last_run_started_at"]
        if row["last_status"] == "failed":
            candidates.append(
                {
                    "queue_id": f"source-run-failed:{row['source_id']}",
                    "origin": "worker_diagnostic",
                    "reason_code": "source_run_failed",
                    "priority": 100,
                    "title": row["source_name"],
                    "summary": "Latest ingest run failed before canonical review could complete.",
                    "source_id": row["source_id"],
                    "evidence_note": row["last_error"],
                    "payload": {
                        "lastStatus": row["last_status"],
                        "lastRunCompletedAt": row["last_run_completed_at"],
                        "lastError": row["last_error"],
                    },
                    "last_detected_at": detected_at,
                }
            )

        if row["last_parse_failure_count"] > 0:
            failure_label = "payload" if row["last_parse_failure_count"] == 1 else "payloads"
            candidates.append(
                {
                    "queue_id": f"source-parse-failures:{row['source_id']}",
                    "origin": "worker_diagnostic",
                    "reason_code": "source_parse_failures",
                    "priority": 90,
                    "title": row["source_name"],
                    "summary": (
                        f"{row['last_parse_failure_count']} {failure_label} failed parser validation in "
                        "the latest run."
                    ),
                    "source_id": row["source_id"],
                    "evidence_note": row["last_error"],
                    "payload": {
                        "lastStatus": row["last_status"],
                        "lastParseFailureCount": row["last_parse_failure_count"],
                        "duplicateGroupCount": row["duplicate_group_count"],
                        "maxDuplicateGroupSize": row["max_duplicate_group_size"],
                        "lastRunCompletedAt": row["last_run_completed_at"],
                    },
                    "last_detected_at": detected_at,
                }
            )

    return candidates


def _build_duplicate_candidates(db_path: Path) -> list[dict[str, object | None]]:
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT
                dedup_key,
                id,
                title,
                official_notice_id,
                source_url,
                updated_at
            FROM competitions
            WHERE dedup_key IN (
                SELECT dedup_key
                FROM competitions
                GROUP BY dedup_key
                HAVING COUNT(*) > 1
            )
            ORDER BY dedup_key ASC, updated_at DESC, id ASC
            """
        ).fetchall()

    grouped_rows: dict[str, list] = defaultdict(list)
    for row in rows:
        grouped_rows[row["dedup_key"]].append(row)

    candidates: list[dict[str, object | None]] = []
    for dedup_key, cluster in grouped_rows.items():
        primary = cluster[0]
        competition_ids = [row["id"] for row in cluster]
        titles = [row["title"] for row in cluster]
        notice_ids = [row["official_notice_id"] for row in cluster if row["official_notice_id"]]
        detected_at = max(row["updated_at"] for row in cluster)

        candidates.append(
            {
                "queue_id": f"duplicate-cluster:{dedup_key}",
                "origin": "worker_diagnostic",
                "reason_code": "duplicate_cluster",
                "priority": 85 + min(len(cluster), 10),
                "title": primary["title"],
                "summary": f"{len(cluster)} canonical records currently share the same dedup key.",
                "competition_id": primary["id"],
                "dedup_key": dedup_key,
                "notice_id": primary["official_notice_id"],
                "payload": {
                    "duplicateCount": len(cluster),
                    "competitionIds": competition_ids,
                    "sampleTitles": titles[:3],
                    "noticeIds": notice_ids,
                },
                "last_detected_at": detected_at,
            }
        )

    return candidates


def _build_low_confidence_candidates(db_path: Path) -> list[dict[str, object | None]]:
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                dedup_key,
                title,
                official_notice_id,
                status,
                evidence_level,
                evidence_note,
                extraction_confidence,
                updated_at
            FROM competitions
            WHERE extraction_confidence < ?
              AND status != 'verified'
            ORDER BY extraction_confidence ASC, updated_at DESC, id ASC
            """,
            (LOW_CONFIDENCE_THRESHOLD,),
        ).fetchall()

    return [
        {
            "queue_id": f"low-confidence:{row['id']}",
            "origin": "worker_diagnostic",
            "reason_code": "low_confidence_record",
            "priority": max(45, int((1 - row["extraction_confidence"]) * 100)),
            "title": row["title"],
            "summary": (
                f"Extraction confidence {row['extraction_confidence']:.2f} on a "
                f"{row['status']} canonical record."
            ),
            "competition_id": row["id"],
            "dedup_key": row["dedup_key"],
            "notice_id": row["official_notice_id"],
            "evidence_note": row["evidence_note"],
            "payload": {
                "status": row["status"],
                "evidenceLevel": row["evidence_level"],
                "extractionConfidence": row["extraction_confidence"],
            },
            "last_detected_at": row["updated_at"],
        }
        for row in rows
    ]


def _contains_conflict_signal(value: str | None) -> bool:
    if not value:
        return False
    normalized = re.sub(r"\s+", " ", value.strip().lower())
    return any(keyword in normalized for keyword in CONFLICT_KEYWORDS)


def _build_conflict_candidates(db_path: Path) -> list[dict[str, object | None]]:
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT
                id,
                dedup_key,
                title,
                official_notice_id,
                official_url,
                source_url,
                evidence_note,
                extraction_confidence,
                updated_at
            FROM competitions
            WHERE evidence_note IS NOT NULL
            ORDER BY updated_at DESC, id ASC
            """
        ).fetchall()

    candidates: list[dict[str, object | None]] = []
    for row in rows:
        if not _contains_conflict_signal(row["evidence_note"]):
            continue

        candidates.append(
            {
                "queue_id": f"evidence-conflict:{row['id']}",
                "origin": "worker_diagnostic",
                "reason_code": "evidence_conflict",
                "priority": 92,
                "title": row["title"],
                "summary": "Evidence notes record an explicit conflict that needs operator review.",
                "competition_id": row["id"],
                "dedup_key": row["dedup_key"],
                "notice_id": row["official_notice_id"],
                "evidence_note": row["evidence_note"],
                "payload": {
                    "officialUrl": row["official_url"],
                    "sourceUrl": row["source_url"],
                    "extractionConfidence": row["extraction_confidence"],
                },
                "last_detected_at": row["updated_at"],
            }
        )

    return candidates


def generate_review_queue_candidates(db_path: Path) -> list[dict[str, object | None]]:
    ensure_schema(db_path)
    candidates = [
        *_build_source_review_candidates(db_path),
        *_build_conflict_candidates(db_path),
        *_build_duplicate_candidates(db_path),
        *_build_low_confidence_candidates(db_path),
    ]
    generated_at = datetime.now(timezone.utc).isoformat()

    for candidate in candidates:
        candidate.setdefault("last_detected_at", generated_at)
        candidate.setdefault("first_detected_at", candidate["last_detected_at"])
        candidate.setdefault("updated_at", generated_at)
        candidate.setdefault("status", "pending")

    candidates.sort(
        key=lambda item: (
            -int(item.get("priority") or 0),
            str(item.get("last_detected_at") or ""),
            str(item["queue_id"]),
        ),
        reverse=False,
    )
    return candidates


def refresh_review_queue(db_path: Path) -> list[dict[str, object | None]]:
    candidates = generate_review_queue_candidates(db_path)
    sync_review_queue_items(db_path, items=candidates)
    return candidates
