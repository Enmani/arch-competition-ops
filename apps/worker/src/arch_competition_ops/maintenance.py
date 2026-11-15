"""Maintenance commands: geocode backfill, review queue rebuild, expired-opportunity cleanup."""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.countries import resolve_record_country
from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    delete_competitions,
    list_competitions_missing_geocodes,
    list_competitions_with_generic_jurisdiction,
    list_expired_competition_ids,
    update_competition_geocode_fields,
    update_competition_jurisdiction,
)
from arch_competition_ops.storage.screening import (
    latest_screening_notice_text,
    list_excluded_competition_ids,
    shrink_old_screening_runs,
)

logger = logging.getLogger(__name__)

# Stored prompts and results of AI runs older than this are blanked; the cost rows stay.
SCREENING_RUN_PAYLOAD_RETENTION_DAYS = 45


@dataclass
class ExpiredCompetitionCleanupResult:
    attempted: int
    deleted_competitions: int
    deleted_preview_files: int
    deleted_static_preview_files: int
    skipped: int
    already_ran_today: bool = False
    last_run_date: str | None = None
    # Competitions whose current AI assessment is ``exclude``, deleted after the same retention.
    excluded_attempted: int = 0
    deleted_excluded_competitions: int = 0
    deleted_excluded_preview_files: int = 0
    deleted_excluded_static_preview_files: int = 0
    # Old ``ai_screening_runs`` rows whose payload was blanked (cost rows are kept).
    shrunk_screening_runs: int = 0


def rebuild_review_queue(settings: Settings) -> list[dict[str, object | None]]:
    db_path = initialize_database(settings)
    return refresh_review_queue(db_path)


def _geocode_stored_row(
    db_path: Path, row: Any, *, cache_path: Path, geocoder: NominatimGeocoder
) -> bool:
    """Geocodes one stored row; True when any of its location fields changed."""
    record = CompetitionRecord(
        competition_id=row["id"],
        title=row["title"],
        organizer=row["organizer"],
        authority_name=row["authority_name"],
        source_url=row["source_url"],
        jurisdiction=row["jurisdiction"],
        location_label=row["location_label"],
        geo_lat=row["geo_lat"],
        geo_lng=row["geo_lng"],
        geo_source=row["geo_source"],
        geo_confidence=row["geo_confidence"],
    )
    enriched = enrich_record_geocode(record, cache_path=cache_path, geocoder=geocoder)
    unchanged = (
        enriched.location_label == row["location_label"]
        and enriched.geo_lat == row["geo_lat"]
        and enriched.geo_lng == row["geo_lng"]
        and enriched.geo_source == row["geo_source"]
        and enriched.geo_confidence == row["geo_confidence"]
    )
    if unchanged:
        return False
    update_competition_geocode_fields(
        db_path,
        competition_id=row["id"],
        location_label=enriched.location_label,
        geo_lat=enriched.geo_lat,
        geo_lng=enriched.geo_lng,
        geo_source=enriched.geo_source,
        geo_confidence=enriched.geo_confidence,
    )
    return True


def refresh_missing_geocodes(settings: Settings, *, limit: int = 50) -> int:
    db_path = initialize_database(settings)
    cache_path = settings.resolve_path(settings.geocode_cache)
    geocoder = NominatimGeocoder(cache_path=cache_path)
    updated_count = 0
    scan_limit = max(limit * 6, limit)

    try:
        for row in list_competitions_missing_geocodes(db_path, limit=scan_limit):
            if _geocode_stored_row(db_path, row, cache_path=cache_path, geocoder=geocoder):
                updated_count += 1
                if updated_count >= limit:
                    break
    finally:
        geocoder.flush()

    return updated_count


@dataclass(frozen=True)
class JurisdictionRepairResult:
    scanned: int
    repaired: int
    geocoded: int


