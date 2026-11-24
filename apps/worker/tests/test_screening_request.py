import json
from pathlib import Path

from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.settings import Settings


def test_only_one_original_notice_reaches_the_model(tmp_path):
    skill = tmp_path / "rule.md"
    skill.write_text("---\nmetadata: hidden\n---\nRead the notice.", encoding="utf8")
    settings = Settings(root=tmp_path, ai_preferences=skill, _env_file=None)
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
    assert request == json.loads(
        Path(__file__)
        .with_name("fixtures")
        .joinpath("screening-request.json")
        .read_text(encoding="utf8")
    )
