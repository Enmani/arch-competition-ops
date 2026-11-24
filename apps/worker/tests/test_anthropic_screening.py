"""Anthropic Messages transport, evidence, error handling and budget ledger. No network."""

import json
import math

import pytest
from requests import Response
from test_ai_screening import NOTICE, ai_workspace, decision_payload  # noqa: F401

from arch_competition_ops.screening import service
from arch_competition_ops.screening.anthropic import AnthropicMessages
from arch_competition_ops.screening.catalog import get_model
from arch_competition_ops.screening.client import ScreeningError, ScreeningPaused
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.connection import connect


def reply(status=200, **body):
    result = Response()
    result.status_code = status
    result.headers["retry-after"] = "7"
    result._content = json.dumps(body).encode()
    return result


def completion(*, stop="end_turn", decision=None, blocks=("thinking", "text")):
    return reply(
        stop_reason=stop,
        content=[
            {"type": "text", "text": json.dumps(decision or decision_payload())}
            if kind == "text"
            else {"type": kind}
            for kind in blocks
        ],
        usage={
            "input_tokens": 12000,
            "cache_read_input_tokens": 500,
            "cache_creation_input_tokens": 200,
            "output_tokens": 3500,
        },
    )


@pytest.fixture
def workspace(ai_workspace, monkeypatch):  # noqa: F811
    settings, source = ai_workspace
    monkeypatch.setenv("ANTHROPIC_API_KEY", "fixture-only")
    return Settings(root=settings.root, _env_file=None), source


def run_fixture(workspace, replies, monkeypatch):
    settings, source = workspace
    pending = iter(replies)
    waits = []
    monkeypatch.setattr(AnthropicMessages, "send", lambda *a, **kw: next(pending))
    try:
        outcome = service.assess_document(
            settings,
            source=source,
            source_url="https://city.example/n/1",
            payload=NOTICE,
            sleep=waits.append,
        )
    except ScreeningError as exc:
        outcome = exc
    assert next(pending, None) is None
    with connect(settings.resolve_path(settings.db)) as db:
        row = db.execute("SELECT * FROM ai_screening_runs").fetchone()
    return outcome, row, waits


def test_default_settings_accounting_and_evidence(workspace, monkeypatch):
    settings, _ = workspace
    assert (settings.ai_provider, settings.ai_model, settings.ai_reasoning_effort) == (
        "anthropic",
        "claude-haiku-5-5",
        "low",
    )
    assert (settings.ai_daily_budget_usd, settings.ai_monthly_budget_usd) == (5, 100)
    decision = decision_payload(
        decision="recommend", evidence=[{"field": "notice_text", "quote": "invented"}]
    )
    result, row, waits = run_fixture(workspace, [completion(decision=decision)], monkeypatch)
    assert result.decision.decision == "needs_review" and not result.decision.evidence
    assert result.record.estimated_contract_value_eur == 350000
    assert (row["input_tokens"], row["output_tokens"]) == (12700, 3500)
    assert row["cost_usd"] == pytest.approx((12200 * 0.1 + 500 * 0.01 + 3500 * 0.5) / 1e6)
    assert not waits
    assert "fixture-only" not in row["input_json"]
    model = get_model(settings.ai_model)
    size = len(row["input_json"].encode())
    assert model.reservation(size, 16000) == model.cost(math.ceil(1.7 * (size + 4096)), 16000)
    assert model.reservation(size, 16000) > row["cost_usd"]


@pytest.mark.parametrize("score", [-1, 101])
def test_local_score_bounds_survive_wire_schema_change(workspace, monkeypatch, score):
    invalid = completion(decision=decision_payload(relevance_score=score))
    error, row, _ = run_fixture(workspace, [invalid], monkeypatch)
    assert str(error) == "invalid_schema" and row["status"] == "failed"


@pytest.mark.parametrize("stop", ["max_tokens", "refusal"])
def test_unusable_generation_is_charged_without_publishing(workspace, monkeypatch, stop):
    error, row, _ = run_fixture(workspace, [completion(stop=stop)], monkeypatch)
    assert type(error) is ScreeningError and str(error) == stop
    assert row["status"] == "failed" and row["result_json"] is None
    assert row["output_tokens"] == 3500 and row["cost_usd"] == error.cost_usd > 0


