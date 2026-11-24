import json
from datetime import timedelta

from test_ai_screening import ai_workspace  # noqa: F401

from arch_competition_ops import clock
from arch_competition_ops.cli import main
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.storage import upsert_competition


def test_cli_dry_run_needs_no_key_and_skips_expired_and_human_discarded(ai_workspace, capsys):  # noqa: F811
    settings, _source = ai_workspace
    db = settings.resolve_path(settings.db)
    for title, status, days in [
        ("eligible", "discovered", 30),
        ("old", "discovered", -3),
        ("discarded", "discarded", 30),
    ]:
        upsert_competition(
            db,
            CompetitionRecord(
                title=title,
                status=status,
                source_url=f"https://city.example/{title}",
                deadline_at=clock.today() + timedelta(days=days),
            ),
        )
    assert main(["screen-competitions", "--dry-run", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["planned"] == 1
    assert payload["results"][0]["title"] == "eligible"
    assert payload["cost_usd"] == 0
