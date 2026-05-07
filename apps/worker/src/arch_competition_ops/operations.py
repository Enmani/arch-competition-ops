from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Callable

from arch_competition_ops.collectors import collect_source_documents
from arch_competition_ops.collectors.generic_rss import is_preannouncement_rss_notice
from arch_competition_ops.collectors.common import fetch_json_get
from arch_competition_ops.config_loader import (
    load_source_catalog,
    load_targeting_preferences,
    load_taxonomy,
)
from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers import build_competition_key
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    ensure_schema,
    find_duplicate_records,
    list_anac_status_candidates,
    list_anac_source_trace_candidates,
    list_competitions_missing_geocodes,
    list_gets_preannouncement_candidates,
    record_source_run,
    update_competition_status,
    update_competition_source_url,
    update_competition_geocode_fields,
    upsert_competition,
)
from arch_competition_ops.verifiers import VERIFIERS, verify_record


@dataclass
class CheckResult:
    ok: bool
    label: str
    detail: str | None = None


def _required_directories(settings: Settings) -> list[Path]:
    return [
        settings.resolve_path(Path("data")),
        settings.resolve_path(Path("data") / "inbox"),
        settings.resolve_path(Path("artifacts") / "html"),
        settings.resolve_path(Path("artifacts") / "pdf"),
        settings.resolve_path(Path("artifacts") / "logs"),
        settings.resolve_path(settings.browser_storage_dir),
        settings.resolve_path(Path("reports")),
    ]


def run_doctor(settings: Settings) -> list[CheckResult]:
    results: list[CheckResult] = []

    if settings.root.exists():
        results.append(CheckResult(True, "repository root", str(settings.root)))
    else:
        results.append(CheckResult(False, "repository root", str(settings.root)))

    for directory in _required_directories(settings):
        directory.mkdir(parents=True, exist_ok=True)
        results.append(CheckResult(True, "directory ready", str(directory)))

    try:
        db_path = initialize_database(settings)
        results.append(CheckResult(True, "database schema", str(db_path)))
    except Exception as exc:  # noqa: BLE001
        results.append(CheckResult(False, "database schema", str(exc)))

    for loader, label in (
        (load_source_catalog, "source catalog"),
        (load_targeting_preferences, "targeting preferences"),
        (load_taxonomy, "taxonomy"),
    ):
        try:
            payload = loader(settings)
            detail = getattr(payload, "__class__", type(payload)).__name__
            results.append(CheckResult(True, label, detail))
        except Exception as exc:  # noqa: BLE001
            results.append(CheckResult(False, label, str(exc)))

    return results


