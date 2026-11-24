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
from datetime import timedelta

from arch_competition_ops import clock
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.card_previews import (
    CardPreviewPrewarmResult,
    prewarm_opportunity_card_previews,
)
from arch_competition_ops.collectors import collect_source_documents
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.discovery import collect_window
from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.geocoding import NominatimGeocoder, enrich_record_geocode
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.competition import (
    compute_extraction_confidence,
    compute_qualification_score,
    configure_procedure_registry,
)
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.run_errors import error_class, log_url, provider_code
from arch_competition_ops.screening.client import ScreeningError, ScreeningPaused
from arch_competition_ops.screening.extraction import NoticeValidationError
from arch_competition_ops.screening.fingerprints import (
    screening_criteria_hash,
)
from arch_competition_ops.screening.service import DocumentAssessment, assess_documents
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    backlog,
    competition_is_stale_expired,
    dedup_key_for,
    find_duplicate_records,
    record_source_run,
)
from arch_competition_ops.storage.connection import connect
from arch_competition_ops.storage.notice_ledger import record_screened
from arch_competition_ops.storage.screening import (
    ScreeningBudgetExceeded,
    SourceDailyLimitReached,
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

    def __init__(self, source_id: str, stage: str, cause: BaseException, details: str = "") -> None:
        self.source_id = source_id
        self.stage = stage
        super().__init__(
            f"Ingest of '{source_id}' failed during {stage}: {error_class(cause)}{details}"
        )


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
    batch_paused: bool = False
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
    collect_only: bool = False,
    queued_row_ids: list[int] | None = None,
    collected_documents: list[CollectedSourceDocument] | None = None,
) -> IngestResult:
    if settings._reading_run_since is None:
        settings = settings.model_copy()
        settings._reading_run_since = clock.now_utc().isoformat()
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

    criteria_hash = screening_criteria_hash(settings) if settings.ai_enabled else None
    if queued_row_ids is None:
        collection_limit = settings.ai_candidate_cap
        start, end, cursor = backlog.collection_window(
            db_path,
            source_id,
            publication_date_from
            or (clock.today() - timedelta(days=settings.discovery_window_days - 1)).isoformat(),
            collection_limit,
            settings.discovery_window_days,
            source.collector
            in {
                "ted_search_api",
                "boamp_opendatasoft",
                "ggzy_public_notices",
                "joneps_tender_invitations",
                "contracts_finder_ocds",
                "find_a_tender_ocds",
                "oeffentlichevergabe_ocds",
            },
            criteria_hash,
        )

        def collect(items):
            if collected_documents is not None:
                return collected_documents
            return collect_source_documents(
                source,
                limit=items,
                publication_date_from=start,
                archive_dir=settings.resolve_path(settings.html_archive_dir),
            )

        try:
            discovered, pages, recovery = collect_window(
                db_path, source_id, settings, end, cursor, collect
            )
            result.notes.extend(recovery)
        except Exception as exc:
            record_run("failed", last_error=error_class(exc))
            with connect(db_path) as cx:
                _, stats = backlog.queue_stats(cx, source_id)
            raise IngestError(source_id, "collection", exc, f" ({stats})") from exc
        discovered = discovered[:collection_limit]
        result.document_count = len(discovered)
        result.already_screened, count, stats, result.skipped_expired = backlog.enqueue(
            db_path,
            source_id,
            discovered,
            criteria_hash,
            unfinished=pages.unfinished
            or (
                not pages.complete
                and len(discovered) >= collection_limit
                and source.collector != "ted_search_api"
            ),
            cap=collection_limit,
            cursor=pages.cursor,
            repeated=pages.repeated,
            end=end,
            age_days=settings.unread_max_age_days,
        )
        if pages.unfinished or len(discovered) >= collection_limit:
            stats += (
                f" discovery_limit source={source_id} pages={pages.used}"
                f" items={collection_limit} resume_from={start}"
            )
        if end and end < clock.today().isoformat():
            stats += f" discovery_window_through={end} backfill_pending=1"
        result.notes.append(stats)
        if collect_only or not settings.ai_enabled:
            result.deferred = count
            result.status = "success" if discovered or count else "empty"
            record_run(result.status, last_error=None)
            return result
    if queued_row_ids is not None:
        with connect(db_path) as cx:
            backlog.retire_unread(cx, source_id, settings.unread_max_age_days)
            cx.commit()
    pending = backlog.queued(db_path, source_id, limit, queued_row_ids)
    documents = [item.document for item in pending]
    if queued_row_ids is not None:
        result.document_count = len(documents)
    else:
        result.deferred = max(0, count - len(documents))

    records: list[CompetitionRecord] = []
    assessments: list[DocumentAssessment | None] = []
    # Documents whose paid assessment finished, including those then dropped as expired; they
    # enter the ledger only once the records are durably written.
    screened: list[int] = []
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
                if competition_is_stale_expired(record, retention_days=retention_days):
                    result.skipped_expired += 1
                    if assessment is not None:
                        screened.append(pending[position].row_id)
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
                        screened.append(pending[position].row_id)
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
            except (ScreeningBudgetExceeded, ScreeningPaused) as exc:
                # Budget deferral is not a content rejection. Keep later sources collectable.
                result.deferred += len(documents) - position
                if isinstance(exc, ScreeningPaused):
                    code = provider_code(exc)
                    retry = backlog.defer(db_path, pending[position].row_id, code, criteria_hash)
                    result.notes.append(f"deferred[{source_id}/{code}] retry_at={retry}")
                else:
                    result.notes.append(str(exc))
                result.batch_paused = not isinstance(exc, SourceDailyLimitReached)
                break
            except Exception as exc:  # noqa: BLE001 - one notice cannot interrupt independent work
                code = provider_code(exc) if isinstance(exc, ScreeningError) else error_class(exc)
                url = log_url(document.source_url)
                logger.warning("Notice %s at %s: %s", url, stage, code)
                result.failures.append(DocumentFailure(url, stage, code))
                specific = (
                    code
                    in {
                        "invalid_schema",
                        "missing_text",
                        "incomplete_response",
                        "max_tokens",
                        "refusal",
                        "http_400",
                        "http_413",
                    }
                    or isinstance(exc, NoticeValidationError)
                    or (stage in {"parse", "verify"} and isinstance(exc, ValueError | KeyError))
                )
                if specific:
                    status = backlog.record_failure(
                        db_path,
                        pending[position].row_id,
                        code,
                        criteria=criteria_hash,
                        limit=settings.ai_notice_max_attempts,
                    )
                    if status == "failed":
                        result.notes.append(f"failed[{source_id}/{code}]=1")
                else:
                    retry = backlog.defer(db_path, pending[position].row_id, code, criteria_hash)
                    result.notes.append(f"deferred[{source_id}/{code}] retry_at={retry}")
                    result.deferred += 1
                last_error = code
                continue
            records.append(record)
            assessments.append(assessment)
            if assessment is not None:
                screened.append(pending[position].row_id)
    finally:
        geocoder.flush()

    try:
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
            row_ids=screened,
        )
    except Exception as exc:
        record_run("failed", last_error=error_class(exc))
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
            result.notes.append(f"display titles failed: {error_class(exc)}")
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
        logger.warning("Review queue refresh failed: %s", error_class(exc))
        result.notes.append(f"review queue refresh failed: {error_class(exc)}")
