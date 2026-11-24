import json
from pathlib import Path

import httpx
import pytest
from test_ai_screening import mock_client

from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.providers import read_notice
from arch_competition_ops.settings import Settings


@pytest.mark.parametrize("provider", ["responses", "chat_completions"])
def test_only_one_original_notice_reaches_the_model(tmp_path, provider):
    skill = tmp_path / "rule.md"
    skill.write_text("---\nmetadata: hidden\n---\nRead the notice.", encoding="utf8")
    settings = Settings(root=tmp_path, ai_preferences=skill, _env_file=None)
    settings.ai_provider = provider
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

    if provider == "chat_completions":
        fmt = expected["text"]["format"]
        expected = {
            "model": "gpt-6-luna",
            "messages": [
                {"role": "system", "content": "Read the notice."},
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

    with mock_client(capture) as client:
        read_notice(client, provider, request)
    assert sent == [expected]
