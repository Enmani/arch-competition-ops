from __future__ import annotations

import json
from datetime import date, timedelta

from arch_competition_ops import clock
from arch_competition_ops.cli import main
from arch_competition_ops.maintenance import cleanup_expired_competitions
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema, upsert_competition


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
