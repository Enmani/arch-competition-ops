"""Advisory screening; facts and human decisions are never overwritten."""

from __future__ import annotations

import json
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from openai import APIConnectionError, APIError, APIStatusError, OpenAI
from pydantic import ValidationError

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.config_loader import load_targeting_preferences
from arch_competition_ops.locking import exclusive_lock
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.screening.catalog import ScreeningModel, get_model
from arch_competition_ops.screening.client import ScreeningError, create_client
from arch_competition_ops.screening.extraction import extract_record
from arch_competition_ops.screening.inputs import (
    enrich_notice_payload,
    prepare_input,
    request_arguments,
)
from arch_competition_ops.screening.models import ScreeningDecision, validate_evidence
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
    schema = ScreeningDecision.model_json_schema()
    # Strict Structured Outputs requires every property, including defaulted additions.
    schema["required"] = list(schema["properties"])
    try:
        response = client.responses.create(
            model=model.id,
            **request_arguments(input_json),
            store=False,
            service_tier="default",
            text={
                "format": {
                    "type": "json_schema",
                    "name": "competition_screening",
                    "strict": True,
                    "schema": schema,
                }
            },
        )
    except APIStatusError as exc:
        # Rejected 4xx calls have not generated output; 5xx/network outcomes remain reserved.
        code = f"http_{exc.status_code}"
        finish_screening(
            db_path,
            request_id,
            status="failed",
            error_code=code,
            cost_usd=0 if 400 <= exc.status_code < 500 else None,
        )
        raise ScreeningError(
            f"OpenAI {code}; check API key, model access, credits and limits"
        ) from None
    except APIConnectionError:
        finish_screening(db_path, request_id, status="uncertain", error_code="transport_error")
        raise ScreeningError(
            "OpenAI connection failed; cost reservation retained",
            cost_usd=reserve,
        ) from None
    except APIError:
        finish_screening(db_path, request_id, status="uncertain", error_code="api_error")
        raise ScreeningError(
            "OpenAI API error; cost reservation retained", cost_usd=reserve
        ) from None

    usage = response.usage
    accounting = {
        "response_id": response.id,
        "input_tokens": usage.input_tokens if usage else None,
        "output_tokens": usage.output_tokens if usage else None,
        "cost_usd": model.cost(usage.input_tokens, usage.output_tokens) if usage else None,
    }
    try:
        if response.status != "completed":
            raise ValueError("incomplete_response")
        decision = ScreeningDecision.model_validate_json(response.output_text)
        validate_evidence(decision, evidence_fields)
        if limitations and decision.decision == "recommend":
            # Partial inputs cannot qualify an opportunity as a positive recommendation.
            decision.decision = "needs_review"
            decision.missing_information.extend(limitations)
    except ValueError as exc:
        code = "invalid_schema" if isinstance(exc, ValidationError) else str(exc)
        finish_screening(
            db_path,
            request_id,
            status="failed",
            error_code=code,
            result_json=json.dumps({"invalid_output": response.output_text}, ensure_ascii=False),
            **accounting,
        )
        raise ScreeningError(
            f"OpenAI output rejected ({code})",
            cost_usd=accounting["cost_usd"] if accounting["cost_usd"] is not None else reserve,
        ) from None
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


def assess_document(
    settings: Settings,
    *,
    source: SourceDefinition,
    source_url: str,
    payload: str,
    client: OpenAI | None = None,
    force: bool = False,
) -> DocumentAssessment:
    """AI-first entry: no source-specific parser or keyword gate is needed for a notice."""
    model = get_model(settings.ai_model)
    preferences = load_targeting_preferences(settings).model_dump(mode="json")
    db_path = initialize_database(settings)
    row = {
        "source_url": source_url,
        "source_name": source.name,
        "jurisdiction": source.jurisdiction,
        "source_tier": source.source_tier,
    }
    payload = enrich_notice_payload(payload, source_url, settings)
    with exclusive_lock(db_path.with_suffix(".ai.lock"), label="AI extraction and screening"):
        input_json, fields, limitations = prepare_input(
            row,
            settings,
            preferences,
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
    model = get_model(model_id or settings.ai_model)
    preferences = load_targeting_preferences(settings).model_dump(mode="json")
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
                        preferences,
                        source_payload=(source_payloads or {}).get(row["id"]),
                        fetch_source=fetch_source,
                    )
                    cached = find_cached_screening(db_path, row["source_url"], model.id, input_json)
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
                except (ScreeningError, ScreeningBudgetExceeded) as exc:
                    if isinstance(exc, ScreeningError):
                        result.cost_usd += exc.cost_usd
                    result.errors.append(f"{row['id']}: {exc}")
                    # Stop on account, transport, output and budget errors. No paid retry loop.
                    break
    return result
