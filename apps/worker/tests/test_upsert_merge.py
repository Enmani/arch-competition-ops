"""Re-ingesting an opportunity must never destroy what people or earlier runs established."""

from __future__ import annotations

import sqlite3
from datetime import date

import pytest

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers.keys import build_competition_key
from arch_competition_ops.storage import (
    ensure_schema,
    update_competition_status,
    upsert_competition,
    upsert_competitions,
)
from arch_competition_ops.storage.merge import merge_evidence_note, merge_status


def _record(**overrides) -> CompetitionRecord:
    values = {
        "title": "Civic Library Design Services",
        "organizer": "Comune di Parma",
        "authority_name": "Comune di Parma",
        "source_id": "src",
        "source_name": "Source",
        "source_url": "https://platform.example/notice/1",
        "official_notice_id": "N-1",
        "deadline_at": date(2026, 9, 1),
        "official_url": "https://parma.example/notice/1",
        "evidence_note": "Parsed from Source.",
    }
    values.update(overrides)
    return CompetitionRecord(**values)


def _row(db_path, competition_id: str) -> sqlite3.Row:
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        return connection.execute(
            "SELECT * FROM competitions WHERE id = ?", (competition_id,)
        ).fetchone()


def _count(db_path) -> int:
    with sqlite3.connect(db_path) as connection:
        return connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0]


@pytest.fixture
def db_path(tmp_path):
    path = tmp_path / "competitions.sqlite"
    ensure_schema(path)
    return path


# -- identity -------------------------------------------------------------------------------------


def test_id_is_stable_when_the_deadline_is_corrected(db_path) -> None:
    first = upsert_competition(db_path, _record(deadline_at=date(2026, 9, 1)))
    second = upsert_competition(db_path, _record(deadline_at=date(2026, 9, 15)))

    assert first == second
    assert _count(db_path) == 1
    assert _row(db_path, first)["deadline_at"] == "2026-09-15"


def test_same_platform_same_title_different_buyers_do_not_collide(db_path) -> None:
    parma = upsert_competition(
        db_path, _record(official_notice_id="N-1", organizer="Comune di Parma")
    )
    turin = upsert_competition(
        db_path,
        _record(
            official_notice_id="N-2",
            organizer="Comune di Torino",
            authority_name="Comune di Torino",
        ),
    )

    assert parma != turin
    assert _count(db_path) == 2
    assert _row(db_path, parma)["organizer"] == "Comune di Parma"
    assert _row(db_path, turin)["organizer"] == "Comune di Torino"


def test_notice_without_id_is_identified_by_its_source_url(db_path) -> None:
    a = upsert_competition(
        db_path, _record(official_notice_id=None, source_url="https://platform.example/a")
    )
    b = upsert_competition(
        db_path, _record(official_notice_id=None, source_url="https://platform.example/b")
    )
    a_again = upsert_competition(
        db_path, _record(official_notice_id=None, source_url="https://platform.example/a")
    )

    assert a != b
    assert a == a_again
    assert _count(db_path) == 2


def test_title_correction_keeps_the_existing_row_when_the_notice_id_matches(db_path) -> None:
    original = upsert_competition(db_path, _record(title="Civic Library Design Servces"))
    corrected = upsert_competition(db_path, _record(title="Civic Library Design Services"))

    assert corrected == original
    assert _count(db_path) == 1
    assert _row(db_path, original)["title"] == "Civic Library Design Services"


def test_rows_written_by_the_old_id_scheme_keep_their_id_and_user_state(db_path) -> None:
    legacy_id = build_competition_key("Civic Library Design Services", "Source", "2026-09-01")
    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "INSERT INTO competitions (id, dedup_key, title, organizer, source_id, source_name,"
            " source_url, status, opportunity_type, regions, languages, competition_types, audience,"
            " cpv_codes, extraction_confidence, evidence_level, discovered_at, updated_at)"
            " VALUES (?, ?, 'Civic Library Design Services', 'Source', 'src', 'Source',"
            " 'https://platform.example/old', 'shortlisted', 'unknown', '[]', '[]', '[]', '[]', '[]',"
            " 0.78, 'secondary', 'earlier', 'earlier')",
            (legacy_id, legacy_id),
        )
        connection.execute(
            "INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at,"
            " updated_at) VALUES ('w', ?, 'x', 'x')",
            (legacy_id,),
        )
        connection.commit()

    stored_id = upsert_competition(db_path, _record(official_notice_id=None))

    assert stored_id == legacy_id  # bookmarks and the watchlist entry still resolve
    assert _count(db_path) == 1
    row = _row(db_path, legacy_id)
    assert row["status"] == "shortlisted"
    assert row["organizer"] == "Comune di Parma"  # now the real buyer, not the platform


def test_non_ascii_titles_make_url_safe_readable_ids(db_path) -> None:
    competition_id = upsert_competition(
        db_path, _record(title="建筑设计 — Öffentliche Bibliothek", official_notice_id="GG/2026 #7")
    )

    title_slug, source, token = competition_id.split("__")
    assert (source, token) == ("src", "gg-2026-7")
    assert title_slug == "建筑设计-offentliche-bibliothek"
    assert competition_id == competition_id.lower()
    assert all(char.isalnum() or char in "-_" for char in competition_id)


def test_long_titles_are_truncated_in_the_id(db_path) -> None:
    competition_id = upsert_competition(db_path, _record(title="Very long title " * 20))

    assert len(competition_id.split("__")[0]) <= 60


# -- status and field-level merge -----------------------------------------------------------------


