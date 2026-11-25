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

from anthropic import Anthropic
from openai import OpenAI
from pydantic import ValidationError

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.http import HttpError
from arch_competition_ops.locking import LockHeldError, exclusive_lock
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.run_errors import provider_code
from arch_competition_ops.screening.client import (
    ScreeningError,
    ScreeningPaused,
    billable_attempt_limit,
)
from arch_competition_ops.screening.extraction import NoticeValidationError, extract_record
from arch_competition_ops.screening.inputs import (
    enrich_notice_payload,
    prepare_input,
)
from arch_competition_ops.screening.models import (
    ScreeningDecision,
    canonical_json,
    validate_evidence,
)
from arch_competition_ops.screening.providers import (
    create_screening_client as create_client,
)
from arch_competition_ops.screening.providers import (
    read_notice,
    screening_model,
)
from arch_competition_ops.screening.readability import NoReadableText
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.screening import (
    ScreeningBudgetExceeded,
    find_cached_screening,
    finish_screening,
    load_screening_candidates,
    publish_screening,
    request_hash,
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


def _judge(settings, db_path, model, row, prepared, client, force, sleep=None):
    if not force:
        cached = find_cached_screening(db_path, row["source_url"], model.id, prepared[0])
        if cached:
            decision = ScreeningDecision.model_validate_json(cached["result_json"])
            return DocumentAssessment(None, decision, cached["id"], model.id, True, 0)
    with nullcontext(client) if client is not None else create_client(settings) as api:
        return _request_one(api, settings, db_path, model, row, prepared, sleep)


def _request_one(client, settings, db_path, model, row, prepared, sleep):
    input_json, evidence_fields, limitations = prepared
    snapshot = json.loads(input_json)
    request = snapshot["request"]
    initial_hash = request_hash(input_json)
    total = 0.0
    tokens = [0, 0]
    for attempt in range(2):
        per_attempt = model.reservation(len(input_json.encode()), settings.ai_max_output_tokens)
        try:
            request_id = reserve_screening(
                db_path,
                competition_id=row.get("id"),
                source_url=row["source_url"],
                model=model.id,
                input_json=input_json,
                reserve_usd=per_attempt * billable_attempt_limit(settings.ai_provider),
                budget_usd=settings.ai_monthly_budget_usd,
                daily_budget_usd=settings.ai_daily_budget_usd,
                run_since=settings._reading_run_since,
                source_id=row.get("source_id") if not attempt else None,
                source_daily_limit=settings._source_daily_limit,
            )
        except ScreeningBudgetExceeded as exc:
            exc.cost_usd, exc.usage = total, tuple(tokens)
            raise
        reply = read_notice(client, settings.ai_provider, request, sleep=sleep)
        cost = reply.cost(model, per_attempt)
        total += cost
        tokens = [
            None if a is None or b is None else a + b
            for a, b in zip(tokens, (reply.input_tokens, reply.output_tokens), strict=True)
        ]
        code = reply.error_class
        outage = (code or "").startswith("http_5") or code in {"transport_error", "api_error"}
        decision = None
        if not code:
            decision = validate_evidence(reply.decision, evidence_fields, snapshot["mapped_facts"])
            decision.missing_information.extend(limitations)
        finish_screening(
            db_path,
            request_id,
            status="uncertain"
            if outage or code == "timeout"
            else ("failed" if code else "completed"),
            error_code=code,
            result_json=decision.model_dump_json() if decision else None,
            cost_usd=cost,
            input_tokens=reply.input_tokens,
            output_tokens=reply.output_tokens,
            response_id=reply.response_id,
        )
        if decision:
            return DocumentAssessment(
                None, decision, request_id, model.id, False, total, tuple(tokens)
            )
        if attempt == 0 and reply.validation_error:
            key = "system" if settings.ai_provider == "anthropic" else "instructions"
            request[key] += (
                "\nCorrect the previous answer's schema errors: " + reply.validation_error
            )
            input_json = canonical_json({**snapshot, "retry_of": initial_hash})
            continue
        error = (ScreeningPaused if reply.pause or outage else ScreeningError)(code, cost_usd=total)
        error.usage = tuple(tokens)
        raise error


@dataclass
class DocumentAssessment:
    record: CompetitionRecord | None
    decision: ScreeningDecision | None
    request_id: str
    model: str
    cached: bool
    cost_usd: float

    usage: tuple[int | None, int | None] = (0, 0)

    failure: str | None = None

    def publication(self):
        return dict(
            request_id=self.request_id,
            model=self.model,
            decision=self.decision.decision,
            relevance_score=self.decision.relevance_score,
            result_json=self.decision.model_dump_json(),
        )


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
    client: OpenAI | Anthropic | None = None,
    force: bool = False,
    supplied_row: dict | None = None,
    source_lock: bool = True,
    sleep: Callable[[float], None] | None = None,
) -> DocumentAssessment:
    model = screening_model(settings, settings.ai_model)
    db_path = initialize_database(settings)
    row = {"source_url": source_url, "source_id": source.source_id}
    detail_limits = []
    if supplied_row is None:
        payload = enrich_notice_payload(payload, source_url, settings, limitations=detail_limits)
    else:
        row["title"] = supplied_row.get("title")
    with (
        exclusive_lock(
            source_lock_path(db_path, source.source_id), label="AI extraction and screening"
        )
        if source_lock
        else nullcontext()
    ):
        original_links = {}
        input_json, fields, limitations = prepare_input(
            row,
            settings,
            original_links=original_links,
            source_payload=payload,
            collected=supplied_row is None,
            fetch_source=False,
        )
        limitations.extend(detail_limits)
        advice = _judge(
            settings, db_path, model, row, (input_json, fields, limitations), client, force, sleep
        )
        try:
            advice.record, _ = extract_record(
                advice.decision,
                fields,
                original_links=original_links,
                mapped_names={f["field"] for f in json.loads(input_json)["mapped_facts"]},
                source=source,
                source_url=source_url,
                settings=settings,
            )
        except (NoticeValidationError, ValidationError) as exc:
            exc.cost_usd, exc.usage = advice.cost_usd, advice.usage
            raise
        if advice.record is not None:
            advice.record.source_url_is_notice = source.collector == "generic_notice_pages"
        return advice


