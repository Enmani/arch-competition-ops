"""Ingest pipeline: collect -> parse -> verify -> filter -> geocode -> store, for one source.

Failure model
-------------
* Unknown or disabled source: ``SourceNotFoundError`` / ``SourceDisabledError`` before anything
  is touched.
* The collector (network) fails, or the final write fails: a ``failed`` source run is recorded,
  then ``IngestError`` is raised with the original exception as ``__cause__``. Nothing is stored
  for a failed write, because all records are written in a single transaction.
* An individual document cannot be parsed/verified/geocoded: it is skipped, recorded in
  ``IngestResult.failures`` with its URL and stage, and the rest are still stored. After records
  are stored the function returns normally; callers decide what to do with ``result.failures``.
"""

from __future__ import annotations

import logging
from collections import Counter
from dataclasses import dataclass, field

from arch_competition_ops import clock
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.card_previews import (
    CardPreviewPrewarmResult,
    prewarm_opportunity_card_previews,
)
from arch_competition_ops.collectors import collect_source_documents
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.competition import (
    compute_extraction_confidence,
    compute_qualification_score,
    configure_procedure_registry,
)
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.screening.fingerprints import (
    notice_content_hash,
    screening_criteria_hash,
)
from arch_competition_ops.screening.service import DocumentAssessment, assess_documents
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    competition_is_stale_expired,
    dedup_key_for,
    find_duplicate_records,
    record_source_run,
    upsert_competitions,
)
from arch_competition_ops.storage.notice_ledger import find_screened, record_screened
from arch_competition_ops.storage.screening import (
    ScreeningBudgetExceeded,
    upsert_screened_competitions,
)
from arch_competition_ops.titles.rewrite import BATCH_SIZE as TITLE_BATCH_SIZE
from arch_competition_ops.titles.service import polish_titles
from arch_competition_ops.verifiers import verify_record

logger = logging.getLogger(__name__)


class SourceNotFoundError(ValueError):
    """The requested source id is not in the catalog."""


class SourceDisabledError(ValueError):
    """The requested source exists but is disabled (``enabled: false``)."""


class IngestError(RuntimeError):
    """The run failed as a whole (collector or database write); ``__cause__`` has the detail."""

    def __init__(self, source_id: str, stage: str, cause: BaseException) -> None:
        self.source_id = source_id
        self.stage = stage
        super().__init__(f"Ingest of '{source_id}' failed during {stage}: {cause}")


@dataclass(frozen=True)
class DocumentFailure:
    source_url: str
    stage: str
    error: str


@dataclass
class IngestResult:
    source_id: str
    status: str
    document_count: int = 0
    ingested_ids: list[str] = field(default_factory=list)
    skipped_expired: int = 0
    filtered_out: int = 0
    failures: list[DocumentFailure] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    preview: CardPreviewPrewarmResult | None = None
    deferred: int = 0
    # Listed notices skipped because the same content was already screened under the same
    # criteria (see storage/notice_ledger.py).
    already_screened: int = 0

    @property
    def parse_failure_count(self) -> int:
        return len(self.failures)

    @property
    def has_failures(self) -> bool:
        return bool(self.failures)


def _find_enabled_source(settings: Settings, source_id: str) -> SourceDefinition:
    catalog = load_source_catalog(settings)
    source = next((item for item in catalog.sources if item.source_id == source_id), None)
    if source is None:
        raise SourceNotFoundError(f"Unknown source id: {source_id}")
    if not source.enabled:
        raise SourceDisabledError(
            f"Source '{source_id}' is disabled (enabled: false) and cannot be ingested"
        )
    return source


def _summarize_duplicate_pressure(db_path, dedup_keys: list[str]) -> tuple[int, int]:
    if not dedup_keys:
        return 0, 0
    batch_sizes = Counter(dedup_keys)
    persisted_sizes = {
        row["dedup_key"]: row["duplicate_count"] for row in find_duplicate_records(db_path)
    }
    duplicate_sizes = [
        max(batch_sizes[key], persisted_sizes.get(key, 0))
        for key in batch_sizes
        if batch_sizes[key] > 1 or persisted_sizes.get(key, 0) > 1
    ]
    if not duplicate_sizes:
        return 0, 0
    return len(duplicate_sizes), max(duplicate_sizes)