def run_verify(settings: Settings) -> list[CheckResult]:
    results = run_doctor(settings)
    db_path = settings.resolve_path(settings.db)

    try:
        sources = load_source_catalog(settings).sources
        taxonomy = load_taxonomy(settings)
        source_ids = [source.source_id for source in sources]
        duplicate_ids = sorted({source_id for source_id in source_ids if source_ids.count(source_id) > 1})
        if duplicate_ids:
            results.append(CheckResult(False, "unique source ids", ", ".join(duplicate_ids)))
        else:
            results.append(CheckResult(True, "unique source ids"))

        enabled_sources = [source for source in sources if source.enabled]
        if enabled_sources:
            results.append(CheckResult(True, "enabled sources", str(len(enabled_sources))))
        else:
            results.append(CheckResult(False, "enabled sources", "No enabled sources"))

        invalid_source_kinds = sorted(
            {
                source.kind
                for source in sources
                if source.kind not in set(taxonomy.source_kinds)
            }
        )
        invalid_source_tiers = sorted(
            {
                source.source_tier
                for source in sources
                if source.source_tier not in set(taxonomy.source_tiers)
            }
        )
        invalid_scan_methods = sorted(
            {
                source.scan_method
                for source in sources
                if source.scan_method not in set(taxonomy.scan_methods)
            }
        )
        invalid_verifiers = sorted(
            {
                source.verifier
                for source in sources
                if source.verifier and source.verifier not in VERIFIERS
            }
        )
        if invalid_source_kinds or invalid_source_tiers or invalid_scan_methods or invalid_verifiers:
            detail_parts = []
            if invalid_source_kinds:
                detail_parts.append(f"kinds={invalid_source_kinds}")
            if invalid_source_tiers:
                detail_parts.append(f"tiers={invalid_source_tiers}")
            if invalid_scan_methods:
                detail_parts.append(f"scan_methods={invalid_scan_methods}")
            if invalid_verifiers:
                detail_parts.append(f"verifiers={invalid_verifiers}")
            results.append(CheckResult(False, "source taxonomy alignment", "; ".join(detail_parts)))
        else:
            results.append(CheckResult(True, "source taxonomy alignment"))
    except Exception as exc:  # noqa: BLE001
        results.append(CheckResult(False, "source verification", str(exc)))

    try:
        taxonomy = load_taxonomy(settings)
        filters = load_targeting_preferences(settings)
        invalid_types = sorted(set(filters.competition_types) - set(taxonomy.competition_types))
        invalid_audience = sorted(set(filters.audience) - set(taxonomy.audience))
        invalid_regions = sorted(set(filters.regions) - set(taxonomy.regions))
        invalid_opportunity_types = sorted(
            set(filters.opportunity_types) - set(taxonomy.opportunity_types)
        )
        invalid_procedure_types = sorted(
            set(filters.procedure_types) - set(taxonomy.procedure_types)
        )
        invalid_evidence_levels = sorted(
            set(filters.evidence_levels) - set(taxonomy.evidence_levels)
        )

        if (
            invalid_types
            or invalid_audience
            or invalid_regions
            or invalid_opportunity_types
            or invalid_procedure_types
            or invalid_evidence_levels
        ):
            detail_parts = []
            if invalid_types:
                detail_parts.append(f"competition_types={invalid_types}")
            if invalid_audience:
                detail_parts.append(f"audience={invalid_audience}")
            if invalid_regions:
                detail_parts.append(f"regions={invalid_regions}")
            if invalid_opportunity_types:
                detail_parts.append(f"opportunity_types={invalid_opportunity_types}")
            if invalid_procedure_types:
                detail_parts.append(f"procedure_types={invalid_procedure_types}")
            if invalid_evidence_levels:
                detail_parts.append(f"evidence_levels={invalid_evidence_levels}")
            results.append(CheckResult(False, "filters within taxonomy", "; ".join(detail_parts)))
        else:
            results.append(CheckResult(True, "filters within taxonomy"))
    except Exception as exc:  # noqa: BLE001
        results.append(CheckResult(False, "taxonomy verification", str(exc)))

    duplicates = find_duplicate_records(db_path)
    if duplicates:
        detail = ", ".join(row["dedup_key"] for row in duplicates)
        results.append(CheckResult(False, "database duplicates", detail))
    else:
        results.append(CheckResult(True, "database duplicates"))

    try:
        queue_candidates = refresh_review_queue(db_path)
        results.append(
            CheckResult(True, "ops review queue", f"{len(queue_candidates)} active worker candidates")
        )
    except Exception as exc:  # noqa: BLE001
        results.append(CheckResult(False, "ops review queue", str(exc)))

    return results


def initialize_database(settings: Settings) -> Path:
    db_path = settings.resolve_path(settings.db)
    ensure_schema(db_path)
    return db_path


