"""Source run history and per-source health."""

from __future__ import annotations

from pathlib import Path

from arch_competition_ops.storage.connection import write_transaction
from arch_competition_ops.storage.schema import ensure_schema

SUCCESS_STATUSES = frozenset({"success", "completed_with_failures", "empty"})


def record_source_run(
    db_path: Path,
    *,
    source_id: str,
    source_name: str,
    source_kind: str,
    source_tier: str,
    status: str,
    started_at: str,
    completed_at: str | None,
    document_count: int,
    upserted_count: int,
    parse_failure_count: int,
    duplicate_group_count: int,
    max_duplicate_group_size: int,
    last_error: str | None = None,
) -> None:
    """Append one ``source_runs`` row and upsert ``source_health`` atomically."""
    ensure_schema(db_path)
    last_success_at = completed_at if status in SUCCESS_STATUSES else None

    run_payload = {
        "source_id": source_id,
        "source_name": source_name,
        "source_kind": source_kind,
        "source_tier": source_tier,
        "status": status,
        "started_at": started_at,
        "completed_at": completed_at,
        "document_count": document_count,
        "upserted_count": upserted_count,
        "parse_failure_count": parse_failure_count,
        "duplicate_group_count": duplicate_group_count,
        "max_duplicate_group_size": max_duplicate_group_size,
        "last_error": last_error,
    }
    health_payload = {
        "source_id": source_id,
        "source_name": source_name,
        "source_kind": source_kind,
        "source_tier": source_tier,
        "last_status": status,
        "last_run_started_at": started_at,
        "last_run_completed_at": completed_at,
        "last_success_at": last_success_at,
        "last_document_count": document_count,
        "last_upserted_count": upserted_count,
        "last_parse_failure_count": parse_failure_count,
        "duplicate_group_count": duplicate_group_count,
        "max_duplicate_group_size": max_duplicate_group_size,
        "last_error": last_error,
        "updated_at": completed_at or started_at,
    }

    with write_transaction(db_path) as connection:
        connection.execute(
            """
            INSERT INTO source_runs (
                source_id, source_name, source_kind, source_tier, status, started_at,
                completed_at, document_count, upserted_count, parse_failure_count,
                duplicate_group_count, max_duplicate_group_size, last_error
            ) VALUES (
                :source_id, :source_name, :source_kind, :source_tier, :status, :started_at,
                :completed_at, :document_count, :upserted_count, :parse_failure_count,
                :duplicate_group_count, :max_duplicate_group_size, :last_error
            )
            """,
            run_payload,
        )
        connection.execute(
            """
            INSERT INTO source_health (
                source_id, source_name, source_kind, source_tier, last_status,
                last_run_started_at, last_run_completed_at, last_success_at,
                last_document_count, last_upserted_count, last_parse_failure_count,
                duplicate_group_count, max_duplicate_group_size, last_error, updated_at
            ) VALUES (
                :source_id, :source_name, :source_kind, :source_tier, :last_status,
                :last_run_started_at, :last_run_completed_at, :last_success_at,
                :last_document_count, :last_upserted_count, :last_parse_failure_count,
                :duplicate_group_count, :max_duplicate_group_size, :last_error, :updated_at
            )
            ON CONFLICT(source_id) DO UPDATE SET
                source_name = excluded.source_name,
                source_kind = excluded.source_kind,
                source_tier = excluded.source_tier,
                last_status = excluded.last_status,
                last_run_started_at = excluded.last_run_started_at,
                last_run_completed_at = excluded.last_run_completed_at,
                last_success_at = COALESCE(excluded.last_success_at, source_health.last_success_at),
                last_document_count = excluded.last_document_count,
                last_upserted_count = excluded.last_upserted_count,
                last_parse_failure_count = excluded.last_parse_failure_count,
                duplicate_group_count = excluded.duplicate_group_count,
                max_duplicate_group_size = excluded.max_duplicate_group_size,
                last_error = excluded.last_error,
                updated_at = excluded.updated_at
            """,
            health_payload,
        )
