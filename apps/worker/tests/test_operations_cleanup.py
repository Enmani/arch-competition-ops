from __future__ import annotations

import json
from datetime import date

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.operations import (
    cleanup_expired_competitions,
    cleanup_expired_competitions_once_per_day,
)
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema, upsert_competition


def test_cleanup_expired_competitions_deletes_old_records_and_preview_files(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    ensure_schema(db_path)

    expired_id = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="expired-opportunity",
            title="Expired opportunity",
            organizer="TED",
            source_url="https://example.com/expired",
            deadline_at=date(2026, 5, 1),
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="active-opportunity",
            title="Active opportunity",
            organizer="TED",
            source_url="https://example.com/active",
            deadline_at=date(2026, 5, 20),
        ),
    )

    revision_path = tmp_path / "apps" / "web" / "src" / "lib"
    revision_path.mkdir(parents=True, exist_ok=True)
    (revision_path / "opportunity-preview-revision.ts").write_text(
        'export const satellitePreviewRevision = "htest";\n',
        encoding="utf-8",
    )

    preview_dir = tmp_path / "artifacts" / "opportunity-card-satellite" / "images"
    static_dir = tmp_path / "apps" / "web" / "public" / "opportunity-card-satellite"
    preview_dir.mkdir(parents=True, exist_ok=True)
    static_dir.mkdir(parents=True, exist_ok=True)
    (preview_dir / "expired-opportunity_htest.jpg").write_bytes(b"preview")
    (static_dir / "expired-opportunity_htest.jpg").write_bytes(b"static")

    monkeypatch.setattr("arch_competition_ops.operations.date", _FakeDate)
    _FakeDate.today_value = date(2026, 5, 13)

    result = cleanup_expired_competitions(settings, retention_days=7, limit=20)

    assert result.attempted == 1
    assert result.deleted_competitions == 1
    assert result.deleted_preview_files == 1
    assert result.deleted_static_preview_files == 1
    assert not (preview_dir / "expired-opportunity_htest.jpg").exists()
    assert not (static_dir / "expired-opportunity_htest.jpg").exists()


def test_cleanup_expired_competitions_once_per_day_writes_state_and_skips_second_run(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(root=tmp_path)
    monkeypatch.setattr("arch_competition_ops.operations.date", _FakeDate)
    _FakeDate.today_value = date(2026, 5, 13)

    calls: list[tuple[int | None, int]] = []

    def fake_cleanup(settings_arg, *, retention_days, limit):
        calls.append((retention_days, limit))
        return type(
            "Result",
            (),
            {
                "attempted": 2,
                "deleted_competitions": 2,
                "deleted_preview_files": 1,
                "deleted_static_preview_files": 3,
                "skipped": 0,
                "last_run_date": None,
            },
        )()

    monkeypatch.setattr("arch_competition_ops.operations.cleanup_expired_competitions", fake_cleanup)

    first = cleanup_expired_competitions_once_per_day(settings, retention_days=7, limit=50)
    second = cleanup_expired_competitions_once_per_day(settings, retention_days=7, limit=50)

    assert len(calls) == 1
    assert first.deleted_competitions == 2
    assert first.last_run_date == "2026-05-13"
    assert second.deleted_competitions == 0
    assert second.last_run_date == "2026-05-13"

    state_path = settings.resolve_path(settings.expired_cleanup_state)
    payload = json.loads(state_path.read_text(encoding="utf-8"))
    assert payload["last_run_date"] == "2026-05-13"
    assert payload["deleted_competitions"] == 2


class _FakeDate(date):
    today_value = date(2026, 5, 13)

    @classmethod
    def today(cls):
        return cls.today_value