def seed_demo_records(settings: Settings) -> list[str]:
    db_path = initialize_database(settings)
    seeded_ids: list[str] = []

    demo_records = [
        CompetitionRecord(
            title="Civic Library and Public Square Design Contest",
            organizer="Municipality Procurement Office",
            authority_name="Comune Demo Nord",
            official_url="https://ted.europa.eu/",
            source_url="https://ted.europa.eu/",
            status="verified",
            opportunity_type="public_design_contest",
            jurisdiction="eu",
            procedure_type="design_contest",
            official_notice_id="DEMO-TED-2026-0001",
            regions=["europe", "italy"],
            languages=["en", "it"],
            competition_types=["architecture", "public_building", "urban_design"],
            audience=["professionals", "multidisciplinary"],
            cpv_codes=["71230000"],
            implementation_path="winner_or_winners_progress_to_negotiated_service_award",
            licensed_architect_required=True,
            local_partner_required=False,
            registration_fee_eur=0.0,
            submission_fee_eur=0.0,
            estimated_contract_value_eur=1850000.0,
            prize_summary="Service continuation path after jury decision plus honorarium for finalists.",
            deadline_at=date(2026, 6, 30),
            eligibility_summary=(
                "Lead consultant must hold architect registration or equivalent professional standing."
            ),
            brief_pdf_url="https://ted.europa.eu/",
            extraction_confidence=0.95,
            evidence_level="official_notice",
            qualification_score=0.94,
            evidence_note="Demo record from an official notice.",
            last_verified_at=datetime.now(timezone.utc),
        ),
        CompetitionRecord(
            title="Regional Hospital Campus Expansion Design Services",
            organizer="Regional Health Infrastructure Agency",
            authority_name="Azienda Regionale Infrastrutture Sanitarie",
            official_url="https://www.boamp.fr/",
            source_url="https://www.boamp.fr/",
            status="shortlisted",
            opportunity_type="public_design_services_procurement",
            jurisdiction="france",
            procedure_type="maitrise_d_oeuvre_procurement",
            official_notice_id="DEMO-BOAMP-2026-0042",
            regions=["europe"],
            languages=["fr", "en"],
            competition_types=["architecture", "healthcare", "masterplan"],
            audience=["professionals", "multidisciplinary"],
            cpv_codes=["71240000", "71221000"],
            implementation_path="service_contract_award_after_competitive_selection",
            licensed_architect_required=True,
            local_partner_required=True,
            registration_fee_eur=0.0,
            submission_fee_eur=0.0,
            estimated_contract_value_eur=4200000.0,
            prize_summary="No prize. Downstream value comes from awarded service contract.",
            deadline_at=date(2026, 7, 15),
            eligibility_summary=(
                "Lead architect qualification required, hospital references requested, local engineering "
                "and permitting partner likely needed."
            ),
            extraction_confidence=0.82,
            evidence_level="official_listing",
            qualification_score=0.88,
            evidence_note="Demo record. Local teaming requirements need confirmation.",
        ),
    ]

    for record in demo_records:
        seeded_ids.append(upsert_competition(db_path, record))

    refresh_review_queue(db_path)

    return seeded_ids


def rebuild_review_queue(settings: Settings) -> list[dict[str, object | None]]:
    db_path = initialize_database(settings)
    return refresh_review_queue(db_path)


def refresh_missing_geocodes(settings: Settings, *, limit: int = 50) -> int:
    db_path = initialize_database(settings)
    geocoder = NominatimGeocoder(
        cache_path=settings.resolve_path(settings.geocode_cache),
    )
    updated_count = 0
    scan_limit = max(limit * 6, limit)

    for row in list_competitions_missing_geocodes(db_path, limit=scan_limit):
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
        enriched = enrich_record_geocode(
            record,
            cache_path=settings.resolve_path(settings.geocode_cache),
            geocoder=geocoder,
        )
        if (
            enriched.location_label == row["location_label"]
            and enriched.geo_lat == row["geo_lat"]
            and enriched.geo_lng == row["geo_lng"]
            and enriched.geo_source == row["geo_source"]
            and enriched.geo_confidence == row["geo_confidence"]
        ):
            continue

        update_competition_geocode_fields(
            db_path,
            competition_id=row["id"],
            location_label=enriched.location_label,
            geo_lat=enriched.geo_lat,
            geo_lng=enriched.geo_lng,
            geo_source=enriched.geo_source,
            geo_confidence=enriched.geo_confidence,
        )
        updated_count += 1
        if updated_count >= limit:
            break

    return updated_count


def _normalize_anac_source_trace_url(
    *,
    official_notice_id: str | None,
    source_url: str | None,
    title: str | None,
    notice_detail: dict[str, Any] | None = None,
) -> str | None:
    if not official_notice_id:
        return None

    normalized_notice_id = official_notice_id.strip()
    if not normalized_notice_id:
        return None

    normalized_source_url = (source_url or "").strip().lower()
    normalized_title = (title or "").strip().lower()
    codice_scheda = str((notice_detail or {}).get("codiceScheda") or "").strip().lower()
    tipo = str((notice_detail or {}).get("tipo") or "").strip().lower()
    is_esiti = False

    if codice_scheda.startswith("ad"):
        is_esiti = True
    elif tipo == "esito":
        is_esiti = True
    elif "/esiti/" in normalized_source_url:
        is_esiti = True
    elif "affidamento diretto" in normalized_title:
        is_esiti = True

    route = "esiti" if is_esiti else "bandi"
    return (
        f"https://pubblicitalegale.anticorruzione.it/{route}/"
        f"{normalized_notice_id}?ricercaArchivio=true"
    )


