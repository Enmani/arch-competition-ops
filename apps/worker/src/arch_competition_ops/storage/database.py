from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers import build_competition_key


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS competitions (
    id TEXT PRIMARY KEY,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    organizer TEXT NOT NULL,
    authority_name TEXT,
    official_url TEXT,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL,
    opportunity_type TEXT NOT NULL,
    jurisdiction TEXT,
    procedure_type TEXT,
    official_notice_id TEXT,
    regions TEXT NOT NULL,
    languages TEXT NOT NULL,
    competition_types TEXT NOT NULL,
    audience TEXT NOT NULL,
    cpv_codes TEXT NOT NULL,
    implementation_path TEXT,
    licensed_architect_required INTEGER,
    local_partner_required INTEGER,
    registration_fee_eur REAL,
    submission_fee_eur REAL,
    estimated_contract_value_eur REAL,
    estimated_contract_value_text TEXT,
    prize_summary TEXT,
    location_label TEXT,
    geo_lat REAL,
    geo_lng REAL,
    geo_source TEXT,
    geo_confidence REAL,
    deadline_at TEXT,
    eligibility_summary TEXT,
    brief_pdf_url TEXT,
    documents_portal_url TEXT,
    extraction_confidence REAL NOT NULL,
    evidence_level TEXT NOT NULL,
    qualification_score REAL,
    evidence_note TEXT,
    last_verified_at TEXT,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_competitions_dedup_key ON competitions (dedup_key);
CREATE INDEX IF NOT EXISTS idx_competitions_official_url ON competitions (official_url);
CREATE INDEX IF NOT EXISTS idx_competitions_notice_id ON competitions (official_notice_id);

CREATE TABLE IF NOT EXISTS source_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_tier TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT,
    document_count INTEGER NOT NULL DEFAULT 0,
    upserted_count INTEGER NOT NULL DEFAULT 0,
    parse_failure_count INTEGER NOT NULL DEFAULT 0,
    duplicate_group_count INTEGER NOT NULL DEFAULT 0,
    max_duplicate_group_size INTEGER NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_source_runs_source_id ON source_runs (source_id);
CREATE INDEX IF NOT EXISTS idx_source_runs_completed_at ON source_runs (completed_at);

CREATE TABLE IF NOT EXISTS source_health (
    source_id TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    source_tier TEXT NOT NULL,
    last_status TEXT NOT NULL,
    last_run_started_at TEXT,
    last_run_completed_at TEXT,
    last_success_at TEXT,
    last_document_count INTEGER NOT NULL DEFAULT 0,
    last_upserted_count INTEGER NOT NULL DEFAULT 0,
    last_parse_failure_count INTEGER NOT NULL DEFAULT 0,
    duplicate_group_count INTEGER NOT NULL DEFAULT 0,
    max_duplicate_group_size INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_source_health_updated_at ON source_health (updated_at);

CREATE TABLE IF NOT EXISTS ops_review_queue_items (
    queue_id TEXT PRIMARY KEY,
    origin TEXT NOT NULL DEFAULT 'worker_diagnostic',
    reason_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    priority INTEGER NOT NULL DEFAULT 0,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    evidence_note TEXT,
    source_id TEXT,
    competition_id TEXT,
    dedup_key TEXT,
    notice_id TEXT,
    payload_json TEXT NOT NULL DEFAULT '{}',
    is_active INTEGER NOT NULL DEFAULT 1,
    first_detected_at TEXT NOT NULL,
    last_detected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ops_review_queue_active_status
    ON ops_review_queue_items (is_active, status, priority DESC, last_detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_ops_review_queue_reason
    ON ops_review_queue_items (reason_code, is_active, priority DESC);
CREATE INDEX IF NOT EXISTS idx_ops_review_queue_competition_id
    ON ops_review_queue_items (competition_id);
CREATE INDEX IF NOT EXISTS idx_ops_review_queue_source_id
    ON ops_review_queue_items (source_id);

CREATE TABLE IF NOT EXISTS ops_review_decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    queue_id TEXT NOT NULL,
    decision TEXT NOT NULL,
    actor_label TEXT,
    note TEXT,
    created_at TEXT NOT NULL,
    FOREIGN KEY(queue_id) REFERENCES ops_review_queue_items(queue_id)
);

CREATE INDEX IF NOT EXISTS idx_ops_review_decisions_queue_id
    ON ops_review_decisions (queue_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspace_saved_searches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_key TEXT NOT NULL,
    name TEXT NOT NULL,
    filters_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_saved_searches_workspace_updated
    ON workspace_saved_searches (workspace_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS workspace_watchlist_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_key TEXT NOT NULL,
    opportunity_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY(opportunity_id) REFERENCES competitions(id),
    UNIQUE(workspace_key, opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_watchlist_entries_workspace_updated
    ON workspace_watchlist_entries (workspace_key, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_workspace_watchlist_entries_opportunity
    ON workspace_watchlist_entries (opportunity_id);
"""

REQUIRED_COLUMN_ORDER = (
    "id",
    "dedup_key",
    "title",
    "organizer",
    "authority_name",
    "official_url",
    "source_url",
    "status",
    "opportunity_type",
    "jurisdiction",
    "procedure_type",
    "official_notice_id",
    "regions",
    "languages",
    "competition_types",
    "audience",
    "cpv_codes",
    "implementation_path",
    "licensed_architect_required",
    "local_partner_required",
    "registration_fee_eur",
    "submission_fee_eur",
    "estimated_contract_value_eur",
    "estimated_contract_value_text",
    "prize_summary",
    "location_label",
    "geo_lat",
    "geo_lng",
    "geo_source",
    "geo_confidence",
    "deadline_at",
    "eligibility_summary",
    "brief_pdf_url",
    "documents_portal_url",
    "extraction_confidence",
    "evidence_level",
    "qualification_score",
    "evidence_note",
    "last_verified_at",
    "discovered_at",
    "updated_at",
)

SAFE_ADD_COLUMN_DEFINITIONS = {
    "authority_name": "TEXT",
    "official_url": "TEXT",
    "jurisdiction": "TEXT",
    "procedure_type": "TEXT",
    "official_notice_id": "TEXT",
    "implementation_path": "TEXT",
    "licensed_architect_required": "INTEGER",
    "local_partner_required": "INTEGER",
    "registration_fee_eur": "REAL",
    "submission_fee_eur": "REAL",
    "estimated_contract_value_eur": "REAL",
    "estimated_contract_value_text": "TEXT",
    "prize_summary": "TEXT",
    "location_label": "TEXT",
    "geo_lat": "REAL",
    "geo_lng": "REAL",
    "geo_source": "TEXT",
    "geo_confidence": "REAL",
    "deadline_at": "TEXT",
    "eligibility_summary": "TEXT",
    "brief_pdf_url": "TEXT",
    "documents_portal_url": "TEXT",
    "qualification_score": "REAL",
    "evidence_note": "TEXT",
    "last_verified_at": "TEXT",
}

OPS_REVIEW_STATUSES = {"pending", "accepted", "rejected", "needs_follow_up"}


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def _table_exists(connection: sqlite3.Connection, table_name: str) -> bool:
    return (
        connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
            (table_name,),
        ).fetchone()
        is not None
    )


def _get_table_columns(connection: sqlite3.Connection, table_name: str) -> list[str]:
    return [
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
    ]


def _quote_identifier(identifier: str) -> str:
    return f'"{identifier}"'


def _has_unique_index(
    connection: sqlite3.Connection, table_name: str, expected_columns: list[str]
) -> bool:
    index_rows = connection.execute(
        f"PRAGMA index_list({_quote_identifier(table_name)})"
    ).fetchall()

    for index_row in index_rows:
        if index_row["unique"] != 1:
            continue

        index_name = index_row["name"]
        index_columns = [
            row["name"]
            for row in connection.execute(
                f"PRAGMA index_info({_quote_identifier(index_name)})"
            ).fetchall()
        ]
        if index_columns == expected_columns:
            return True

    return False


def _ensure_workspace_watchlist_entry_uniqueness(connection: sqlite3.Connection) -> None:
    if not _table_exists(connection, "workspace_watchlist_entries"):
        return

    if _has_unique_index(
        connection,
        "workspace_watchlist_entries",
        ["workspace_key", "opportunity_id"],
    ):
        return

    connection.execute(
        """
        DELETE FROM workspace_watchlist_entries
        WHERE id IN (
            SELECT id
            FROM (
                SELECT
                    id,
                    ROW_NUMBER() OVER (
                        PARTITION BY workspace_key, opportunity_id
                        ORDER BY updated_at DESC, created_at DESC, id DESC
                    ) AS row_number
                FROM workspace_watchlist_entries
            )
            WHERE row_number > 1
        )
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_watchlist_entries_workspace_opportunity
            ON workspace_watchlist_entries (workspace_key, opportunity_id)
        """
    )


def ensure_schema(db_path: Path) -> None:
    with connect(db_path) as connection:
        if not _table_exists(connection, "competitions"):
            connection.executescript(SCHEMA_SQL)
            _ensure_workspace_watchlist_entry_uniqueness(connection)
            connection.commit()
            return

        existing_columns = set(_get_table_columns(connection, "competitions"))
        missing_columns = [
            column_name
            for column_name in REQUIRED_COLUMN_ORDER
            if column_name not in existing_columns
        ]

        unsupported_columns = [
            column_name
            for column_name in missing_columns
            if column_name not in SAFE_ADD_COLUMN_DEFINITIONS
        ]
        if unsupported_columns:
            raise RuntimeError(
                "Unsupported competitions schema drift. Missing non-additive columns: "
                + ", ".join(sorted(unsupported_columns))
            )

        for column_name in missing_columns:
            column_definition = SAFE_ADD_COLUMN_DEFINITIONS[column_name]
            connection.execute(
                f"ALTER TABLE competitions ADD COLUMN {_quote_identifier(column_name)} {column_definition}"
            )

        connection.executescript(SCHEMA_SQL)
        _ensure_workspace_watchlist_entry_uniqueness(connection)
        connection.commit()


def restore_legacy_competitions(db_path: Path) -> int:
    ensure_schema(db_path)

    with connect(db_path) as connection:
        if not _table_exists(connection, "competitions_legacy"):
            return 0

        current_columns = _get_table_columns(connection, "competitions")
        legacy_columns = set(_get_table_columns(connection, "competitions_legacy"))
        quoted_current_columns = ", ".join(
            _quote_identifier(column_name) for column_name in current_columns
        )
        select_expressions = ", ".join(
            (
                f'legacy.{_quote_identifier(column_name)}'
                if column_name in legacy_columns
                else f"NULL AS {_quote_identifier(column_name)}"
            )
            for column_name in current_columns
        )

        missing_row_count = connection.execute(
            """
            SELECT COUNT(*)
            FROM competitions_legacy AS legacy
            LEFT JOIN competitions AS current ON current.id = legacy.id
            WHERE current.id IS NULL
            """
        ).fetchone()[0]
        if missing_row_count == 0:
            return 0

        connection.execute(
            f"""
            INSERT INTO competitions ({quoted_current_columns})
            SELECT {select_expressions}
            FROM competitions_legacy AS legacy
            LEFT JOIN competitions AS current ON current.id = legacy.id
            WHERE current.id IS NULL
            """
        )
        connection.commit()

    return int(missing_row_count)


def upsert_competition(db_path: Path, record: CompetitionRecord) -> str:
    ensure_schema(db_path)
    dedup_key = build_competition_key(
        record.title,
        record.organizer,
        record.canonical_deadline(),
    )
    competition_id = record.competition_id or dedup_key
    now = datetime.now(timezone.utc).isoformat()
    discovered_at = record.discovered_at.isoformat()
    last_verified_at = (
        record.last_verified_at.isoformat() if record.last_verified_at is not None else None
    )

    payload = {
        "id": competition_id,
        "dedup_key": dedup_key,
        "title": record.title,
        "organizer": record.organizer,
        "authority_name": record.authority_name,
        "official_url": record.official_url,
        "source_url": record.source_url,
        "status": record.status,
        "opportunity_type": record.opportunity_type,
        "jurisdiction": record.jurisdiction,
        "procedure_type": record.procedure_type,
        "official_notice_id": record.official_notice_id,
        "regions": json.dumps(record.regions),
        "languages": json.dumps(record.languages),
        "competition_types": json.dumps(record.competition_types),
        "audience": json.dumps(record.audience),
        "cpv_codes": json.dumps(record.cpv_codes),
        "implementation_path": record.implementation_path,
        "licensed_architect_required": (
            int(record.licensed_architect_required)
            if record.licensed_architect_required is not None
            else None
        ),
        "local_partner_required": (
            int(record.local_partner_required) if record.local_partner_required is not None else None
        ),
        "registration_fee_eur": record.registration_fee_eur,
        "submission_fee_eur": record.submission_fee_eur,
        "estimated_contract_value_eur": record.estimated_contract_value_eur,
        "estimated_contract_value_text": record.estimated_contract_value_text,
        "prize_summary": record.prize_summary,
        "location_label": record.location_label,
        "geo_lat": record.geo_lat,
        "geo_lng": record.geo_lng,
        "geo_source": record.geo_source,
        "geo_confidence": record.geo_confidence,
        "deadline_at": record.deadline_at.isoformat() if record.deadline_at else None,
        "eligibility_summary": record.eligibility_summary,
        "brief_pdf_url": record.brief_pdf_url,
        "documents_portal_url": record.documents_portal_url,
        "extraction_confidence": record.extraction_confidence,
        "evidence_level": record.evidence_level,
        "qualification_score": record.qualification_score,
        "evidence_note": record.evidence_note,
        "last_verified_at": last_verified_at,
        "discovered_at": discovered_at,
        "updated_at": now,
    }

    with connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO competitions (
                id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
                opportunity_type, jurisdiction, procedure_type, official_notice_id, regions,
                languages, competition_types, audience, cpv_codes, implementation_path,
                licensed_architect_required, local_partner_required, registration_fee_eur,
                submission_fee_eur, estimated_contract_value_eur, estimated_contract_value_text,
                prize_summary, location_label, geo_lat, geo_lng, geo_source, geo_confidence, deadline_at,
                eligibility_summary, brief_pdf_url, documents_portal_url, extraction_confidence, evidence_level,
                qualification_score, evidence_note, last_verified_at, discovered_at, updated_at
            ) VALUES (
                :id, :dedup_key, :title, :organizer, :authority_name, :official_url, :source_url,
                :status, :opportunity_type, :jurisdiction, :procedure_type, :official_notice_id,
                :regions, :languages, :competition_types, :audience, :cpv_codes,
                :implementation_path, :licensed_architect_required, :local_partner_required,
                :registration_fee_eur, :submission_fee_eur, :estimated_contract_value_eur,
                :estimated_contract_value_text, :prize_summary, :location_label, :geo_lat, :geo_lng,
                :geo_source, :geo_confidence, :deadline_at, :eligibility_summary,
                :brief_pdf_url, :documents_portal_url,
                :extraction_confidence, :evidence_level, :qualification_score, :evidence_note,
                :last_verified_at, :discovered_at, :updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
                authority_name = excluded.authority_name,
                official_url = excluded.official_url,
                source_url = excluded.source_url,
                status = excluded.status,
                opportunity_type = excluded.opportunity_type,
                jurisdiction = excluded.jurisdiction,
                procedure_type = excluded.procedure_type,
                official_notice_id = excluded.official_notice_id,
                regions = excluded.regions,
                languages = excluded.languages,
                competition_types = excluded.competition_types,
                audience = excluded.audience,
                cpv_codes = excluded.cpv_codes,
                implementation_path = excluded.implementation_path,
                licensed_architect_required = excluded.licensed_architect_required,
                local_partner_required = excluded.local_partner_required,
                registration_fee_eur = excluded.registration_fee_eur,
                submission_fee_eur = excluded.submission_fee_eur,
                estimated_contract_value_eur = excluded.estimated_contract_value_eur,
                estimated_contract_value_text = excluded.estimated_contract_value_text,
                prize_summary = excluded.prize_summary,
                location_label = excluded.location_label,
                geo_lat = excluded.geo_lat,
                geo_lng = excluded.geo_lng,
                geo_source = excluded.geo_source,
                geo_confidence = excluded.geo_confidence,
                deadline_at = excluded.deadline_at,
                eligibility_summary = excluded.eligibility_summary,
                brief_pdf_url = excluded.brief_pdf_url,
                documents_portal_url = excluded.documents_portal_url,
                extraction_confidence = excluded.extraction_confidence,
                evidence_level = excluded.evidence_level,
                qualification_score = excluded.qualification_score,
                evidence_note = excluded.evidence_note,
                last_verified_at = excluded.last_verified_at,
                updated_at = excluded.updated_at
            """,
            payload,
        )
        connection.commit()

    return competition_id


def list_competitions(db_path: Path, limit: int = 20) -> list[sqlite3.Row]:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id, title, organizer, authority_name, status, opportunity_type, deadline_at,
                   qualification_score, official_url
            FROM competitions
            ORDER BY COALESCE(deadline_at, '9999-12-31') ASC, updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return rows


def list_competitions_missing_geocodes(db_path: Path, limit: int = 50) -> list[sqlite3.Row]:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id, title, organizer, authority_name, source_url, jurisdiction, location_label,
                   geo_lat, geo_lng, geo_source, geo_confidence
            FROM competitions
            WHERE geo_lat IS NULL OR geo_lng IS NULL
            ORDER BY
                CASE
                    WHEN deadline_at IS NOT NULL AND deadline_at < date('now') THEN 2
                    WHEN deadline_at IS NULL THEN 1
                    ELSE 0
                END ASC,
                COALESCE(deadline_at, '9999-12-31') ASC,
                updated_at DESC,
                id ASC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
    return rows


def update_competition_geocode_fields(
    db_path: Path,
    *,
    competition_id: str,
    location_label: str | None,
    geo_lat: float | None,
    geo_lng: float | None,
    geo_source: str | None,
    geo_confidence: float | None,
) -> None:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        connection.execute(
            """
            UPDATE competitions
            SET location_label = ?,
                geo_lat = ?,
                geo_lng = ?,
                geo_source = ?,
                geo_confidence = ?,
                updated_at = ?
            WHERE id = ?
            """,
            (
                location_label,
                geo_lat,
                geo_lng,
                geo_source,
                geo_confidence,
                datetime.now(timezone.utc).isoformat(),
                competition_id,
            ),
        )
        connection.commit()


def find_duplicate_records(db_path: Path) -> list[sqlite3.Row]:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT dedup_key, COUNT(*) AS duplicate_count
            FROM competitions
            GROUP BY dedup_key
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC, dedup_key ASC
            """
        ).fetchall()
    return rows


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
    ensure_schema(db_path)
    last_success_at = (
        completed_at if status in {"success", "completed_with_failures", "empty"} else None
    )

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

    with connect(db_path) as connection:
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
        connection.commit()


def sync_review_queue_items(
    db_path: Path,
    *,
    items: list[dict[str, Any]],
) -> int:
    ensure_schema(db_path)
    now = datetime.now(timezone.utc).isoformat()
    active_worker_queue_ids: list[str] = []

    with connect(db_path) as connection:
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

        connection.commit()

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

    created_at = datetime.now(timezone.utc).isoformat()

    with connect(db_path) as connection:
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
        connection.commit()