@pytest.mark.parametrize(
    ("status", "kind", "message", "code", "paused", "attempts"),
    [
        (429, "rate_limit_error", "rate", "http_429", True, 4),
        (529, "overloaded_error", "busy", "http_529", True, 4),
        (503, "server_error", "unavailable", "http_503", True, 4),
        (401, "authentication_error", "key", "http_401", True, 1),
        (403, "permission_error", "denied", "http_403", True, 1),
        (
            400,
            "invalid_request_error",
            "Your credit balance is too low",
            "insufficient_quota",
            True,
            1,
        ),
        (400, "invalid_request_error", "Insufficient credits", "insufficient_quota", True, 1),
        (400, "invalid_request_error", "invalid schema", "http_400", False, 1),
        (422, "invalid_request_error", "bad field", "http_422", False, 1),
    ],
)
def test_error_mapping_and_budget(
    workspace, monkeypatch, status, kind, message, code, paused, attempts
):
    answers = [reply(status, error={"type": kind, "message": message})] * attempts
    error, row, waits = run_fixture(workspace, answers, monkeypatch)
    assert isinstance(error, ScreeningError) and isinstance(error, ScreeningPaused) == paused
    assert str(error) == row["error_code"] == code
    assert waits == [7] * (attempts - 1)
    model = get_model(workspace[0].ai_model)
    reserve = model.reservation(len(row["input_json"].encode()), 16000)
    assert row["cost_usd"] == pytest.approx(attempts * reserve if status >= 500 else 0)


def test_recovered_server_error_keeps_ambiguous_cost(workspace, monkeypatch):
    result, row, waits = run_fixture(workspace, [reply(529), reply(429), completion()], monkeypatch)
    assert waits == [7, 7]
    model = get_model(workspace[0].ai_model)
    reserve = model.reservation(len(row["input_json"].encode()), 16000)
    assert result.cost_usd == pytest.approx(reserve + model.cost(12700, 3500, 500))


def test_budget_refuses_ambiguous_retries_before_any_http(workspace, monkeypatch):
    from arch_competition_ops.storage.screening import ScreeningBudgetExceeded

    settings, source = workspace
    settings.ai_daily_budget_usd = 0.02  # enough for one Haiku request but not four attempts
    monkeypatch.setattr(AnthropicMessages, "send", lambda *a, **kw: pytest.fail("unreserved call"))
    with pytest.raises(ScreeningBudgetExceeded, match="daily budget"):
        service.assess_document(settings, source=source, source_url=source.base_url, payload=NOTICE)


@pytest.mark.parametrize("stop", ["refusal", "max_tokens", "invalid_request", "missing_text"])
def test_failed_notice_stays_queued_while_next_notice_is_published(workspace, monkeypatch, stop):
    import yaml

    from arch_competition_ops.collectors.base import CollectedSourceDocument
    from arch_competition_ops.ingest import ingest_source
    from arch_competition_ops.storage.backlog import queued

    settings, source = workspace
    settings.ai_enabled = True
    settings.ai_fetch_details = False
    (settings.root / "config/sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}), encoding="utf-8"
    )
    docs = [CollectedSourceDocument(f"https://city.example/n/{i}", NOTICE) for i in range(2)]
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents", lambda *a, **kw: docs
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **kw: r)
    first = (
        reply(400, error={"type": "invalid_request_error", "message": "bad field"})
        if stop == "invalid_request"
        else completion(blocks=("thinking",))
        if stop == "missing_text"
        else completion(stop=stop)
    )
    replies = iter([first, completion()])
    monkeypatch.setattr(AnthropicMessages, "send", lambda *a, **kw: next(replies))
    result = ingest_source(settings, source_id=source.source_id)
    assert [f.source_url for f in result.failures] == [docs[0].source_url]
    assert len(result.ingested_ids) == 1
    assert [
        item.document for item in queued(settings.resolve_path(settings.db), source.source_id, 5)
    ] == [docs[0]]
    with connect(settings.resolve_path(settings.db)) as db:
        error = db.execute(
            "SELECT last_error FROM notice_backlog WHERE status='queued'"
        ).fetchone()[0]
        assert error == ("http_400" if stop == "invalid_request" else stop)


@pytest.mark.parametrize(
    "blocks", [("text",), ("thinking", "text"), ("redacted_thinking", "text"), ("thinking",)]
)
def test_first_text_block_and_reported_usage(workspace, monkeypatch, blocks):
    result, row, _ = run_fixture(workspace, [completion(blocks=blocks)], monkeypatch)
    if "text" in blocks:
        assert result.record.title == "Civic School Design Competition"
    else:
        assert str(result) == "missing_text" and row["status"] == "failed"
    assert row["cost_usd"] > 0 and row["output_tokens"] == 3500