def _resolve_anac_record_status(
    *,
    procedure_type: str | None,
    source_url: str | None,
    title: str | None,
    notice_detail: dict[str, Any] | None = None,
) -> str:
    normalized_procedure_type = (procedure_type or "").strip().lower()
    normalized_source_url = (source_url or "").strip().lower()
    normalized_title = (title or "").strip().lower()
    codice_scheda = str((notice_detail or {}).get("codiceScheda") or "").strip().lower()
    tipo = str((notice_detail or {}).get("tipo") or "").strip().lower()
    source_kind = str((notice_detail or {}).get("sourceKind") or "").strip().lower()

    if codice_scheda.startswith("ad"):
        return "archived"
    if normalized_procedure_type.startswith("ad"):
        return "archived"
    if tipo == "esito":
        return "archived"
    if source_kind in {"aggiudicazione", "esito", "archived", "completed"}:
        return "archived"
    if "/esiti/" in normalized_source_url:
        return "archived"
    if "aggiudicazione" in normalized_title or "affidamento diretto" in normalized_title:
        return "archived"
    return "discovered"


def _fetch_anac_notice_detail(official_notice_id: str) -> dict[str, Any] | None:
    try:
        payload = fetch_json_get(
            f"https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/{official_notice_id}",
            headers={
                "Accept": "application/json",
                "Referer": "https://pubblicitalegale.anticorruzione.it/",
            },
        )
    except Exception:  # noqa: BLE001
        return None

    return payload if isinstance(payload, dict) else None


def normalize_anac_source_traces(
    settings: Settings,
    *,
    limit: int = 500,
    fetch_notice_detail: Callable[[str], dict[str, Any] | None] | None = None,
) -> int:
    db_path = initialize_database(settings)
    updated_count = 0
    fetcher = fetch_notice_detail or _fetch_anac_notice_detail

    for row in list_anac_source_trace_candidates(db_path, limit=limit):
        notice_detail = fetcher(row["official_notice_id"])
        normalized_url = _normalize_anac_source_trace_url(
            official_notice_id=row["official_notice_id"],
            source_url=row["source_url"],
            title=row["title"],
            notice_detail=notice_detail,
        )
        if not normalized_url or normalized_url == row["source_url"]:
            continue

        update_competition_source_url(
            db_path,
            competition_id=row["id"],
            source_url=normalized_url,
        )
        updated_count += 1

    return updated_count


def normalize_anac_record_statuses(
    settings: Settings,
    *,
    limit: int = 500,
    fetch_notice_detail: Callable[[str], dict[str, Any] | None] | None = None,
) -> int:
    db_path = initialize_database(settings)
    updated_count = 0
    fetcher = fetch_notice_detail or _fetch_anac_notice_detail

    for row in list_anac_status_candidates(db_path, limit=limit):
        notice_detail = fetcher(row["official_notice_id"])
        normalized_url = _normalize_anac_source_trace_url(
            official_notice_id=row["official_notice_id"],
            source_url=row["source_url"],
            title=row["title"],
            notice_detail=notice_detail,
        )
        status = _resolve_anac_record_status(
            procedure_type=str((notice_detail or {}).get("codiceScheda") or ""),
            source_url=normalized_url or row["source_url"],
            title=row["title"],
            notice_detail=notice_detail,
        )
        if status != "archived":
            continue
        if row["status"] == status:
            continue

        update_competition_status(
            db_path,
            competition_id=row["id"],
            status=status,
        )
        updated_count += 1

    return updated_count


def _is_gets_preannouncement_record(
    *,
    title: str | None,
    authority_name: str | None,
    eligibility_summary: str | None,
    source_url: str | None,
) -> bool:
    categories: list[str] = []
    if authority_name and "historic" in authority_name.lower():
        categories.append("historic")
    if source_url and "historic" in source_url.lower():
        categories.append("historic")
    return is_preannouncement_rss_notice(
        title or "",
        eligibility_summary or "",
        categories,
    )


