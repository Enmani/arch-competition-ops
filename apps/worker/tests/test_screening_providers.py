import json

import httpx
import pytest
from test_ai_screening import (  # noqa: F401
    NOTICE,
    ai_workspace,
    decision_payload,
    mock_client,
    response,
)

from arch_competition_ops.screening import service
from arch_competition_ops.screening.client import ScreeningError, ScreeningPaused
from arch_competition_ops.storage.connection import connect


@pytest.fixture(params=["responses", "chat_completions"])
def configured(ai_workspace, request):  # noqa: F811
    settings, source = ai_workspace
    settings.ai_provider = request.param
    settings.ai_chat_base_url = "https://provider.example/v1"
    settings.ai_chat_input_usd_per_million = 1
    settings.ai_chat_output_usd_per_million = 2
    return settings, source


@pytest.mark.parametrize("outcome", ["valid", "unknown_cost", "invalid"])
def test_providers_share_decision_usage_and_validation(configured, outcome):
    settings, source = configured
    payload = decision_payload() if outcome != "invalid" else {"decision": "invented"}

    def handle(req):
        if settings.ai_provider == "responses":
            body = response(payload).json()
        else:
            assert req.url.path.endswith("/chat/completions")
            body = {
                "id": "reply",
                "object": "chat.completion",
                "created": 1,
                "model": settings.ai_model,
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": json.dumps(payload)},
                        "finish_reason": "stop",
                    }
                ],
                "usage": {"prompt_tokens": 2000, "completion_tokens": 1000, "total_tokens": 3000},
            }
        if outcome == "unknown_cost":
            body.pop("usage")
        return httpx.Response(200, json=body)

    with mock_client(handle) as client:

        def assess():
            return service.assess_document(
                settings,
                source=source,
                source_url="https://city.example/n/1",
                payload=NOTICE,
                client=client,
            )

        if outcome == "invalid":
            with pytest.raises(ScreeningError, match="invalid_schema"):
                assess()
        else:
            assert assess().record.estimated_contract_value_eur == 350000
    with connect(settings.resolve_path(settings.db)) as cx:
        row = cx.execute(
            "SELECT status,cost_usd,input_tokens,input_json FROM ai_screening_runs"
        ).fetchone()
    model = service.screening_model(settings, settings.ai_model)
    expected = (
        model.cost(len(row["input_json"].encode()) + 4096, settings.ai_max_output_tokens)
        if outcome == "unknown_cost"
        else model.cost(2000, 1000)
    )
    assert row["cost_usd"] == pytest.approx(expected)
    assert row["input_tokens"] == (None if outcome == "unknown_cost" else 2000)
    assert row["status"] == ("failed" if outcome == "invalid" else "completed")


@pytest.mark.parametrize("code,count", [("insufficient_quota", 1), ("rate_limit_exceeded", 4)])
def test_quota_stops_further_notices(configured, monkeypatch, code, count):
    settings, source = configured
    calls = []

    def fail(request):
        calls.append(request.url.path)
        return httpx.Response(
            429, headers={"retry-after": "0"}, json={"error": {"message": "limit", "code": code}}
        )

    monkeypatch.setattr(service, "create_client", lambda _: mock_client(fail))
    outcomes = service.assess_documents(
        settings,
        source=source,
        documents=[(f"https://city.example/n/{i}", NOTICE) for i in range(5)],
    )
    assert len(calls) == count
    assert all(isinstance(item.error, ScreeningPaused) for item in outcomes)
