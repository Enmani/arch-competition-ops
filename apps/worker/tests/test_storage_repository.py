from __future__ import annotations

import sqlite3
from datetime import date, timedelta

from arch_competition_ops import clock
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.storage import (
    competition_is_stale_expired,
    delete_competitions,
    ensure_schema,
    list_competitions,
    list_competitions_missing_geocodes,
    list_expired_competition_ids,
    list_source_records,
    update_competition_geocode_fields,
    update_competition_source_url,
    update_competition_status,
    upsert_competition,
)


def _rows(db_path, sql: str, *parameters):
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        return connection.execute(sql, parameters).fetchall()


def test_upsert_and_list_round_trip(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)

    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Test Competition",
            organizer="Test Organizer",
            source_id="test_source",
            source_name="Test Source",
            source_url="https://example.com/listing",
            official_url="https://example.com/official",
            official_notice_id="N 42/2026",
            estimated_contract_value_text="GBP 1,000,000",
            documents_portal_url="https://example.com/docs",
            location_label="Maur",
            geo_lat=47.3407,
            geo_lng=8.671,
            geo_source="nominatim",
            geo_confidence=0.91,
            deadline_at=date(2026, 8, 1),
        ),
    )

    rows = list_competitions(db_path, limit=5)

    # {title slug}__{source_id}__{normalized notice id}; the deadline is not part of identity.
    assert competition_id == "test-competition__test_source__n-42-2026"
    assert len(rows) == 1
    assert rows[0]["title"] == "Test Competition"

    row = _rows(
        db_path,
        "SELECT estimated_contract_value_text, location_label, geo_lat, geo_lng, geo_source,"
        " geo_confidence, source_id, source_name, deadline_at, registration_fee_eur"
        " FROM competitions WHERE id = ?",
        competition_id,
    )[0]
    assert tuple(row) == (
        "GBP 1,000,000",
        "Maur",
        47.3407,
        8.671,
        "nominatim",
        0.91,
        "test_source",
        "Test Source",
        "2026-08-01",
        None,
    )


def test_update_geocode_fields_updates_only_location_columns(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Extension du complexe sportif et de loisirs Looren, 8124 Maur",
            authority_name="Gemeindeverwaltung Maur",
            source_url="https://example.com/maur",
            jurisdiction="switzerland",
            deadline_at=date(2026, 8, 1),
        ),
    )

    assert [row["id"] for row in list_competitions_missing_geocodes(db_path, limit=5)] == [
        competition_id
    ]

    update_competition_geocode_fields(
        db_path,
        competition_id=competition_id,
        location_label="Maur",
        geo_lat=47.3407,
        geo_lng=8.671,
        geo_source="nominatim",
        geo_confidence=0.91,
    )

    row = _rows(
        db_path,
        "SELECT title, location_label, geo_lat, geo_lng, geo_source, geo_confidence"
        " FROM competitions WHERE id = ?",
        competition_id,
    )[0]
    assert row["title"] == "Extension du complexe sportif et de loisirs Looren, 8124 Maur"
    assert (row["location_label"], row["geo_lat"], row["geo_lng"]) == ("Maur", 47.3407, 8.671)
    assert (row["geo_source"], row["geo_confidence"]) == ("nominatim", 0.91)
    assert list_competitions_missing_geocodes(db_path, limit=5) == []


def test_missing_geocode_rows_prioritize_visible_upcoming_deadlines(tmp_path) -> None:
    """Ordering is relative to the injected clock, so it holds on any real date."""
    db_path = tmp_path / "competitions.sqlite"
    today = clock.today()
    undated_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Undated planning services", source_url="https://example.com/undated"
        ),
    )
    upcoming_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Proyecto y dirección de obra de Fuentespalda",
            source_url="https://example.com/upcoming",
            deadline_at=today,
        ),
    )
    expired_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Expired planning services",
            source_url="https://example.com/expired",
            deadline_at=today - timedelta(days=1),
        ),
    )

    missing_rows = list_competitions_missing_geocodes(db_path, limit=3)

    assert [row["id"] for row in missing_rows] == [upcoming_id, undated_id, expired_id]
    # The reference day is a parameter: moving the clock moves the boundary.
    later = list_competitions_missing_geocodes(db_path, limit=3, today=today + timedelta(days=5))
    assert [row["id"] for row in later] == [undated_id, expired_id, upcoming_id]


