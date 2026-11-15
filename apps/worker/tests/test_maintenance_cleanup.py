from __future__ import annotations

import json
import sqlite3
from datetime import date, timedelta

import pytest

from arch_competition_ops import clock
from arch_competition_ops.cli import main
from arch_competition_ops.maintenance import cleanup_expired_competitions
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema, upsert_competition
from arch_competition_ops.storage.screening import find_cached_screening


def _seed(settings: Settings, *, expired_days_ago: int = 12) -> tuple[str, str]:
    db_path = settings.resolve_path(settings.db)
    ensure_schema(db_path)
    expired = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="expired-opportunity",
            title="Expired opportunity",
            source_url="https://example.com/expired",
            deadline_at=clock.today() - timedelta(days=expired_days_ago),
        ),
    )
    active = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="active-opportunity",
            title="Active opportunity",
            source_url="https://example.com/active",
            deadline_at=clock.today() + timedelta(days=7),
        ),
    )
    return expired, active


def _count(settings: Settings) -> int:
    import sqlite3

    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        return connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0]


def test_cleanup_deletes_old_records_and_matching_preview_files(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    _seed(settings)
    preview_dir = tmp_path / "artifacts" / "previews" / "images"
    static_dir = tmp_path / "apps" / "web" / "public" / "previews" / "images"
    preview_dir.mkdir(parents=True)
    static_dir.mkdir(parents=True)
    # Every content hash of the expired record matches, without reading the Web app's TypeScript.
    for name in ("expired-opportunity-0123456789.jpg", "expired-opportunity-abcdef0123.jpg"):
        (preview_dir / name).write_bytes(b"preview")
    (static_dir / "expired-opportunity-0123456789.jpg").write_bytes(b"static")
    # Neighbours that merely share a prefix with the expired id must survive.
    (preview_dir / "active-opportunity-0123456789.jpg").write_bytes(b"keep")
    (preview_dir / "expired-opportunity-other-0123456789.jpg").write_bytes(b"keep")
    (preview_dir / "expired-opportunity.jpg").write_bytes(b"keep")

    result = cleanup_expired_competitions(settings, retention_days=7, limit=20)

    assert (result.attempted, result.deleted_competitions) == (1, 1)
    assert (result.deleted_preview_files, result.deleted_static_preview_files) == (2, 1)
    assert sorted(path.name for path in preview_dir.iterdir()) == [
        "active-opportunity-0123456789.jpg",
        "expired-opportunity-other-0123456789.jpg",
        "expired-opportunity.jpg",
    ]
    assert list(static_dir.iterdir()) == []
    assert _count(settings) == 1


def test_cleanup_runs_at_most_once_per_day_on_its_own(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    _seed(settings)

    first = cleanup_expired_competitions(settings, retention_days=7)
    _seed(settings)  # an opportunity expires again later the same day
    second = cleanup_expired_competitions(settings, retention_days=7)

    assert (first.already_ran_today, first.deleted_competitions) == (False, 1)
    assert (second.already_ran_today, second.deleted_competitions) == (True, 0)
    assert second.last_run_date == clock.today().isoformat()
    assert _count(settings) == 2  # the second call really did nothing

    state = json.loads(
        settings.resolve_path(settings.expired_cleanup_state).read_text(encoding="utf-8")
    )
    assert state["last_run_date"] == clock.today().isoformat()
    assert state["deleted_competitions"] == 1


def test_cleanup_runs_again_the_next_day_and_when_forced(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    _seed(settings)
    cleanup_expired_competitions(settings, retention_days=7)
    _seed(settings)

    forced = cleanup_expired_competitions(settings, retention_days=7, force=True)
    assert forced.deleted_competitions == 1

    _seed(settings)
    clock.set_today_provider(lambda: date(2026, 5, 14))
    next_day = cleanup_expired_competitions(settings, retention_days=7)
    assert next_day.already_ran_today is False


def test_cleanup_with_nothing_to_delete_still_records_the_day(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)

    result = cleanup_expired_competitions(settings)

    assert (result.attempted, result.deleted_competitions) == (0, 0)
    assert settings.resolve_path(settings.expired_cleanup_state).exists()


def test_cleanup_command_is_idempotent_for_callers_that_run_it_every_batch(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    _seed(settings)

    assert main(["cleanup-expired-competitions", "--retention-days", "7"]) == 0
    assert "deleted=1" in capsys.readouterr().out
    assert main(["cleanup-expired-competitions", "--retention-days", "7"]) == 0
    assert "already ran on" in capsys.readouterr().out
    assert main(["cleanup-expired-competitions", "--retention-days", "7", "--force"]) == 0
    assert "attempted=0" in capsys.readouterr().out


def test_cleanup_leaves_watchlisted_opportunities_alone(tmp_path, monkeypatch) -> None:
    import sqlite3

    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    expired, _active = _seed(settings)
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.execute(
            "INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at,"
            " updated_at) VALUES ('w', ?, 'x', 'x')",
            (expired,),
        )
        connection.commit()

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert (result.attempted, result.deleted_competitions) == (0, 0)
    assert _count(settings) == 2


def test_cleanup_respects_an_environment_clock_override(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    _seed(settings, expired_days_ago=3)  # expired, but inside the 7 day retention window
    clock.set_today_provider(None)
    monkeypatch.setenv("ARCH_COMPETITION_TODAY", "2026-05-13")

    assert cleanup_expired_competitions(settings, retention_days=7).deleted_competitions == 0

    monkeypatch.setenv("ARCH_COMPETITION_TODAY", "2026-06-13")  # a month later: both are expired
    assert cleanup_expired_competitions(settings, retention_days=7).deleted_competitions == 2


# -- AI exclusions and old AI payloads ----------------------------------------------------------


def _stamp(days_ago: int) -> str:
    """A UTC timestamp ``days_ago`` days before the pinned test day (retention uses the clock)."""
    return f"{(clock.today() - timedelta(days=days_ago)).isoformat()}T12:00:00+00:00"


def _competition(settings: Settings, name: str, *, status: str = "discovered") -> str:
    return upsert_competition(
        settings.resolve_path(settings.db),
        CompetitionRecord(
            competition_id=name,
            title=name,
            source_url=f"https://example.com/{name}",
            status=status,
            deadline_at=clock.today() + timedelta(days=30),
        ),
    )


def _assess(
    settings: Settings,
    competition_id: str,
    *,
    decision: str = "exclude",
    age_days: int = 10,
    current: bool = True,
) -> None:
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        revision = connection.execute(
            "SELECT updated_at FROM competitions WHERE id = ?", (competition_id,)
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO ai_screening_results (competition_id, source_updated_at, model, "
            "decision, relevance_score, result_json, updated_at) "
            "VALUES (?, ?, 'gpt-6-luna', ?, 5, '{}', ?)",
            (
                competition_id,
                revision if current else "1999-01-01T00:00:00+00:00",
                decision,
                _stamp(age_days),
            ),
        )


def _ids(settings: Settings) -> set[str]:
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        return {row[0] for row in connection.execute("SELECT id FROM competitions")}


@pytest.fixture
def settings(tmp_path, monkeypatch) -> Settings:
    monkeypatch.chdir(tmp_path)
    ensure_schema(tmp_path / "data" / "competitions.sqlite")
    return Settings(root=tmp_path, _env_file=None)


def test_old_current_exclusions_are_deleted_with_their_previews_and_counted_apart(settings):
    _seed(settings)  # one expired and one active record
    old = _competition(settings, "old-excluded")
    _assess(settings, old)
    preview_dir = settings.root / "artifacts" / "previews" / "images"
    static_dir = settings.root / "apps" / "web" / "public" / "previews" / "images"
    preview_dir.mkdir(parents=True)
    static_dir.mkdir(parents=True)
    (preview_dir / "old-excluded-0123456789.jpg").write_bytes(b"x")
    (static_dir / "old-excluded-0123456789.jpg").write_bytes(b"x")
    (preview_dir / "active-opportunity-0123456789.jpg").write_bytes(b"keep")

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert (result.attempted, result.deleted_competitions) == (1, 1)  # the expired one alone
    assert (result.excluded_attempted, result.deleted_excluded_competitions) == (1, 1)
    assert (
        result.deleted_excluded_preview_files,
        result.deleted_excluded_static_preview_files,
    ) == (1, 1)
    assert _ids(settings) == {"active-opportunity"}
    assert [p.name for p in preview_dir.iterdir()] == ["active-opportunity-0123456789.jpg"]
    state = json.loads(
        settings.resolve_path(settings.expired_cleanup_state).read_text(encoding="utf-8")
    )
    assert state["deleted_excluded_competitions"] == 1


def test_a_record_that_is_expired_and_excluded_is_deleted_once(settings):
    expired, _active = _seed(settings)
    _assess(settings, expired)

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert result.deleted_competitions == 1
    assert (result.excluded_attempted, result.deleted_excluded_competitions) == (0, 0)


def test_exclusions_are_kept_until_the_retention_window_has_passed(settings):
    for name, age in [("seven-days", 7), ("eight-days", 8), ("fresh", 1)]:
        _assess(settings, _competition(settings, name), age_days=age)

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert result.deleted_excluded_competitions == 1
    assert _ids(settings) == {"seven-days", "fresh"}


@pytest.mark.parametrize("status", ["shortlisted", "verified"])
def test_human_decisions_survive_an_ai_exclusion(settings, status):
    _assess(settings, _competition(settings, "human", status=status))

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert result.excluded_attempted == 0
    assert _ids(settings) == {"human"}


def test_other_statuses_do_not_protect_an_exclusion(settings):
    for status in ("discarded", "archived"):
        _assess(settings, _competition(settings, status, status=status))

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert result.deleted_excluded_competitions == 2


def test_watchlisted_exclusions_are_kept(settings):
    watched = _competition(settings, "watched")
    _assess(settings, watched)
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.execute(
            "INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at,"
            " updated_at) VALUES ('w', ?, 'x', 'x')",
            (watched,),
        )

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert (result.excluded_attempted, result.deleted_excluded_competitions) == (0, 0)
    assert _ids(settings) == {"watched"}


def test_a_stale_assessment_and_other_decisions_never_delete_a_record(settings):
    _assess(settings, _competition(settings, "changed-since"), current=False)
    _assess(settings, _competition(settings, "needs-review"), decision="needs_review")
    _assess(settings, _competition(settings, "recommended"), decision="recommend")
    _competition(settings, "never-assessed")

    result = cleanup_expired_competitions(settings, retention_days=7)

    assert result.excluded_attempted == 0
    assert len(_ids(settings)) == 4


def _run(settings: Settings, run_id: str, *, age_days: int, cost: float = 0.25) -> None:
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.execute(
            "INSERT INTO ai_screening_runs (id, source_url, model, input_json, status, "
            "result_json, input_tokens, cost_usd, response_id, started_at, completed_at) "
            "VALUES (?, ?, 'gpt-6-luna', ?, 'completed', '{\"decision\": 1}', 7, ?, 'resp', ?, ?)",
            (
                run_id,
                f"https://example.com/{run_id}",
                f"input-{run_id}",
                cost,
                _stamp(age_days),
                _stamp(age_days),
            ),
        )


def test_old_run_payloads_are_blanked_but_cost_rows_and_recent_runs_stay(settings):
    _run(settings, "old", age_days=46)
    _run(settings, "recent", age_days=44)
    db = settings.resolve_path(settings.db)

    result = cleanup_expired_competitions(settings)

    assert result.shrunk_screening_runs == 1
    with sqlite3.connect(db) as connection:
        connection.row_factory = sqlite3.Row
        rows = {r["id"]: r for r in connection.execute("SELECT * FROM ai_screening_runs")}
    old, recent = rows["old"], rows["recent"]
    assert (old["input_json"], old["result_json"]) == ("", None)
    assert (old["cost_usd"], old["status"], old["started_at"]) == (0.25, "completed", _stamp(46))
    assert (old["input_tokens"], old["response_id"]) == (7, "resp")
    assert (recent["input_json"], recent["result_json"]) == ("input-recent", '{"decision": 1}')
    # The exact-input cache stops matching the blanked run; the notice ledger prevents a re-screen.
    assert find_cached_screening(db, "https://example.com/old", "gpt-6-luna", "input-old") is None
    assert find_cached_screening(db, "https://example.com/recent", "gpt-6-luna", "input-recent")
    # Already blanked rows are not counted again.
    assert cleanup_expired_competitions(settings, force=True).shrunk_screening_runs == 0


def test_exclusion_and_payload_cleanup_share_the_once_a_day_guard(settings):
    first = cleanup_expired_competitions(settings, retention_days=7)
    _assess(settings, _competition(settings, "late-excluded"))
    _run(settings, "old", age_days=60)

    second = cleanup_expired_competitions(settings, retention_days=7)

    assert (first.already_ran_today, second.already_ran_today) == (False, True)
    assert (second.deleted_excluded_competitions, second.shrunk_screening_runs) == (0, 0)
    assert _ids(settings) == {"late-excluded"}
    forced = cleanup_expired_competitions(settings, retention_days=7, force=True)
    assert (forced.deleted_excluded_competitions, forced.shrunk_screening_runs) == (1, 1)


def test_cleanup_command_prints_the_ai_counts(settings, capsys):
    _assess(settings, _competition(settings, "old-excluded"))
    _run(settings, "old", age_days=60)

    assert main(["cleanup-expired-competitions", "--retention-days", "7"]) == 0

    output = capsys.readouterr().out
    assert "ai_excluded_attempted=1" in output
    assert "ai_excluded_deleted=1" in output
    assert "ai_runs_shrunk=1" in output
