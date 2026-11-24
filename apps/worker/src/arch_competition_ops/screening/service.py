"""Advisory screening; facts and human decisions are never overwritten."""

from __future__ import annotations

import json
import re
import threading
from collections.abc import Callable, Sequence
from concurrent.futures import ThreadPoolExecutor
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from openai import OpenAI

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.http import HttpError
from arch_competition_ops.locking import LockHeldError, exclusive_lock
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.screening.catalog import ScreeningModel
from arch_competition_ops.screening.client import (
    ScreeningError,
    ScreeningPaused,
)
from arch_competition_ops.screening.extraction import extract_record
from arch_competition_ops.screening.inputs import (
    enrich_notice_payload,
    prepare_input,
)
from arch_competition_ops.screening.models import ScreeningDecision, validate_evidence
from arch_competition_ops.screening.providers import (
    create_screening_client as create_client,
)
from arch_competition_ops.screening.providers import (
    read_notice,
    screening_model,
)
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.screening import (
    ScreeningBudgetExceeded,
    find_cached_screening,
    finish_screening,
    load_screening_candidates,
    publish_screening,
    reserve_screening,
)


@dataclass
class ScreeningBatchResult:
    model: str
    attempted: int = 0
    completed: int = 0
    cached: int = 0
    planned: int = 0
    cost_usd: float = 0
    errors: list[str] = field(default_factory=list)
    results: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _request_one(
    client: OpenAI,
    settings: Settings,
    db_path: Path,
    model: ScreeningModel,
    row: dict[str, Any],
    input_json: str,
    evidence_fields: dict[str, str],
    limitations: list[str],
    *,
    sleep: Callable[[float], None] | None = None,
) -> tuple[ScreeningDecision, float, str]:
    # A UTF-8 byte is a conservative input-token bound, with headroom for schema/framing.
    reserve = model.cost(len(input_json.encode("utf-8")) + 4096, settings.ai_max_output_tokens)
    request_id = reserve_screening(
        db_path,
        competition_id=row.get("id"),
        source_url=row["source_url"],
        model=model.id,
        input_json=input_json,
        reserve_usd=reserve,
        budget_usd=settings.ai_monthly_budget_usd,
        daily_budget_usd=settings.ai_daily_budget_usd,
    )
    response = read_notice(
        client, settings.ai_provider, json.loads(input_json)["request"], sleep=sleep
    )
    cost = None
    if response.rejected:
        cost = 0
    elif response.input_tokens is not None and response.output_tokens is not None:
        cost = model.cost(response.input_tokens, response.output_tokens)
    accounting = dict(
        response_id=response.response_id,
        input_tokens=response.input_tokens,
        output_tokens=response.output_tokens,
        cost_usd=cost,
    )
    if response.error_class:
        finish_screening(
            db_path,
            request_id,
            status="uncertain"
            if response.error_class in {"api_error", "transport_error"}
            else "failed",
            error_code=response.error_class,
            **accounting,
        )
        error = ScreeningPaused if response.pause else ScreeningError
        raise error(response.error_class, cost_usd=reserve if cost is None else cost)
    decision = response.decision
    validate_evidence(decision, evidence_fields)
    decision.missing_information.extend(limitations)
    finish_screening(
        db_path,
        request_id,
        status="completed",
        result_json=decision.model_dump_json(),
        **accounting,
    )
    cost = accounting["cost_usd"] if accounting["cost_usd"] is not None else reserve
    return decision, cost, request_id


@dataclass
class DocumentAssessment:
    record: CompetitionRecord
    decision: ScreeningDecision
    request_id: str
    model: str
    cached: bool
    cost_usd: float


def source_lock_path(db_path: Path, source_id: str | None) -> Path:
    """The per-source AI lock: one paid pass per source at a time, across processes."""
    key = re.sub(r"[^a-zA-Z0-9_-]", "_", source_id or "unknown")[:100]
    return db_path.with_suffix(f".ai-{key}.lock")


def assess_document(
    settings: Settings,
    *,
    source: SourceDefinition,
    source_url: str,
    payload: str,
    client: OpenAI | None = None,
    force: bool = False,
    source_lock: bool = True,
    sleep: Callable[[float], None] | None = None,
) -> DocumentAssessment:
    """AI-first entry: no source-specific parser or keyword gate is needed for a notice.

    ``source_lock=False`` is for a caller that already holds the source lock for a whole pass
    (``assess_documents``): the file lock is per process and non-blocking, so taking it again in
    every worker thread would make all but one thread fail.
    """
    model = screening_model(settings, settings.ai_model)
    db_path = initialize_database(settings)
    row = {
        "source_url": source_url,
        "source_name": source.name,
        "jurisdiction": source.jurisdiction,
        "source_tier": source.source_tier,
        "source_id": source.source_id,
    }
    payload = enrich_notice_payload(payload, source_url, settings)
    with (
        exclusive_lock(
            source_lock_path(db_path, source.source_id), label="AI extraction and screening"
        )
        if source_lock
        else nullcontext()
    ):
        input_json, fields, limitations = prepare_input(
            row,
            settings,
            source_payload=payload,
            fetch_source=False,
        )
        cached = find_cached_screening(db_path, source_url, model.id, input_json)
        if cached and not force:
            decision = ScreeningDecision.model_validate_json(cached["result_json"])
            cost, request_id = 0, cached["id"]
        else:
            with nullcontext(client) if client is not None else create_client(settings) as api:
                decision, cost, request_id = _request_one(
                    api,
                    settings,
                    db_path,
                    model,
                    row,
                    input_json,
                    fields,
                    limitations,
                    sleep=sleep,
                )
        record, _warnings = extract_record(
            decision,
            fields,
            source=source,
            source_url=source_url,
            settings=settings,
        )
        record.source_url_is_notice = source.collector == "generic_notice_pages"
        return DocumentAssessment(
            record, decision, request_id, model.id, bool(cached and not force), cost
        )


