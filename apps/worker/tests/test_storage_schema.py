from __future__ import annotations

import sqlite3

import pytest
from legacy_schema import create_legacy_competitions_table, insert_legacy_row
from support import write_source_catalog

import arch_competition_ops.storage.schema as schema_module
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.diagnostics import run_doctor
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    connect,
    ensure_schema,
    migrate_legacy_source_identity,
    reset_schema_cache,
    upsert_competition,
    write_transaction,
)


def _columns(db_path, table: str) -> set[str]:
    with sqlite3.connect(db_path) as connection:
        return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def test_ensure_schema_upgrades_legacy_table_in_place(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    create_legacy_competitions_table(db_path)
    insert_legacy_row(
        db_path,
        competition_id="legacy-row",
        title="Legacy Competition",
        organizer="Legacy Organizer",
        source_url="https://example.com/legacy",
    )

    ensure_schema(db_path)

    columns = _columns(db_path, "competitions")
    assert {
        "documents_portal_url",
        "estimated_contract_value_text",
        "location_label",
        "geo_lat",
        "geo_lng",
        "geo_source",
        "geo_confidence",
        "source_id",
        "source_name",
    } <= columns
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT id, title, documents_portal_url, geo_lat, source_id FROM competitions"
        ).fetchone()
        indexes = {r[1] for r in connection.execute("PRAGMA index_list(competitions)")}
    assert (row["id"], row["title"]) == ("legacy-row", "Legacy Competition")
    assert row["documents_portal_url"] is None and row["geo_lat"] is None
    assert row["source_id"] is None
    assert {
        "idx_competitions_status_deadline",
        "idx_competitions_jurisdiction",
        "idx_competitions_discovered_at",
        "idx_competitions_contract_value",
    } <= indexes


