"""Repository for the ``competitions`` table."""

from __future__ import annotations

import json
import sqlite3
from collections.abc import Collection, Iterable
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers import build_competition_id, build_competition_key
from arch_competition_ops.storage.connection import connect, write_transaction
from arch_competition_ops.storage.merge import merge_rows
from arch_competition_ops.storage.schema import competition_columns, ensure_schema

_JSON_LIST_FIELDS = (
    "regions",
    "languages",
    "competition_types",
    "project_types",
    "building_categories",
    "official_sectors",
    "built_asset_types",
    "design_scopes",
    "project_modes",
    "audience",
    "cpv_codes",
)
_OPTIONAL_BOOL_FIELDS = ("licensed_architect_required", "local_partner_required")


def dedup_key_for(record: CompetitionRecord) -> str:
    # Cross-source duplicate signal: buyer (not platform) + title + deadline. Never an identity.
    return build_competition_key(
        record.title,
        record.organizer or record.authority_name or "",
        record.canonical_deadline(),
    )


def record_to_row(
    record: CompetitionRecord, *, competition_id: str, now_iso: str
) -> dict[str, Any]:
    """Persistence model for ``record``: JSON-encoded lists, ISO dates, 0/1 booleans."""
    row: dict[str, Any] = {
        column: getattr(record, column, None)
        for column in competition_columns()
        if column not in {"id", "dedup_key", "deadline_at", "last_verified_at", "discovered_at"}
    }
    for field in _JSON_LIST_FIELDS:
        row[field] = json.dumps(getattr(record, field))
    for field in _OPTIONAL_BOOL_FIELDS:
        value = getattr(record, field)
        row[field] = int(value) if value is not None else None
    row.update(
        {
            "id": competition_id,
            "dedup_key": dedup_key_for(record),
            "deadline_at": record.deadline_at.isoformat() if record.deadline_at else None,
            "last_verified_at": (
                record.last_verified_at.isoformat() if record.last_verified_at else None
            ),
            "discovered_at": record.discovered_at.isoformat(),
            "updated_at": now_iso,
        }
    )
    return row


def _find_existing(
    connection: sqlite3.Connection, record: CompetitionRecord, new_id: str
) -> sqlite3.Row | None:
    """Resolve which stored row ``record`` refers to, so identity survives title/deadline edits.

    1. the id computed for this record;
    2. the same notice within the same source (the title or deadline was corrected upstream);
    3. a row written by the old id scheme (``title__source-name__deadline``). Those keep their old
       id: bookmarks, watchlist entries and review items still point at it.
    """
    by_id = connection.execute("SELECT * FROM competitions WHERE id = ?", (new_id,)).fetchone()
    if by_id is not None or not record.source_id:
        return by_id

    if record.official_notice_id:
        by_notice = connection.execute(
            """
            SELECT * FROM competitions
            WHERE source_id = ? AND official_notice_id = ?
            ORDER BY updated_at DESC, id ASC
            LIMIT 1
            """,
            (record.source_id, record.official_notice_id),
        ).fetchone()
        if by_notice is not None:
            return by_notice

    if record.source_name:
        legacy_id = build_competition_key(
            record.title, record.source_name, record.canonical_deadline()
        )
        legacy = connection.execute(
            "SELECT * FROM competitions WHERE id = ? AND (source_id IS NULL OR source_id = ?)",
            (legacy_id, record.source_id),
        ).fetchone()
        if legacy is not None:
            return legacy
    if record.source_url_is_notice:
        matches = connection.execute(
            "SELECT * FROM competitions WHERE source_id = ? AND source_url = ? LIMIT 2",
            (record.source_id, record.source_url),
        ).fetchall()
        if len(matches) == 1:
            return matches[0]
    return None


def _write_row(connection: sqlite3.Connection, row: dict[str, Any], *, exists: bool) -> None:
    columns = [column for column in competition_columns() if column in row]
    if exists:
        assignments = ", ".join(f"{column} = :{column}" for column in columns if column != "id")
        connection.execute(f"UPDATE competitions SET {assignments} WHERE id = :id", row)
        return
    connection.execute(
        f"INSERT INTO competitions ({', '.join(columns)}) "
        f"VALUES ({', '.join(f':{column}' for column in columns)})",
        row,
    )


def upsert_in_connection(
    connection: sqlite3.Connection, record: CompetitionRecord, *, now_iso: str
) -> str:
    """Insert or field-merge ``record`` using an already open write transaction."""
    new_id = record.competition_id or build_competition_id(
        title=record.title,
        source_id=record.source_id,
        official_notice_id=record.official_notice_id,
        source_url=record.source_url,
    )
    incoming = record_to_row(record, competition_id=new_id, now_iso=now_iso)
    existing = _find_existing(connection, record, new_id)
    merged = merge_rows(
        existing,
        incoming,
        source_label=record.source_name or record.source_id or "the source",
    )
    if existing is None or any(
        existing[key] != value
        for key, value in merged.items()
        if key not in {"updated_at", "discovered_at", "last_verified_at"}
    ):
        _write_row(connection, merged, exists=existing is not None)
    return merged["id"]