def test_cleanup_deletes_opportunities_but_never_user_data_or_audit_history(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)
    today = clock.today()
    expired_id = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="expired-opportunity",
            title="Expired opportunity",
            source_url="https://example.com/expired",
            deadline_at=today - timedelta(days=12),
        ),
    )
    watched_id = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="expired-but-watched",
            title="Expired but watched",
            source_url="https://example.com/watched",
            deadline_at=today - timedelta(days=12),
        ),
    )
    active_id = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="active-opportunity",
            title="Active opportunity",
            source_url="https://example.com/active",
            deadline_at=today + timedelta(days=7),
        ),
    )

    with sqlite3.connect(db_path) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute(
            "INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at,"
            " updated_at) VALUES ('workspace', ?, 'then', 'then')",
            (watched_id,),
        )
        connection.execute(
            "INSERT INTO ops_review_queue_items (queue_id, origin, reason_code, status, priority,"
            " title, summary, payload_json, is_active, first_detected_at, last_detected_at,"
            " updated_at, competition_id) VALUES ('queue-expired', 'worker_diagnostic',"
            " 'duplicate_candidate', 'pending', 1, 't', 's', '{}', 1, 'x', 'x', 'x', ?)",
            (expired_id,),
        )
        connection.execute(
            "INSERT INTO ops_review_decisions (queue_id, decision, actor_label, created_at)"
            " VALUES ('queue-expired', 'accepted', 'tester', 'then')"
        )
        connection.commit()

    threshold = today - timedelta(days=7)
    # Watchlisted opportunities are not offered for deletion in the first place ...
    assert list_expired_competition_ids(db_path, expired_before=threshold, limit=10) == [expired_id]
    # ... and delete_competitions refuses to remove them even when asked directly.
    assert delete_competitions(db_path, competition_ids=[expired_id, watched_id]) == 1

    remaining_ids = {row["id"] for row in _rows(db_path, "SELECT id FROM competitions")}
    assert remaining_ids == {watched_id, active_id}
    assert [
        row[0] for row in _rows(db_path, "SELECT opportunity_id FROM workspace_watchlist_entries")
    ] == [watched_id]
    # The audit trail survives; it simply no longer points at a live opportunity.
    assert len(_rows(db_path, "SELECT 1 FROM ops_review_queue_items")) == 1
    assert len(_rows(db_path, "SELECT 1 FROM ops_review_decisions")) == 1


def test_competition_is_stale_expired_respects_retention_window() -> None:
    stale = CompetitionRecord(title="s", source_url="https://e/s", deadline_at=date(2026, 5, 1))
    fresh = CompetitionRecord(title="f", source_url="https://e/f", deadline_at=date(2026, 5, 10))

    assert competition_is_stale_expired(stale, retention_days=7, today=date(2026, 5, 13)) is True
    assert competition_is_stale_expired(fresh, retention_days=7, today=date(2026, 5, 13)) is False


def test_competition_is_stale_expired_uses_the_injected_clock_by_default() -> None:
    record = CompetitionRecord(
        title="r", source_url="https://e/r", deadline_at=clock.today() - timedelta(days=8)
    )

    assert competition_is_stale_expired(record, retention_days=7) is True
    assert competition_is_stale_expired(record, retention_days=9) is False


def test_list_source_records_filters_by_source_id_not_by_display_name(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    mine = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Mine",
            source_id="anac_bdncp_contracts",
            source_name="Renamed in YAML",
            official_notice_id="A-1",
            source_url="https://anac.example/a1",
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            title="Other source, same display name",
            source_id="other",
            source_name="Renamed in YAML",
            official_notice_id="B-1",
            source_url="https://other.example/b1",
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            title="No notice id",
            source_id="anac_bdncp_contracts",
            source_url="https://anac.example/x",
        ),
    )

    rows = list_source_records(db_path, "anac_bdncp_contracts", require_notice_id=True)
    assert [row["id"] for row in rows] == [mine]
    assert len(list_source_records(db_path, "anac_bdncp_contracts")) == 2
    assert (
        list_source_records(
            db_path,
            "anac_bdncp_contracts",
            exclude_source_url_prefixes=("https://anac.example/a",),
        )[0]["title"]
        == "No notice id"
    )


def test_update_status_and_source_url_helpers(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    competition_id = upsert_competition(
        db_path, CompetitionRecord(title="T", source_url="https://example.com/old")
    )

    update_competition_source_url(
        db_path, competition_id=competition_id, source_url="https://example.com/new"
    )
    assert update_competition_status(db_path, competition_id=competition_id, status="archived")

    row = _rows(db_path, "SELECT source_url, status FROM competitions")[0]
    assert (row["source_url"], row["status"]) == ("https://example.com/new", "archived")


def test_update_status_only_from_protects_human_decisions(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(title="T", source_url="https://example.com/t", status="shortlisted"),
    )

    changed = update_competition_status(
        db_path, competition_id=competition_id, status="discarded", only_from=("discovered",)
    )

    assert changed is False
    assert _rows(db_path, "SELECT status FROM competitions")[0]["status"] == "shortlisted"