def repair_record_jurisdictions(
    settings: Settings, *, geocode: bool = False
) -> JurisdictionRepairResult:
    """Gives records from multi-country sources the country their own notice names.

    Records stored with ``eu``, ``europe`` or ``global`` carry no country, so their card could not
    draw an outline or print a country code. The country is read from the notice the model last
    read, the place names and the title; a record that names none stays as it is. Idempotent: a
    repaired record is no longer generic.

    Only the country is set. Geocoding the stored place name is opt-in (``geocode=True``): a bare
    name such as "Burg" matches a village in the wrong state, and a wrong marker is worse than
    none. The preview generator finds a place by its own, stricter means (title, notice pages).
    """
    db_path = initialize_database(settings)
    rows = list_competitions_with_generic_jurisdiction(db_path)
    repaired_ids: list[str] = []
    for row in rows:
        country = resolve_record_country(
            title=row["title"],
            location_labels=[row["location_label"]],
            notice_text=latest_screening_notice_text(db_path, row["id"]),
        )
        if country:
            update_competition_jurisdiction(db_path, competition_id=row["id"], jurisdiction=country)
            repaired_ids.append(row["id"])

    geocoded = 0
    if geocode and repaired_ids:
        cache_path = settings.resolve_path(settings.geocode_cache)
        geocoder = NominatimGeocoder(cache_path=cache_path)
        try:
            for row in list_competitions_missing_geocodes(
                db_path, limit=len(repaired_ids) * 4 + 50
            ):
                if row["id"] in repaired_ids and _geocode_stored_row(
                    db_path, row, cache_path=cache_path, geocoder=geocoder
                ):
                    geocoded += 1
        finally:
            geocoder.flush()
    return JurisdictionRepairResult(len(rows), len(repaired_ids), geocoded)


# -- expired-opportunity cleanup ----------------------------------------------------------------