def upsert_competitions(db_path: Path, records: Iterable[CompetitionRecord]) -> list[str]:
    """Upsert a batch in one transaction: either every record is stored or none is."""
    ensure_schema(db_path)
    now_iso = clock.now_utc().isoformat()
    with write_transaction(db_path) as connection:
        return [upsert_in_connection(connection, record, now_iso=now_iso) for record in records]


def upsert_competition(db_path: Path, record: CompetitionRecord) -> str:
    return upsert_competitions(db_path, [record])[0]


def list_competitions(db_path: Path, limit: int = 20) -> list[sqlite3.Row]:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        return connection.execute(
            """
            SELECT id, title, organizer, authority_name, status, opportunity_type, deadline_at,
                   qualification_score, official_url
            FROM competitions
            ORDER BY COALESCE(deadline_at, '9999-12-31') ASC, updated_at DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()


def list_competitions_missing_geocodes(
    db_path: Path, limit: int = 50, *, today: date | None = None
) -> list[sqlite3.Row]:
    """Rows without coordinates, upcoming deadlines first, expired ones last."""
    ensure_schema(db_path)
    reference_day = (today or clock.today()).isoformat()
    with connect(db_path) as connection:
        return connection.execute(
            """
            SELECT id, title, organizer, authority_name, source_url, jurisdiction, location_label,
                   geo_lat, geo_lng, geo_source, geo_confidence
            FROM competitions
            WHERE geo_lat IS NULL OR geo_lng IS NULL
            ORDER BY
                CASE
                    WHEN deadline_at IS NOT NULL AND deadline_at < :today THEN 2
                    WHEN deadline_at IS NULL THEN 1
                    ELSE 0
                END ASC,
                COALESCE(deadline_at, '9999-12-31') ASC,
                updated_at DESC,
                id ASC
            LIMIT :limit
            """,
            {"today": reference_day, "limit": limit},
        ).fetchall()


def list_source_records(
    db_path: Path,
    source_id: str,
    *,
    limit: int = 500,
    require_notice_id: bool = False,
    exclude_statuses: Collection[str] = (),
    exclude_source_url_prefixes: Collection[str] = (),
) -> list[sqlite3.Row]:
    """Stored rows published by ``source_id`` (the column, not a platform display name)."""
    ensure_schema(db_path)
    clauses = ["source_id = :source_id"]
    parameters: dict[str, Any] = {"source_id": source_id, "limit": limit}
    if require_notice_id:
        clauses.append("official_notice_id IS NOT NULL")
    for index, status in enumerate(exclude_statuses):
        clauses.append(f"status != :excluded_{index}")
        parameters[f"excluded_{index}"] = status
    for index, prefix in enumerate(exclude_source_url_prefixes):
        clauses.append(
            "(source_url IS NULL OR "
            f"substr(source_url, 1, length(:prefix_{index})) != :prefix_{index})"
        )
        parameters[f"prefix_{index}"] = prefix
    with connect(db_path) as connection:
        return connection.execute(
            f"""
            SELECT id, title, official_notice_id, source_url, status, authority_name,
                   eligibility_summary
            FROM competitions
            WHERE {" AND ".join(clauses)}
            ORDER BY updated_at DESC, id ASC
            LIMIT :limit
            """,
            parameters,
        ).fetchall()


def list_expired_competition_ids(
    db_path: Path,
    *,
    expired_before: date,
    limit: int = 500,
) -> list[str]:
    """Ids whose deadline is before ``expired_before``, excluding opportunities somebody watches."""
    ensure_schema(db_path)
    with connect(db_path) as connection:
        rows = connection.execute(
            """
            SELECT id
            FROM competitions
            WHERE deadline_at IS NOT NULL
              AND deadline_at < ?
              AND NOT EXISTS (
                  SELECT 1 FROM workspace_watchlist_entries watch
                  WHERE watch.opportunity_id = competitions.id
              )
            ORDER BY deadline_at ASC, updated_at ASC, id ASC
            LIMIT ?
            """,
            (expired_before.isoformat(), limit),
        ).fetchall()
    return [str(row["id"]) for row in rows]


def delete_competitions(db_path: Path, *, competition_ids: list[str]) -> int:
    """Delete opportunities that nobody has watchlisted; return how many rows were deleted.

    User data is never removed as a side effect. ``workspace_watchlist_entries`` rows are the
    user's, and the foreign key forbids deleting a watched opportunity, so watched ones are left in
    place (expiry cleanup simply skips them; the user removes the watch when done).
    ``ops_review_queue_items`` / ``ops_review_decisions`` are the audit trail: they keep their
    ``competition_id`` reference and the next review-queue refresh deactivates the stale items
    instead of deleting them or their decisions.
    """
    ensure_schema(db_path)
    unique_ids = [value for value in dict.fromkeys(competition_ids) if value]
    if not unique_ids:
        return 0

    placeholders = ", ".join("?" for _ in unique_ids)
    with write_transaction(db_path) as connection:
        cursor = connection.execute(
            f"""
            DELETE FROM competitions
            WHERE id IN ({placeholders})
              AND NOT EXISTS (
                  SELECT 1 FROM workspace_watchlist_entries watch
                  WHERE watch.opportunity_id = competitions.id
              )
            """,
            unique_ids,
        )
        return int(cursor.rowcount or 0)


def competition_is_stale_expired(
    record: CompetitionRecord,
    *,
    retention_days: int,
    today: date | None = None,
) -> bool:
    if record.deadline_at is None:
        return False

    comparison_day = today or clock.today()
    expiry_threshold = comparison_day - timedelta(days=max(retention_days, 0))
    return record.deadline_at < expiry_threshold


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
    with write_transaction(db_path) as connection:
        previous = connection.execute(
            "SELECT updated_at FROM competitions WHERE id = ? AND "
            "(location_label,geo_lat,geo_lng,geo_source,geo_confidence) IS NOT (?,?,?,?,?)",
            (competition_id, location_label, geo_lat, geo_lng, geo_source, geo_confidence),
        ).fetchone()
        if previous is None:
            return
        now_iso = clock.now_utc().isoformat()
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
                now_iso,
                competition_id,
            ),
        )
        # Coordinates are derived metadata, not a newer notice. Preserve current advice
        # atomically; an already stale assessment must never become current again.
        connection.execute(
            "UPDATE ai_screening_results SET source_updated_at = ? "
            "WHERE competition_id = ? AND source_updated_at = ?",
            (now_iso, competition_id, previous["updated_at"]),
        )


def list_competitions_with_generic_jurisdiction(db_path: Path) -> list[sqlite3.Row]:
    """Rows whose jurisdiction names no country (``eu``, ``europe``, ``global``, blank)."""
    ensure_schema(db_path)
    with connect(db_path) as connection:
        return connection.execute(
            """
            SELECT id, title, location_label, jurisdiction
            FROM competitions
            WHERE jurisdiction IS NULL
               OR TRIM(jurisdiction) = ''
               OR LOWER(TRIM(jurisdiction)) IN
                  ('eu', 'europe', 'global', 'international', 'unknown', 'worldwide')
            ORDER BY id
            """
        ).fetchall()


def update_competition_jurisdiction(
    db_path: Path, *, competition_id: str, jurisdiction: str
) -> None:
    """Sets the country of a record whose source named none (derived metadata, like coordinates)."""
    ensure_schema(db_path)
    with write_transaction(db_path) as connection:
        previous = connection.execute(
            "SELECT updated_at FROM competitions WHERE id = ? AND jurisdiction IS NOT ?",
            (competition_id, jurisdiction),
        ).fetchone()
        if previous is None:
            return
        now_iso = clock.now_utc().isoformat()
        connection.execute(
            "UPDATE competitions SET jurisdiction = ?, updated_at = ? WHERE id = ?",
            (jurisdiction, now_iso, competition_id),
        )
        # The country is read from the notice that is already stored, not a newer notice:
        # current advice stays current, an already stale assessment stays stale.
        connection.execute(
            "UPDATE ai_screening_results SET source_updated_at = ? "
            "WHERE competition_id = ? AND source_updated_at = ?",
            (now_iso, competition_id, previous["updated_at"]),
        )


def update_competition_source_url(db_path: Path, *, competition_id: str, source_url: str) -> None:
    ensure_schema(db_path)
    with write_transaction(db_path) as connection:
        connection.execute(
            "UPDATE competitions SET source_url = ?, updated_at = ? "
            "WHERE id = ? AND source_url IS NOT ?",
            (source_url, clock.now_utc().isoformat(), competition_id, source_url),
        )


def update_competition_status(
    db_path: Path,
    *,
    competition_id: str,
    status: str,
    only_from: Collection[str] | None = None,
) -> bool:
    """Explicit status change (maintenance commands, operators). Returns whether a row changed.

    ``only_from`` restricts the transition to rows currently in one of those statuses, so an
    automated normalizer can archive ``discovered`` rows without overriding a human decision.
    """
    ensure_schema(db_path)
    clause = ""
    parameters: list[Any] = [status, clock.now_utc().isoformat(), competition_id, status]
    if only_from is not None:
        allowed = list(only_from)
        clause = f" AND status IN ({', '.join('?' for _ in allowed)})"
        parameters.extend(allowed)
    with write_transaction(db_path) as connection:
        cursor = connection.execute(
            "UPDATE competitions SET status = ?, updated_at = ? "
            f"WHERE id = ? AND status IS NOT ?{clause}",
            parameters,
        )
        return bool(cursor.rowcount)


def find_duplicate_records(db_path: Path) -> list[sqlite3.Row]:
    ensure_schema(db_path)
    with connect(db_path) as connection:
        return connection.execute(
            """
            SELECT dedup_key, COUNT(*) AS duplicate_count
            FROM competitions
            GROUP BY dedup_key
            HAVING COUNT(*) > 1
            ORDER BY duplicate_count DESC, dedup_key ASC
            """
        ).fetchall()