def normalize_gets_preannouncement_statuses(
    settings: Settings,
    *,
    limit: int = 500,
) -> int:
    db_path = initialize_database(settings)
    updated_count = 0

    for row in list_gets_preannouncement_candidates(db_path, limit=limit):
        if not _is_gets_preannouncement_record(
            title=row["title"],
            authority_name=row["authority_name"],
            eligibility_summary=row["eligibility_summary"],
            source_url=row["source_url"],
        ):
            continue
        if row["status"] == "discarded":
            continue

        update_competition_status(
            db_path,
            competition_id=row["id"],
            status="discarded",
        )
        updated_count += 1

    return updated_count


def ingest_source(
    settings: Settings,
    *,
    source_id: str,
    limit: int = 20,
    publication_date_from: str | None = None,
) -> list[str]:
    def summarize_duplicate_pressure(dedup_keys: list[str]) -> tuple[int, int]:
        if not dedup_keys:
            return 0, 0
        batch_sizes = Counter(dedup_keys)
        persisted_sizes = {
            row["dedup_key"]: row["duplicate_count"] for row in find_duplicate_records(db_path)
        }
        duplicate_sizes = [
            max(batch_sizes[dedup_key], persisted_sizes.get(dedup_key, 0))
            for dedup_key in batch_sizes
            if batch_sizes[dedup_key] > 1 or persisted_sizes.get(dedup_key, 0) > 1
        ]
        if not duplicate_sizes:
            return 0, 0
        return len(duplicate_sizes), max(duplicate_sizes)

    source_catalog = load_source_catalog(settings)
    source = next((candidate for candidate in source_catalog.sources if candidate.source_id == source_id), None)
    if source is None:
        raise ValueError(f"Unknown source id: {source_id}")

    db_path = initialize_database(settings)
    geocoder = NominatimGeocoder(
        cache_path=settings.resolve_path(settings.geocode_cache),
    )
    started_at = datetime.now(timezone.utc).isoformat()
    ingested_ids: list[str] = []
    dedup_keys: list[str] = []
    document_count = 0
    parse_failure_count = 0
    last_error: str | None = None

    try:
        documents = collect_source_documents(
            source,
            limit=limit,
            publication_date_from=publication_date_from,
        )
        document_count = len(documents)

        for document in documents:
            try:
                record = parse_source_payload(
                    source,
                    document.payload,
                    source_url=document.source_url,
                )
                record = verify_record(
                    source=source,
                    payload=document.payload,
                    source_url=document.source_url,
                    record=record,
                )
                record = enrich_record_geocode(
                    record,
                    cache_path=settings.resolve_path(settings.geocode_cache),
                    geocoder=geocoder,
                )
            except Exception as exc:  # noqa: BLE001
                parse_failure_count += 1
                last_error = str(exc)
                continue

            dedup_keys.append(
                build_competition_key(
                    record.title,
                    record.organizer,
                    record.canonical_deadline(),
                )
            )
            ingested_ids.append(upsert_competition(db_path, record))
    except Exception as exc:  # noqa: BLE001
        completed_at = datetime.now(timezone.utc).isoformat()
        record_source_run(
            db_path,
            source_id=source.source_id,
            source_name=source.name,
            source_kind=source.kind,
            source_tier=source.source_tier,
            status="failed",
            started_at=started_at,
            completed_at=completed_at,
            document_count=document_count,
            upserted_count=len(ingested_ids),
            parse_failure_count=parse_failure_count,
            duplicate_group_count=0,
            max_duplicate_group_size=0,
            last_error=str(exc),
        )
        refresh_review_queue(db_path)
        raise

    duplicate_group_count, max_duplicate_group_size = summarize_duplicate_pressure(dedup_keys)
    if document_count == 0:
        status = "empty"
    elif parse_failure_count > 0 and ingested_ids:
        status = "completed_with_failures"
    elif parse_failure_count > 0:
        status = "failed"
    else:
        status = "success"

    record_source_run(
        db_path,
        source_id=source.source_id,
        source_name=source.name,
        source_kind=source.kind,
        source_tier=source.source_tier,
        status=status,
        started_at=started_at,
        completed_at=datetime.now(timezone.utc).isoformat(),
        document_count=document_count,
        upserted_count=len(ingested_ids),
        parse_failure_count=parse_failure_count,
        duplicate_group_count=duplicate_group_count,
        max_duplicate_group_size=max_duplicate_group_size,
        last_error=last_error,
    )
    refresh_review_queue(db_path)

    if parse_failure_count > 0:
        raise ValueError(
            f"Source {source.source_id} completed with {parse_failure_count} parse failures"
        )

    return ingested_ids