def test_unsupported_schema_drift_is_reported(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    with sqlite3.connect(db_path) as connection:
        connection.execute("CREATE TABLE competitions (id TEXT PRIMARY KEY, title TEXT)")

    with pytest.raises(RuntimeError, match="non-additive columns"):
        ensure_schema(db_path)


def test_ensure_schema_creates_source_diagnostics_and_workspace_tables(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"

    ensure_schema(db_path)

    assert {"source_id", "source_name", "status", "document_count", "last_error"} <= _columns(
        db_path, "source_runs"
    )
    assert {"source_id", "last_status", "last_success_at", "updated_at"} <= _columns(
        db_path, "source_health"
    )
    assert {"workspace_key", "name", "filters_json"} <= _columns(
        db_path, "workspace_saved_searches"
    )
    assert {"workspace_key", "opportunity_id"} <= _columns(db_path, "workspace_watchlist_entries")
    with sqlite3.connect(db_path) as connection:
        watchlist_indexes = connection.execute(
            "PRAGMA index_list(workspace_watchlist_entries)"
        ).fetchall()
    assert any(row[2] == 1 for row in watchlist_indexes)  # UNIQUE(workspace_key, opportunity_id)


def test_ensure_schema_backfills_watchlist_uniqueness_on_legacy_workspace_table(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    create_legacy_competitions_table(db_path)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "CREATE TABLE workspace_watchlist_entries (id INTEGER PRIMARY KEY AUTOINCREMENT,"
            " workspace_key TEXT NOT NULL, opportunity_id TEXT NOT NULL, created_at TEXT NOT NULL,"
            " updated_at TEXT NOT NULL)"
        )
        for stamp in ("2026-04-18T00:00:00+00:00", "2026-04-19T00:00:00+00:00"):
            connection.execute(
                "INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id,"
                " created_at, updated_at) VALUES ('local_practice', 'italy-library', ?, ?)",
                (stamp, stamp),
            )
        connection.commit()

    ensure_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        rows = connection.execute("SELECT updated_at FROM workspace_watchlist_entries").fetchall()
        unique = [
            r for r in connection.execute("PRAGMA index_list(workspace_watchlist_entries)") if r[2]
        ]
    assert rows == [("2026-04-19T00:00:00+00:00",)]
    assert unique


def test_ensure_schema_runs_once_per_database_path(tmp_path, monkeypatch) -> None:
    db_path = tmp_path / "competitions.sqlite"
    applied: list[str] = []
    real_apply = schema_module._apply_schema
    monkeypatch.setattr(
        schema_module, "_apply_schema", lambda path: applied.append(str(path)) or real_apply(path)
    )

    ensure_schema(db_path)
    ensure_schema(db_path)
    upsert_competition(db_path, CompetitionRecord(title="T", source_url="https://example.com/t"))
    upsert_competition(db_path, CompetitionRecord(title="U", source_url="https://example.com/u"))
    assert len(applied) == 1

    reset_schema_cache()
    ensure_schema(db_path)
    assert len(applied) == 2

    db_path.unlink()  # a replaced/deleted file is noticed instead of trusting the cache
    ensure_schema(db_path)
    assert len(applied) == 3


def test_every_connection_gets_wal_busy_timeout_and_foreign_keys(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"

    with connect(db_path) as connection:
        assert connection.execute("PRAGMA journal_mode").fetchone()[0] == "wal"
        assert connection.execute("PRAGMA busy_timeout").fetchone()[0] == 15_000
        assert connection.execute("PRAGMA foreign_keys").fetchone()[0] == 1


def test_connect_really_closes_the_connection(tmp_path) -> None:
    with connect(tmp_path / "competitions.sqlite") as connection:
        pass

    with pytest.raises(sqlite3.ProgrammingError, match="closed"):
        connection.execute("SELECT 1")


def test_write_transaction_rolls_back_everything_on_error(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)

    with pytest.raises(RuntimeError, match="boom"), write_transaction(db_path) as connection:
        connection.execute(
            "INSERT INTO workspace_saved_searches (workspace_key, name, filters_json, created_at,"
            " updated_at) VALUES ('w', 'n', '{}', 'x', 'x')"
        )
        raise RuntimeError("boom")

    with connect(db_path) as connection:
        assert (
            connection.execute("SELECT COUNT(*) FROM workspace_saved_searches").fetchone()[0] == 0
        )


def test_second_writer_waits_for_the_first_instead_of_failing_immediately(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)

    with write_transaction(db_path):
        other = sqlite3.connect(db_path, timeout=0.05, isolation_level=None)
        try:
            with pytest.raises(sqlite3.OperationalError, match="locked"):
                other.execute("BEGIN IMMEDIATE")
        finally:
            other.close()


def test_run_doctor_initializes_source_diagnostics_schema(tmp_path) -> None:
    write_source_catalog(tmp_path)
    (tmp_path / "config" / "filters.yml").write_text("targeting: {}\n", encoding="utf-8")
    (tmp_path / "config" / "taxonomy.yml").write_text(
        "\n".join(
            f"{key}: []"
            for key in (
                "regions languages source_kinds source_tiers scan_methods competition_statuses"
                " competition_types opportunity_types procedure_types implementation_paths"
                " evidence_levels audience project_types building_categories"
            ).split()
        )
        + "\n",
        encoding="utf-8",
    )
    settings = Settings(root=tmp_path)

    results = run_doctor(settings)

    assert all(result.ok for result in results), [r for r in results if not r.ok]
    assert {"source_id", "source_name", "last_status"} <= _columns(
        settings.resolve_path(settings.db), "source_health"
    )


def test_legacy_rows_are_attributed_to_their_source_and_scrubbed(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO competitions (id, dedup_key, title, organizer, authority_name, official_url,"
            " source_url, status, opportunity_type, regions, languages, competition_types, audience,"
            " cpv_codes, implementation_path, licensed_architect_required, eligibility_summary, registration_fee_eur,"
            " submission_fee_eur, extraction_confidence, evidence_level, discovered_at, updated_at)"
            " VALUES ('old-id', 'k', 'Old', 'ANAC BDNCP', 'Comune di Ravenna',"
            " 'https://anac.example/notice', 'https://anac.example/notice', 'shortlisted',"
            " 'unknown', '[]', '[]', '[]', '[\"professionals\"]', '[]', 'made_up_path', 1, 'Servizi di architettura', 0.0, 0.0,"
            " 0.78, 'secondary', 'then', 'then')"
        )
        connection.commit()

    migrated = migrate_legacy_source_identity(
        db_path, [("anac_bdncp_contracts", "ANAC BDNCP", True)]
    )
    again = migrate_legacy_source_identity(db_path, [("anac_bdncp_contracts", "ANAC BDNCP", True)])

    assert (migrated, again) == (1, 0)
    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute("SELECT * FROM competitions WHERE id = 'old-id'").fetchone()
    assert (row["source_id"], row["source_name"]) == ("anac_bdncp_contracts", "ANAC BDNCP")
    assert row["organizer"] == "Comune di Ravenna"  # the buyer, not the platform
    assert row["status"] == "shortlisted"  # human decisions are untouched
    assert row["registration_fee_eur"] is None and row["submission_fee_eur"] is None
    assert row["audience"] == "[]"
    assert row["implementation_path"] is None and row["licensed_architect_required"] is None
    assert row["official_url"] is None  # it only repeated source_url
    assert row["eligibility_summary"] is None  # it was the project description


def test_initialize_database_attributes_legacy_rows_using_the_catalog(tmp_path) -> None:
    write_source_catalog(tmp_path, "ted_design_notices")
    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    ensure_schema(db_path)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            "INSERT INTO competitions (id, dedup_key, title, organizer, source_url, status,"
            " opportunity_type, regions, languages, competition_types, audience, cpv_codes,"
            " extraction_confidence, evidence_level, discovered_at, updated_at) VALUES"
            " ('old', 'k', 'Old', 'TED Design and Procurement Notices', 'https://ted.example/o',"
            " 'discovered', 'unknown', '[]', '[]', '[]', '[]', '[]', 0.78, 'secondary', 'x', 'x')"
        )
        connection.commit()

    initialize_database(settings)

    with sqlite3.connect(db_path) as connection:
        assert (
            connection.execute("SELECT source_id FROM competitions").fetchone()[0]
            == "ted_design_notices"
        )


def test_legacy_eligibility_is_kept_where_it_may_be_a_genuine_clause(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)
    with sqlite3.connect(db_path) as connection:
        for identifier, organizer in (("a", "Source A"), ("b", "Source B")):
            connection.execute(
                "INSERT INTO competitions (id, dedup_key, title, organizer, source_url, status,"
                " opportunity_type, regions, languages, competition_types, audience, cpv_codes,"
                " eligibility_summary, extraction_confidence, evidence_level, discovered_at,"
                " updated_at) VALUES (?, 'k', 'T', ?, 'https://e/x', 'discovered', 'unknown', '[]',"
                " '[]', '[]', '[]', '[]', 'Requisiti: iscrizione all albo', 0.78, 'secondary', 'x',"
                " 'x')",
                (identifier, organizer),
            )
        connection.commit()

    migrate_legacy_source_identity(
        db_path, [("source_a", "Source A", True), ("source_b", "Source B", False)]
    )

    with sqlite3.connect(db_path) as connection:
        stored = dict(connection.execute("SELECT id, eligibility_summary FROM competitions"))
    assert stored == {"a": None, "b": "Requisiti: iscrizione all albo"}
