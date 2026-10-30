from __future__ import annotations

import json

import httpx
from openai import OpenAI
from support import write_minimal_config

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.screening.triage import triage_documents
from arch_competition_ops.settings import Settings


def test_triage_excludes_only_clear_negatives_prioritizes_fit_and_keeps_unknowns(tmp_path):
    write_minimal_config(tmp_path, "sources: []")
    settings = Settings(root=tmp_path, _env_file=None)
    docs = [
        CollectedSourceDocument(f"https://example.org/{i}", text)
        for i, text in enumerate(
            [
                "School architecture services",
                "Unknown local notice",
                "Stationery supply",
            ]
        )
    ]
    calls = []

    def handler(request):
        calls.append(request)
        body = json.loads(request.content)
        assert request.url.path == "/v1/decisions"
        assert body["model"] == "gpt-6-luna"
        assert len(body["questions"]) == 3
        return httpx.Response(
            200,
            json={
                "answers": [
                    {"type": "choice", "name": "candidate_0", "choice": "keep", "confidence": 0.9},
                    {"type": "refusal", "name": "candidate_1"},
                    {
                        "type": "choice",
                        "name": "candidate_2",
                        "choice": "exclude",
                        "confidence": 0.99,
                    },
                ],
                "usage": {"input_tokens": 1000, "output_tokens": 0},
            },
        )

    with OpenAI(
        api_key="test-secret",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        first = triage_documents(settings, docs, limit=20, client=client)
        second = triage_documents(settings, docs, limit=20, client=client)
    assert [doc.source_url for doc in first.documents] == [docs[0].source_url, docs[1].source_url]
    assert first.excluded == 1
    assert first.cost_usd == 0.0001
    assert second.cached and second.cost_usd == 0
    assert len(calls) == 1


def test_triage_threshold_is_a_configurable_score_not_a_missing_information_gate(tmp_path):
    write_minimal_config(tmp_path, "sources: []")
    settings = Settings(root=tmp_path, _env_file=None)
    docs = [CollectedSourceDocument("https://example.org/1", "Unfamiliar notice")]

    def handler(_request):
        return httpx.Response(
            200,
            json={
                "answers": [
                    {
                        "type": "choice",
                        "name": "candidate_0",
                        "choice": "exclude",
                        "confidence": 0.97,
                    },
                ],
                "usage": {"input_tokens": 100},
            },
        )

    with OpenAI(
        api_key="test-secret",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    ) as client:
        retained = triage_documents(settings, docs, limit=1, client=client)
        settings.ai_triage_exclude_threshold = 0.9
        excluded = triage_documents(settings, docs, limit=1, client=client)
    assert len(retained.documents) == 1
    assert excluded.excluded == 1 and excluded.cached