@pytest.mark.parametrize("protected", ["shortlisted", "verified", "discarded", "archived"])
def test_reingest_does_not_reset_a_decided_status(db_path, protected) -> None:
    competition_id = upsert_competition(db_path, _record())
    update_competition_status(db_path, competition_id=competition_id, status=protected)

    upsert_competition(db_path, _record(status="discovered"))

    assert _row(db_path, competition_id)["status"] == protected


def test_discovered_rows_can_move_to_archived_when_the_source_reports_an_award(db_path) -> None:
    competition_id = upsert_competition(db_path, _record(status="discovered"))

    upsert_competition(db_path, _record(status="archived"))

    assert _row(db_path, competition_id)["status"] == "archived"


def test_a_decided_status_is_not_changed_even_by_an_archived_signal(db_path) -> None:
    competition_id = upsert_competition(db_path, _record())
    update_competition_status(db_path, competition_id=competition_id, status="shortlisted")

    upsert_competition(db_path, _record(status="archived"))

    assert _row(db_path, competition_id)["status"] == "shortlisted"


def test_status_transition_table() -> None:
    assert merge_status(None, "verified") == "verified"
    assert merge_status("discovered", "archived") == "archived"
    assert merge_status("archived", "discovered") == "archived"
    assert merge_status("discarded", "discovered") == "discarded"
    assert merge_status("legacy-unknown-value", "discovered") == "legacy-unknown-value"


def test_empty_values_never_erase_stored_evidence(db_path) -> None:
    competition_id = upsert_competition(
        db_path,
        _record(
            prize_summary="CHF 100 000",
            estimated_contract_value_eur=250000.0,
            cpv_codes=["71200000"],
            licensed_architect_required=True,
            documents_portal_url="https://docs.example/1",
            geo_lat=47.1,
            geo_lng=8.2,
            geo_source="nominatim",
            geo_confidence=0.9,
            location_label="Parma",
        ),
    )

    upsert_competition(
        db_path,
        _record(official_url=None, evidence_note=None, authority_name=None, organizer=""),
    )

    row = _row(db_path, competition_id)
    assert row["official_url"] == "https://parma.example/notice/1"
    assert row["evidence_note"] == "Parsed from Source."
    assert row["prize_summary"] == "CHF 100 000"
    assert row["estimated_contract_value_eur"] == 250000.0
    assert row["cpv_codes"] == '["71200000"]'
    assert row["licensed_architect_required"] == 1
    assert row["documents_portal_url"] == "https://docs.example/1"
    assert (row["geo_lat"], row["geo_lng"], row["geo_source"]) == (47.1, 8.2, "nominatim")
    assert row["authority_name"] == "Comune di Parma"
    assert row["organizer"] == "Comune di Parma"


def test_new_non_empty_values_replace_old_ones(db_path) -> None:
    competition_id = upsert_competition(db_path, _record(estimated_contract_value_eur=1.0))

    upsert_competition(
        db_path,
        _record(estimated_contract_value_eur=2.0, source_url="https://platform.example/moved"),
    )

    row = _row(db_path, competition_id)
    assert row["estimated_contract_value_eur"] == 2.0
    assert row["source_url"] == "https://platform.example/moved"


def test_conflicting_official_url_is_kept_and_recorded_once(db_path) -> None:
    competition_id = upsert_competition(db_path, _record())
    conflicting = _record(official_url="https://aggregator.example/copy")

    upsert_competition(db_path, conflicting)
    upsert_competition(db_path, conflicting)  # repeating the same disagreement adds nothing

    row = _row(db_path, competition_id)
    assert row["official_url"] == "https://parma.example/notice/1"
    note_lines = row["evidence_note"].split("\n")
    assert note_lines[0] == "Parsed from Source."
    assert len(note_lines) == 2
    assert "conflict" in note_lines[1]
    assert "https://aggregator.example/copy" in note_lines[1]


def test_official_url_can_be_filled_in_later(db_path) -> None:
    competition_id = upsert_competition(db_path, _record(official_url=None))

    upsert_competition(db_path, _record())

    assert _row(db_path, competition_id)["official_url"] == "https://parma.example/notice/1"


def test_evidence_level_is_never_downgraded(db_path) -> None:
    competition_id = upsert_competition(db_path, _record(evidence_level="official_notice"))

    upsert_competition(db_path, _record(evidence_level="official_listing"))

    assert _row(db_path, competition_id)["evidence_level"] == "official_notice"


def test_discovered_at_is_kept_and_updated_at_moves(db_path) -> None:
    competition_id = upsert_competition(db_path, _record())
    before = _row(db_path, competition_id)

    upsert_competition(db_path, _record(discovered_at=_record().discovered_at.replace(year=2030)))

    after = _row(db_path, competition_id)
    assert after["discovered_at"] == before["discovered_at"]
    assert after["updated_at"] >= before["updated_at"]


def test_evidence_note_history_is_bounded() -> None:
    existing = "latest\n" + "\n".join(f"old-{index}" for index in range(30))

    merged = merge_evidence_note(existing, "newer", [])

    assert merged.split("\n")[0] == "newer"
    assert len(merged.split("\n")) == 10


def test_batch_upsert_is_all_or_nothing(db_path) -> None:
    good = _record()
    bad = _record(official_notice_id="N-2")
    bad.regions = object()  # not JSON-serializable: fails while the batch is open

    with pytest.raises(TypeError):
        upsert_competitions(db_path, [good, bad])

    assert _count(db_path) == 0