def _load_cleanup_state(state_path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(state_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("Ignoring unreadable cleanup state %s: %s", state_path, exc)
        return {}
    return payload if isinstance(payload, dict) else {}


def _write_cleanup_state(state_path: Path, payload: dict[str, Any]) -> None:
    state_path.parent.mkdir(parents=True, exist_ok=True)
    handle, temporary_name = tempfile.mkstemp(
        dir=state_path.parent, prefix=state_path.name, suffix=".tmp"
    )
    try:
        with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temporary_file:
            temporary_file.write(json.dumps(payload, indent=2, sort_keys=True) + "\n")
        os.replace(temporary_name, state_path)
    except BaseException:
        Path(temporary_name).unlink(missing_ok=True)
        raise


def _sanitize_preview_slug(slug: str) -> str:
    """Same file-name sanitizing the preview CLI applies to an opportunity id (manifest module)."""
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", slug)[:120]


def _delete_preview_files(settings: Settings, *, competition_ids: list[str]) -> tuple[int, int]:
    """Delete removed records' ``images/{slug}-{hash10}.jpg`` from both preview locations.

    The locations are the generator output and the published copy under ``apps/web/public``.
    The hash is the generator's content hash, so every revision matches without reading anything
    out of the Web app's TypeScript. The pattern is anchored: ``road-work-<hash>.jpg`` is not a
    preview of the record ``road``. Manifest entries are left alone (the generator owns that
    file); a full generator run prunes them, and a missing image already means "placeholder".
    """
    preview_root = settings.resolve_path(settings.preview_dir) / "images"
    static_root = settings.resolve_path(Path("apps") / "web" / "public" / "previews" / "images")
    deleted_preview_files = 0
    deleted_static_preview_files = 0

    for competition_id in competition_ids:
        pattern = re.compile(
            rf"{re.escape(_sanitize_preview_slug(competition_id))}-[0-9a-f]{{10}}\.jpg"
        )
        for root, is_static in ((preview_root, False), (static_root, True)):
            if not root.is_dir():
                continue
            for path in root.iterdir():
                if path.is_file() and pattern.fullmatch(path.name):
                    path.unlink(missing_ok=True)
                    if is_static:
                        deleted_static_preview_files += 1
                    else:
                        deleted_preview_files += 1

    return deleted_preview_files, deleted_static_preview_files


def cleanup_expired_competitions(
    settings: Settings,
    *,
    retention_days: int | None = None,
    limit: int = 500,
    force: bool = False,
) -> ExpiredCompetitionCleanupResult:
    """Clean up once per calendar day: expired opportunities, old AI exclusions, old AI payloads.

    Deletes (1) opportunities whose deadline is past the retention window, (2) opportunities whose
    current AI assessment is ``exclude`` and older than the same window, unless a human moved them
    to ``shortlisted``/``verified``, and (3) blanks the stored prompts and results of AI runs older
    than ``SCREENING_RUN_PAYLOAD_RETENTION_DAYS`` while keeping their cost rows. The notice ledger
    already records excluded notices as screened, so deleting one does not cause a re-screen.

    The command owns its own once-a-day guard (state file ``expired_cleanup_state``), so callers
    such as scheduled scripts can invoke it on every batch and it stays idempotent. ``force``
    bypasses the guard. Watchlisted opportunities are never deleted (see ``delete_competitions``).
    """
    state_path = settings.resolve_path(settings.expired_cleanup_state)
    today = clock.today()
    today_iso = today.isoformat()

    if not force and _load_cleanup_state(state_path).get("last_run_date") == today_iso:
        return ExpiredCompetitionCleanupResult(
            0, 0, 0, 0, 0, already_ran_today=True, last_run_date=today_iso
        )

    db_path = initialize_database(settings)
    effective_retention_days = (
        settings.expired_competition_retention_days if retention_days is None else retention_days
    )
    threshold = today - timedelta(days=max(effective_retention_days, 0))
    expired_ids = list_expired_competition_ids(db_path, expired_before=threshold, limit=limit)

    deleted_competitions = deleted_preview_files = deleted_static_preview_files = 0
    if expired_ids:
        deleted_competitions = delete_competitions(db_path, competition_ids=expired_ids)
        deleted_preview_files, deleted_static_preview_files = _delete_preview_files(
            settings, competition_ids=expired_ids
        )

    # Listed after the expired pass, so a record that is both is deleted (and counted) once.
    excluded_ids = list_excluded_competition_ids(db_path, assessed_before=threshold, limit=limit)
    deleted_excluded = deleted_excluded_previews = deleted_excluded_static_previews = 0
    if excluded_ids:
        deleted_excluded = delete_competitions(db_path, competition_ids=excluded_ids)
        deleted_excluded_previews, deleted_excluded_static_previews = _delete_preview_files(
            settings, competition_ids=excluded_ids
        )
    if expired_ids or excluded_ids:
        refresh_review_queue(db_path)

    shrunk_runs = shrink_old_screening_runs(
        db_path, started_before=today - timedelta(days=SCREENING_RUN_PAYLOAD_RETENTION_DAYS)
    )

    _write_cleanup_state(
        state_path,
        {
            "last_run_date": today_iso,
            "deleted_competitions": deleted_competitions,
            "deleted_preview_files": deleted_preview_files,
            "deleted_static_preview_files": deleted_static_preview_files,
            "deleted_excluded_competitions": deleted_excluded,
            "deleted_excluded_preview_files": deleted_excluded_previews,
            "deleted_excluded_static_preview_files": deleted_excluded_static_previews,
            "shrunk_screening_runs": shrunk_runs,
            "retention_days": effective_retention_days,
        },
    )
    return ExpiredCompetitionCleanupResult(
        attempted=len(expired_ids),
        deleted_competitions=deleted_competitions,
        deleted_preview_files=deleted_preview_files,
        deleted_static_preview_files=deleted_static_preview_files,
        skipped=max(0, len(expired_ids) - deleted_competitions),
        last_run_date=today_iso,
        excluded_attempted=len(excluded_ids),
        deleted_excluded_competitions=deleted_excluded,
        deleted_excluded_preview_files=deleted_excluded_previews,
        deleted_excluded_static_preview_files=deleted_excluded_static_previews,
        shrunk_screening_runs=shrunk_runs,
    )
