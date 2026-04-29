import sqlite3
from datetime import date

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.storage import (
    ensure_schema,
    record_review_queue_decision,
    upsert_competition,
)


def test_refresh_review_queue_builds_candidates_and_deactivates_stale_worker_items(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)

    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="duplicate-a",
            title="Duplicate Opportunity",
            organizer="TED",
            source_url="https://example.com/dup-a",
            official_url="https://example.com/dup-a",
            status="verified",
            opportunity_type="public_design_contest",
            deadline_at=date(2026, 8, 1),
            extraction_confidence=0.91,
            evidence_level="official_notice",
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="duplicate-b",
            title="Duplicate Opportunity",
            organizer="TED",
            source_url="https://example.com/dup-b",
            official_url="https://example.com/dup-b",
            status="verified",
            opportunity_type="public_design_contest",
            deadline_at=date(2026, 8, 1),
            extraction_confidence=0.9,
            evidence_level="official_notice",
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="conflict-low",
            title="Conflicted Low Confidence Opportunity",
            organizer="Secondary Feed",
            source_url="https://example.com/feed/conflict-low",
            official_url="https://example.com/official/conflict-low",
            status="discovered",
            opportunity_type="public_design_services_procurement",
            deadline_at=date(2026, 9, 1),
            extraction_confidence=0.62,
            evidence_level="official_listing",
            evidence_note="Official source wins over aggregator conflict.",
        ),
    )

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO source_health (
                source_id, source_name, source_kind, source_tier, last_status,
                last_run_started_at, last_run_completed_at, last_success_at,
                last_document_count, last_upserted_count, last_parse_failure_count,
                duplicate_group_count, max_duplicate_group_size, last_error, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "ted_design_notices",
                "TED Design Notices",
                "official_procurement",
                "primary",
                "failed",
                "2026-04-20T06:00:00+00:00",
                "2026-04-20T06:05:00+00:00",
                None,
                12,
                0,
                2,
                1,
                2,
                "Parser validation failed on two payloads.",
                "2026-04-20T06:05:00+00:00",
            ),
        )
        connection.execute(
            """
            INSERT INTO ops_review_queue_items (
                queue_id, origin, reason_code, status, priority, title, summary, evidence_note,
                source_id, competition_id, dedup_key, notice_id, payload_json, is_active,
                first_detected_at, last_detected_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "stale:worker-item",
                "worker_diagnostic",
                "low_confidence_record",
                "pending",
                20,
                "Stale worker item",
                "Should be deactivated on next sync.",
                None,
                None,
                None,
                None,
                None,
                "{}",
                1,
                "2026-04-18T00:00:00+00:00",
                "2026-04-18T00:00:00+00:00",
                "2026-04-18T00:00:00+00:00",
            ),
        )
        connection.commit()

    candidates = refresh_review_queue(db_path)
    reason_codes = {candidate["reason_code"] for candidate in candidates}

    assert reason_codes == {
        "source_run_failed",
        "source_parse_failures",
        "duplicate_cluster",
        "low_confidence_record",
        "evidence_conflict",
    }

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        duplicate_key = connection.execute(
            "SELECT dedup_key FROM competitions WHERE id = ?",
            ("duplicate-a",),
        ).fetchone()["dedup_key"]
        stale_row = connection.execute(
            "SELECT is_active FROM ops_review_queue_items WHERE queue_id = ?",
            ("stale:worker-item",),
        ).fetchone()
        active_rows = connection.execute(
            "SELECT queue_id FROM ops_review_queue_items WHERE is_active = 1"
        ).fetchall()

    assert stale_row["is_active"] == 0
    assert {row["queue_id"] for row in active_rows} == {
        "source-run-failed:ted_design_notices",
        "source-parse-failures:ted_design_notices",
        f"duplicate-cluster:{duplicate_key}",
        "low-confidence:conflict-low",
        "evidence-conflict:conflict-low",
    }

    record_review_queue_decision(
        db_path,
        queue_id=f"duplicate-cluster:{duplicate_key}",
        decision="needs_follow_up",
        actor_label="local_operator",
        note="Inspect both notices before deciding on merge workflow.",
    )

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        queue_row = connection.execute(
            "SELECT status FROM ops_review_queue_items WHERE queue_id = ?",
            (f"duplicate-cluster:{duplicate_key}",),
        ).fetchone()
        decision_row = connection.execute(
            """
            SELECT decision, actor_label, note
            FROM ops_review_decisions
            WHERE queue_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (f"duplicate-cluster:{duplicate_key}",),
        ).fetchone()

    assert queue_row["status"] == "needs_follow_up"
    assert decision_row["decision"] == "needs_follow_up"
    assert decision_row["actor_label"] == "local_operator"
    assert decision_row["note"] == "Inspect both notices before deciding on merge workflow."

    refresh_review_queue(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        follow_up_row = connection.execute(
            "SELECT status, is_active FROM ops_review_queue_items WHERE queue_id = ?",
            (f"duplicate-cluster:{duplicate_key}",),
        ).fetchone()
        latest_follow_up_decision_row = connection.execute(
            """
            SELECT decision
            FROM ops_review_decisions
            WHERE queue_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            (f"duplicate-cluster:{duplicate_key}",),
        ).fetchone()

    assert follow_up_row["status"] == "needs_follow_up"
    assert follow_up_row["is_active"] == 1
    assert latest_follow_up_decision_row["decision"] == "needs_follow_up"

    record_review_queue_decision(
        db_path,
        queue_id="source-run-failed:ted_design_notices",
        decision="accepted",
        actor_label="local_operator",
        note="Temporary acceptance before the next failing run.",
    )

    refreshed_candidates = refresh_review_queue(db_path)

    assert any(
        candidate["queue_id"] == "source-run-failed:ted_design_notices"
        and candidate["status"] == "pending"
        for candidate in refreshed_candidates
    )

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        reopened_row = connection.execute(
            "SELECT status, is_active FROM ops_review_queue_items WHERE queue_id = ?",
            ("source-run-failed:ted_design_notices",),
        ).fetchone()
        latest_decision_row = connection.execute(
            """
            SELECT decision
            FROM ops_review_decisions
            WHERE queue_id = ?
            ORDER BY id DESC
            LIMIT 1
            """,
            ("source-run-failed:ted_design_notices",),
        ).fetchone()

    assert reopened_row["status"] == "pending"
    assert reopened_row["is_active"] == 1
    assert latest_decision_row["decision"] == "accepted"