@dataclass
class AssessmentOutcome:
    """One notice's result from ``assess_documents``: an assessment or the error that ended it."""

    assessment: DocumentAssessment | None = None
    error: Exception | None = None


def assess_documents(
    settings: Settings,
    *,
    source: SourceDefinition,
    documents: Sequence[tuple[str, str]],
) -> list[AssessmentOutcome]:
    """Assess ``(source_url, payload)`` notices on ``settings.ai_concurrency`` threads.

    Outcomes come back in input order. The source lock is taken once for the whole pass instead
    of once per notice. Reservations stay safe under threads: ``reserve_screening`` checks the
    spent total and inserts its reservation in one ``BEGIN IMMEDIATE`` transaction.

    The first ``ScreeningBudgetExceeded`` stops the pass: notices not yet started return that same
    error without a request, and the caller treats the first error in input order as the stop
    point. A notice that finished after that point is not consumed; its paid result is stored in
    ``ai_screening_runs`` under its exact input, so the next run reuses it at no cost. Any other
    exception ends only its own notice.
    """
    if not documents:
        return []
    stop = threading.Event()
    budget_errors: list[Exception] = []

    def work(item: tuple[str, str]) -> AssessmentOutcome:
        if stop.is_set():
            return AssessmentOutcome(
                error=budget_errors[0] if budget_errors else RuntimeError("assessment cancelled")
            )
        try:
            return AssessmentOutcome(
                assessment=assess_document(
                    settings,
                    source=source,
                    source_url=item[0],
                    payload=item[1],
                    source_lock=False,
                )
            )
        except (ScreeningPaused, ScreeningBudgetExceeded) as exc:
            budget_errors.append(exc)  # before the event, which workers check first
            stop.set()
            return AssessmentOutcome(error=exc)
        except Exception as exc:  # noqa: BLE001 - one bad notice must not sink the pass
            return AssessmentOutcome(error=exc)

    db_path = initialize_database(settings)
    try:
        with (
            exclusive_lock(
                source_lock_path(db_path, source.source_id), label="AI extraction and screening"
            ),
            ThreadPoolExecutor(max_workers=settings.ai_concurrency) as pool,
        ):
            try:
                return list(pool.map(work, documents))
            finally:
                stop.set()  # an interrupt must not wait for the queued notices
    except LockHeldError as exc:
        return [AssessmentOutcome(error=exc) for _ in documents]


def screen_competitions(
    settings: Settings,
    *,
    limit: int = 20,
    competition_ids: list[str] | None = None,
    model_id: str | None = None,
    force: bool = False,
    dry_run: bool = False,
    source_payloads: dict[str, str] | None = None,
    fetch_source: bool = True,
    client: OpenAI | None = None,
) -> ScreeningBatchResult:
    if not 1 <= limit <= 500:
        raise ValueError("AI screening limit must be between 1 and 500")
    model = screening_model(settings, model_id or settings.ai_model)
    db_path = initialize_database(settings)
    result = ScreeningBatchResult(model=model.id)
    # Same database => same OS lock, even when workers use different roots/checkouts.
    with exclusive_lock(db_path.with_suffix(".ai.lock"), label="AI screening"):
        rows = load_screening_candidates(db_path, limit=limit, competition_ids=competition_ids)
        if dry_run:
            result.planned = len(rows)
            result.results = [{"competition_id": row["id"], "title": row["title"]} for row in rows]
            return result
        if not rows:
            return result
        with nullcontext(client) if client is not None else create_client(settings) as api:
            for row in rows:
                result.attempted += 1
                try:
                    input_json, fields, limitations = prepare_input(
                        row,
                        settings,
                        model_id=model.id,
                        source_payload=(source_payloads or {}).get(row["id"]),
                        fetch_source=fetch_source,
                    )
                    with exclusive_lock(
                        source_lock_path(db_path, row.get("source_id")),
                        label="AI screening source",
                    ):
                        cached = find_cached_screening(
                            db_path, row["source_url"], model.id, input_json
                        )
                        if cached and not force:
                            decision = ScreeningDecision.model_validate_json(cached["result_json"])
                            request_id = cached["id"]
                            result.cached += 1
                        else:
                            decision, cost, request_id = _request_one(
                                api,
                                settings,
                                db_path,
                                model,
                                row,
                                input_json,
                                fields,
                                limitations,
                            )
                            result.cost_usd += cost
                            result.completed += 1
                    publish_screening(
                        db_path,
                        competition_id=row["id"],
                        request_id=request_id,
                        model=model.id,
                        decision=decision.decision,
                        relevance_score=decision.relevance_score,
                        result_json=decision.model_dump_json(),
                        source_updated_at=row["updated_at"],
                    )
                    result.results.append(
                        {
                            "competition_id": row["id"],
                            "title": row["title"],
                            "cached": bool(cached and not force),
                            **decision.model_dump(),
                        }
                    )
                except HttpError as exc:
                    result.errors.append(f"{row['id']}: source HTTP {exc.status_code}")
                    continue
                except (ScreeningError, ScreeningBudgetExceeded) as exc:
                    if isinstance(exc, ScreeningError):
                        result.cost_usd += exc.cost_usd
                    result.errors.append(f"{row['id']}: {exc}")
                    # Stop on account, transport, output and budget errors. No paid retry loop.
                    break
    return result
