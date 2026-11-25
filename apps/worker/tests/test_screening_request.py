import json
from pathlib import Path

import httpx
import pytest
from support import REPO_ROOT
from test_ai_screening import mock_client

from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.providers import read_notice
from arch_competition_ops.settings import Settings


@pytest.mark.parametrize("provider", ["openai", "openai-compatible", "anthropic"])
def test_only_one_original_notice_reaches_the_model(tmp_path, provider):
    skill = tmp_path / "rule.md"
    skill.write_text("---\nmetadata: hidden\n---\nRead the notice.", encoding="utf8")
    settings = Settings(
        root=tmp_path,
        ai_preferences=skill,
        taxonomy_config=REPO_ROOT / "config/taxonomy.yml",
        ai_provider=provider,
        ai_model=("claude-haiku-5-5" if provider == "anthropic" else "gpt-6-luna"),
        anthropic_api_key="fixture-only",
        _env_file=None,
    )
    settings.ai_chat_base_url = "https://provider.example/v1"
    row = {
        "source_url": "https://user:password@city.example/n?id=1&signature=secret",
        "title": "Library",
        "source_tier": "internal",
        "score": 99,
        "other": [{"title": "Another notice"}],
    }
    payload = json.dumps(
        {
            "rawNoticeHtml": "<p>Library design</p><a href='/brief?token=hidden'>Brief</a>",
            "summary": "local inference",
            "extra": {"prompt": "hidden"},
        }
    )
    snapshot, _, _ = prepare_input(row, settings, source_payload=payload)
    request = json.loads(snapshot)["request"]
    expected = json.loads(
        Path(__file__)
        .with_name("fixtures")
        .joinpath("screening-request.json")
        .read_text(encoding="utf8")
    )

    if provider == "anthropic":
        from arch_competition_ops.screening.providers import create_screening_client

        schema = expected["text"]["format"]["schema"]
        del schema["properties"]["relevance_score"]["minimum"]
        del schema["properties"]["relevance_score"]["maximum"]
        expected = {
            "model": "claude-haiku-5-5",
            "max_tokens": 16000,
            "system": expected["instructions"],
            "messages": [{"role": "user", "content": expected["input"]}],
            "output_config": {"effort": "low", "format": {"type": "json_schema", "schema": schema}},
        }
    if provider == "openai-compatible":
        fmt = expected["text"]["format"]
        expected = {
            "model": "gpt-6-luna",
            "messages": [
                {"role": "system", "content": expected["instructions"]},
                {"role": "user", "content": expected["input"]},
            ],
            "reasoning_effort": "low",
            "max_tokens": 12288,
            "response_format": {
                "type": "json_schema",
                "json_schema": {
                    "schema": fmt["schema"],
                    "name": "competition_screening",
                    "strict": True,
                },
            },
        }
    sent = []

    def capture(req):
        sent.append(json.loads(req.content))
        return httpx.Response(400, json={"error": {"message": "fixture"}})

    if provider == "anthropic":
        from requests import Response

        def send(req, **kwargs):
            assert req.method == "POST" and req.url == "https://api.anthropic.com/v1/messages"
            assert req.headers["x-api-key"] == "fixture-only"
            assert req.headers["anthropic-version"] == "2026-10-21"
            assert req.headers["content-type"] == "application/json"
            assert not kwargs["allow_redirects"]
            sent.append(json.loads(req.body))
            reply = Response()
            reply.status_code = 400
            reply._content = b"{}"
            return reply

        with create_screening_client(settings) as client:
            client.send = send
            read_notice(client, provider, request)
        assert sent == [expected]
        return
    with mock_client(capture) as client:
        read_notice(client, provider, request)
    assert sent == [expected]


def test_signed_links_in_escaped_json_are_sanitized(tmp_path):
    skill = tmp_path / "rule.md"
    skill.write_text("Read.", encoding="utf8")
    settings = Settings(
        root=tmp_path,
        ai_preferences=skill,
        taxonomy_config=REPO_ROOT / "config/taxonomy.yml",
        _env_file=None,
    )
    payload = json.dumps({"rawNotice": r'{"url":"https:\/\/city.example\/a?id=4&token=private"}'})
    snapshot, _, _ = prepare_input(
        {
            "source_url": "https://city.example/b?uri=https%3A%2F%2Fcity.example%2Fa%3Ftoken%3Dprivate"
        },
        settings,
        source_payload=payload,
    )
    assert "private" not in snapshot
    assert "https://city.example/a?id=4" in snapshot


def test_structured_notice_hash_ignores_rotating_metadata_but_keeps_the_deadline():
    from arch_competition_ops.screening.fingerprints import notice_content_hash

    original = {
        "title": "Library",
        "csrfToken": "one",
        "pageGeneratedAt": "09:00",
        "deadline": "2026-12-01",
    }
    rotated = {
        "deadline": "2026-12-01",
        "pageGeneratedAt": "10:00",
        "title": "Library",
        "csrfToken": "two",
    }

    def version(raw):
        return notice_content_hash(json.dumps({"rawNotice": raw}), "https://city.example/1")

    assert version(original) == version(rotated)
    rotated["deadline"] = "2026-12-03"
    assert version(original) != version(rotated)