def screen_notice(settings: Settings, row: dict, payload: str) -> DocumentAssessment:
    """Read supplied material without fetching. The row names its registry source and notice URL."""
    model = settings.ai_model
    url = row.get("source_url")
    source = next(
        (s for s in load_source_catalog(settings).sources if s.source_id == row.get("source_id")),
        None,
    )
    if not source or not url:
        return DocumentAssessment(None, None, "", model, False, 0, failure="invalid_source")
    try:
        return assess_document(
            settings, source=source, source_url=url, payload=payload, supplied_row=row
        )
    except (
        NoReadableText,
        NoticeValidationError,
        ValidationError,
        ScreeningError,
        ScreeningBudgetExceeded,
        LockHeldError,
    ) as exc:
        failure = "no_readable_text" if isinstance(exc, NoReadableText) else provider_code(exc)
        return DocumentAssessment(
            None,
            None,
            "",
            model,
            False,
            getattr(exc, "cost_usd", 0),
            getattr(exc, "usage", (0, 0)),
            failure,
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
    client: OpenAI | Anthropic | None = None,
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
        for row in rows:
            result.attempted += 1
            try:
                prepared = prepare_input(
                    row,
                    settings,
                    model_id=model.id,
                    source_payload=(source_payloads or {}).get(row["id"]),
                    collected=True,
                    fetch_source=fetch_source,
                )
                with exclusive_lock(
                    source_lock_path(db_path, row.get("source_id")),
                    label="AI screening source",
                ):
                    advice = _judge(settings, db_path, model, row, prepared, client, force)
                    result.cached += int(advice.cached)
                    result.completed += int(not advice.cached)
                    result.cost_usd += advice.cost_usd
                publish_screening(
                    db_path,
                    competition_id=row["id"],
                    source_updated_at=row["updated_at"],
                    **advice.publication(),
                )
                result.results.append(
                    {
                        "competition_id": row["id"],
                        "title": row["title"],
                        "cached": advice.cached,
                        **advice.decision.model_dump(),
                    }
                )
            except NoReadableText as exc:
                result.results.append(
                    {
                        "competition_id": row["id"],
                        "outcome": str(exc),
                        "source_id": row.get("source_id"),
                        "url_class": exc.url_class,
                    }
                )
            except HttpError as exc:
                result.errors.append(f"{row['id']}: source HTTP {exc.status_code}")
                continue
            except (ScreeningError, ScreeningBudgetExceeded) as exc:
                if isinstance(exc, ScreeningError):
                    result.cost_usd += exc.cost_usd
                result.errors.append(f"{row['id']}: {exc}")
                if isinstance(exc, ScreeningPaused | ScreeningBudgetExceeded):
                    break
    return result