def _run_status(*, document_count: int, ingested: int, failures: int) -> str:
    if document_count == 0:
        return "empty"
    if failures and ingested:
        return "completed_with_failures"
    if failures:
        return "failed"
    return "success"


def ingest_source(
    settings: Settings,
    *,
    source_id: str,
    limit: int = 20,
    publication_date_from: str | None = None,
    collected_documents: list[CollectedSourceDocument] | None = None,
) -> IngestResult:
    configure_procedure_registry(settings.root)
    source = _find_enabled_source(settings, source_id)
    db_path = initialize_database(settings)
    retention_days = settings.expired_competition_retention_days
    geocoder = NominatimGeocoder(cache_path=settings.resolve_path(settings.geocode_cache))
    started_at = clock.now_utc().isoformat()
    result = IngestResult(source_id=source.source_id, status="failed")

    def record_run(status: str, *, last_error: str | None, duplicates: tuple[int, int] = (0, 0)):
        record_source_run(
            db_path,
            source_id=source.source_id,
            source_name=source.name,
            source_kind=source.kind,
            source_tier=source.source_tier,
            status=status,
            started_at=started_at,
            completed_at=clock.now_utc().isoformat(),
            document_count=result.document_count,
            upserted_count=len(result.ingested_ids),
            parse_failure_count=result.parse_failure_count,
            duplicate_group_count=duplicates[0],
            max_duplicate_group_size=duplicates[1],
            last_error=last_error,
        )
        _refresh_queue(db_path, result)

    try:
        documents = (
            collected_documents
            if collected_documents is not None
            else collect_source_documents(
                source,
                limit=settings.ai_candidate_cap,
                publication_date_from=publication_date_from,
                archive_dir=settings.resolve_path(settings.html_archive_dir),
                include_unclassified=settings.ai_enabled,
            )
        )
    except Exception as exc:
        record_run("failed", last_error=str(exc))
        raise IngestError(source.source_id, "collection", exc) from exc
    result.document_count = len(documents)
    content_hashes: dict[int, str] = {}
    criteria_hash = ""
    if settings.ai_enabled:
        criteria_hash = screening_criteria_hash(settings)
        content_hashes = {id(d): notice_content_hash(d.payload, d.source_url) for d in documents}
        seen = find_screened(
            db_path,
            source_id=source.source_id,
            criteria_hash=criteria_hash,
            content_hashes=content_hashes.values(),
        )
        fresh = [d for d in documents if content_hashes[id(d)] not in seen]
        # The same listing can appear twice in one window (pages shifting during paging).
        fresh = list({content_hashes[id(d)]: d for d in reversed(fresh)}.values())[::-1]
        result.already_screened = len(documents) - len(fresh)
        documents = fresh
        if result.already_screened:
            result.notes.append(
                f"Already screened with unchanged content and criteria: {result.already_screened}"
            )

    def ledger_entries(items: list[CollectedSourceDocument]) -> list[tuple[str, str]]:
        return [(content_hashes[id(d)], d.source_url) for d in items]

    result.deferred += max(0, len(documents) - limit)
    documents = documents[:limit]
    records: list[CompetitionRecord] = []
    assessments: list[DocumentAssessment | None] = []
    # Documents whose paid assessment finished, including those then dropped as expired; they
    # enter the ledger only once the records are durably written.
    screened: list[CollectedSourceDocument] = []
    last_error: str | None = None
    # The paid assessments run first, concurrently and in input order; everything after them
    # (parse, verify, geocode, store) stays sequential. Geocoding is paced at one request a second.
    outcomes = (
        assess_documents(
            settings,
            source=source,
            documents=[(d.source_url, d.payload) for d in documents],
        )
        if settings.ai_enabled
        else []
    )
    try:
        for position, document in enumerate(documents):
            stage = "parse"
            try:
                assessment = None
                if settings.ai_enabled:
                    stage = "ai_extract_and_screen"
                    outcome = outcomes[position]
                    if outcome.error is not None:
                        raise outcome.error
                    assessment = outcome.assessment
                    record = assessment.record
                    # Retain stable upstream identity when the source adapter provides it.
                    try:
                        parsed = parse_source_payload(
                            source,
                            document.payload,
                            source_url=document.source_url,
                        )
                        if parsed.official_notice_id:
                            record.official_notice_id = parsed.official_notice_id
                        record.cpv_codes = parsed.cpv_codes
                    except (ValueError, KeyError, TypeError):
                        pass  # AI has already produced a validated record from raw source text.
                else:
                    record = parse_source_payload(
                        source,
                        document.payload,
                        source_url=document.source_url,
                    )
                if competition_is_stale_expired(record, retention_days=retention_days):
                    result.skipped_expired += 1
                    if assessment is not None:
                        screened.append(document)
                    continue
                stage = "verify"
                record = verify_record(
                    source=source,
                    payload=document.payload,
                    source_url=document.source_url,
                    record=record,
                    settings=settings,
                )
                if competition_is_stale_expired(record, retention_days=retention_days):
                    result.skipped_expired += 1
                    if assessment is not None:
                        screened.append(document)
                    continue
                # Verification can add evidence (official URL, brief), so the evidence-derived
                # scores are recomputed from the final record.
                record.extraction_confidence = compute_extraction_confidence(record)
                record.qualification_score = compute_qualification_score(record)
                stage = "geocode"
                record = enrich_record_geocode(
                    record,
                    cache_path=settings.resolve_path(settings.geocode_cache),
                    geocoder=geocoder,
                )
            except ScreeningBudgetExceeded as exc:
                # Budget deferral is not a content rejection. Keep later sources collectable.
                result.deferred += len(documents) - position
                result.notes.append(str(exc))
                break
            except Exception as exc:  # noqa: BLE001 - one bad document must not sink the run
                logger.warning("Skipping document %s at %s: %s", document.source_url, stage, exc)
                result.failures.append(DocumentFailure(document.source_url, stage, str(exc)))
                last_error = str(exc)
                continue
            records.append(record)
            assessments.append(assessment)
            if assessment is not None:
                screened.append(document)
    finally:
        geocoder.flush()

    try:
        if settings.ai_enabled:
            publications = [
                {
                    "request_id": a.request_id,
                    "model": a.model,
                    "decision": a.decision.decision,
                    "relevance_score": a.decision.relevance_score,
                    "result_json": a.decision.model_dump_json(),
                }
                for a in assessments
                if a is not None
            ]
            result.ingested_ids = upsert_screened_competitions(db_path, records, publications)
            record_screened(
                db_path,
                source_id=source.source_id,
                criteria_hash=criteria_hash,
                outcome="assessed",
                entries=ledger_entries(screened),
            )
        else:
            result.ingested_ids = upsert_competitions(db_path, records)
    except Exception as exc:
        record_run("failed", last_error=str(exc))
        raise IngestError(source.source_id, "database write", exc) from exc

    result.status = _run_status(
        document_count=result.document_count,
        ingested=len(result.ingested_ids),
        failures=result.parse_failure_count,
    )
    record_run(
        result.status,
        last_error=last_error,
        duplicates=_summarize_duplicate_pressure(db_path, [dedup_key_for(r) for r in records]),
    )

    if result.ingested_ids:
        if settings.ai_enabled:
            result.notes.append(
                f"AI {settings.ai_model}/{settings.ai_reasoning_effort}: "
                f"assessed={len(assessments)}, "
                f"cached={sum(bool(a and a.cached) for a in assessments)}, "
                f"estimated_cost_usd={sum(a.cost_usd for a in assessments if a):.6f}"
            )
        try:
            titles = polish_titles(
                settings,
                competition_ids=result.ingested_ids,
                use_ai=False,
                # Enough batches for every new record: each title is translated once.
                max_batches=max(1, -(-len(result.ingested_ids) // TITLE_BATCH_SIZE)),
            )
            result.notes.extend(f"display titles: {error}" for error in titles.errors)
        except Exception as exc:  # noqa: BLE001  derived metadata: never fail the ingest
            result.notes.append(f"display titles failed: {exc}")
        result.preview = prewarm_opportunity_card_previews(
            settings, competition_ids=result.ingested_ids
        )
        if result.preview.status != "ok":
            result.notes.append(f"card previews {result.preview.status}: {result.preview.detail}")
    return result


def _refresh_queue(db_path, result: IngestResult) -> None:
    """Review-queue refresh is derived data: a failure is reported, not allowed to fail the run."""
    try:
        refresh_review_queue(db_path)
    except Exception as exc:  # noqa: BLE001 - derived data; never fails an ingest
        logger.warning("Review queue refresh failed: %s", exc)
        result.notes.append(f"review queue refresh failed: {exc}")
