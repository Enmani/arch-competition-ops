import sqlite3
from datetime import date

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.operations import run_doctor
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    competition_is_stale_expired,
    delete_competitions,
    ensure_schema,
    list_anac_status_candidates,
    list_anac_source_trace_candidates,
    list_competitions,
    list_competitions_missing_geocodes,
    list_expired_competition_ids,
    restore_legacy_competitions,
    update_competition_status,
    update_competition_source_url,
    update_competition_geocode_fields,
    upsert_competition,
)


LEGACY_SCHEMA_SQL = """
CREATE TABLE competitions (
    id TEXT PRIMARY KEY,
    dedup_key TEXT NOT NULL,
    title TEXT NOT NULL,
    organizer TEXT NOT NULL,
    authority_name TEXT,
    official_url TEXT,
    source_url TEXT NOT NULL,
    status TEXT NOT NULL,
    opportunity_type TEXT NOT NULL,
    jurisdiction TEXT,
    procedure_type TEXT,
    official_notice_id TEXT,
    regions TEXT NOT NULL,
    languages TEXT NOT NULL,
    competition_types TEXT NOT NULL,
    project_types TEXT NOT NULL DEFAULT '[]',
    building_categories TEXT NOT NULL DEFAULT '[]',
    official_sectors TEXT NOT NULL DEFAULT '[]',
    built_asset_types TEXT NOT NULL DEFAULT '[]',
    design_scopes TEXT NOT NULL DEFAULT '[]',
    project_modes TEXT NOT NULL DEFAULT '[]',
    audience TEXT NOT NULL,
    cpv_codes TEXT NOT NULL,
    implementation_path TEXT,
    licensed_architect_required INTEGER,
    local_partner_required INTEGER,
    registration_fee_eur REAL,
    submission_fee_eur REAL,
    estimated_contract_value_eur REAL,
    prize_summary TEXT,
    deadline_at TEXT,
    eligibility_summary TEXT,
    brief_pdf_url TEXT,
    extraction_confidence REAL NOT NULL,
    evidence_level TEXT NOT NULL,
    qualification_score REAL,
    evidence_note TEXT,
    last_verified_at TEXT,
    discovered_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"""

LEGACY_INSERT_SQL = """
INSERT INTO competitions (
    id, dedup_key, title, organizer, authority_name, official_url, source_url, status,
    opportunity_type, jurisdiction, procedure_type, official_notice_id, regions, languages,
    competition_types, audience, cpv_codes, implementation_path, licensed_architect_required,
    local_partner_required, registration_fee_eur, submission_fee_eur, estimated_contract_value_eur,
    prize_summary, deadline_at, eligibility_summary, brief_pdf_url, extraction_confidence,
    evidence_level, qualification_score, evidence_note, last_verified_at, discovered_at, updated_at
) VALUES (
    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
)
"""


def _create_legacy_competitions_table(db_path, *, table_name: str = "competitions") -> None:
    with sqlite3.connect(db_path) as connection:
        connection.executescript(
            LEGACY_SCHEMA_SQL.replace("CREATE TABLE competitions", f"CREATE TABLE {table_name}")
        )
        connection.commit()


def _insert_legacy_row(
    db_path,
    *,
    table_name: str = "competitions",
    competition_id: str,
    title: str,
    organizer: str,
    source_url: str,
    official_url: str | None = None,
) -> None:
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            LEGACY_INSERT_SQL.replace("INSERT INTO competitions", f"INSERT INTO {table_name}"),
            (
                competition_id,
                competition_id,
                title,
                organizer,
                None,
                official_url,
                source_url,
                "verified",
                "public_design_contest",
                "germany",
                "design_contest",
                None,
                "[]",
                "[]",
                "[]",
                "[]",
                "[]",
                None,
                1,
                0,
                0.0,
                0.0,
                1_000_000.0,
                None,
                "2026-08-01",
                None,
                None,
                0.9,
                "official_notice",
                0.9,
                None,
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
            ),
        )
        connection.commit()


def test_upsert_and_list_round_trip(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)

    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Test Competition",
            organizer="Test Organizer",
            source_url="https://example.com/listing",
            official_url="https://example.com/official",
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

    assert competition_id == "test-competition__test-organizer__2026-08-01"
    assert len(rows) == 1
    assert rows[0]["title"] == "Test Competition"

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            """
            SELECT estimated_contract_value_text, location_label, geo_lat, geo_lng, geo_source,
                   geo_confidence
            FROM competitions
            WHERE id = ?
            """,
            (competition_id,),
        ).fetchone()

    assert row[0] == "GBP 1,000,000"
    assert row[1] == "Maur"
    assert row[2] == 47.3407
    assert row[3] == 8.671
    assert row[4] == "nominatim"
    assert row[5] == 0.91


def test_ensure_schema_upgrades_legacy_table_in_place(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    _create_legacy_competitions_table(db_path)
    _insert_legacy_row(
        db_path,
        competition_id="legacy-row",
        title="Legacy Competition",
        organizer="Legacy Organizer",
        source_url="https://example.com/legacy",
    )

    ensure_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(competitions)").fetchall()
        }
        legacy_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='competitions_legacy'"
        ).fetchone()
        row = connection.execute(
            "SELECT id, title, documents_portal_url, geo_lat FROM competitions WHERE id = ?",
            ("legacy-row",),
        ).fetchone()

    assert "documents_portal_url" in columns
    assert "estimated_contract_value_text" in columns
    assert "location_label" in columns
    assert "geo_lat" in columns
    assert "geo_lng" in columns
    assert "geo_source" in columns
    assert "geo_confidence" in columns
    assert legacy_table is None
    assert row["id"] == "legacy-row"
    assert row["title"] == "Legacy Competition"
    assert row["documents_portal_url"] is None
    assert row["geo_lat"] is None


def test_update_geocode_fields_updates_only_location_columns(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Extension du complexe sportif et de loisirs Looren, 8124 Maur",
            organizer="SIMAP",
            authority_name="Gemeindeverwaltung Maur",
            source_url="https://example.com/maur",
            jurisdiction="switzerland",
            deadline_at=date(2026, 8, 1),
        ),
    )

    missing_rows = list_competitions_missing_geocodes(db_path, limit=5)
    assert [row["id"] for row in missing_rows] == [competition_id]

    update_competition_geocode_fields(
        db_path,
        competition_id=competition_id,
        location_label="Maur",
        geo_lat=47.3407,
        geo_lng=8.671,
        geo_source="nominatim",
        geo_confidence=0.91,
    )

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            """
            SELECT title, location_label, geo_lat, geo_lng, geo_source, geo_confidence
            FROM competitions
            WHERE id = ?
            """,
            (competition_id,),
        ).fetchone()

    assert row["title"] == "Extension du complexe sportif et de loisirs Looren, 8124 Maur"
    assert row["location_label"] == "Maur"
    assert row["geo_lat"] == 47.3407
    assert row["geo_lng"] == 8.671
    assert row["geo_source"] == "nominatim"
    assert row["geo_confidence"] == 0.91
    assert list_competitions_missing_geocodes(db_path, limit=5) == []


def test_anac_source_trace_storage_helpers_list_and_update_candidates(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Affidamento diretto dei servizi di progettazione per Villa Giulia",
            organizer="ANAC BDNCP",
            authority_name="MUSEO ETRUSCO DI VILLA GIULIA",
            source_url="https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82",
            official_url="https://www.museoetru.it/",
            official_notice_id="49320bc2-6c80-4bc7-80f0-1e6a7eaeea82",
            jurisdiction="italy",
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="already-public-anac",
            title="Servizi di architettura per la progettazione e direzione lavori di riqualificazione di Palazzo Trentini",
            organizer="ANAC BDNCP",
            authority_name="Provincia Autonoma di Trento",
            source_url="https://pubblicitalegale.anticorruzione.it/bandi/114d92b2-b36d-4bce-8d68-3f0a97693a5f?ricercaArchivio=true",
            official_url="https://example.it/gara/456",
            official_notice_id="114d92b2-b36d-4bce-8d68-3f0a97693a5f",
            jurisdiction="italy",
        ),
    )

    candidates = list_anac_source_trace_candidates(db_path, limit=10)

    assert [row["id"] for row in candidates] == [competition_id]

    update_competition_source_url(
        db_path,
        competition_id=competition_id,
        source_url="https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true",
    )

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT source_url FROM competitions WHERE id = ?",
            (competition_id,),
        ).fetchone()

    assert (
        row[0]
        == "https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true"
    )


def test_anac_status_storage_helpers_list_and_update_candidates(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    competition_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Affidamento diretto dei servizi di progettazione per Villa Giulia",
            organizer="ANAC BDNCP",
            authority_name="MUSEO ETRUSCO DI VILLA GIULIA",
            source_url="https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true",
            official_url="https://www.museoetru.it/",
            official_notice_id="49320bc2-6c80-4bc7-80f0-1e6a7eaeea82",
            jurisdiction="italy",
            status="discovered",
        ),
    )

    candidates = list_anac_status_candidates(db_path, limit=10)

    assert [row["id"] for row in candidates] == [competition_id]
    assert candidates[0]["status"] == "discovered"

    update_competition_status(
        db_path,
        competition_id=competition_id,
        status="archived",
    )

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT status FROM competitions WHERE id = ?",
            (competition_id,),
        ).fetchone()

    assert row[0] == "archived"


def test_missing_geocode_rows_prioritize_visible_upcoming_deadlines(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
    today = date(2026, 5, 13)
    undated_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Undated planning services",
            organizer="TED",
            source_url="https://example.com/undated",
            jurisdiction="france",
        ),
    )
    upcoming_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Proyecto y dirección de obra de Fuentespalda",
            organizer="PCSP",
            source_url="https://example.com/upcoming",
            jurisdiction="spain",
            deadline_at=today,
        ),
    )
    expired_id = upsert_competition(
        db_path,
        CompetitionRecord(
            title="Expired planning services",
            organizer="TED",
            source_url="https://example.com/expired",
            jurisdiction="italy",
            deadline_at=date(2024, 4, 24),
        ),
    )

    missing_rows = list_competitions_missing_geocodes(db_path, limit=3)

    assert [row["id"] for row in missing_rows] == [upcoming_id, undated_id, expired_id]


def test_list_expired_competition_ids_and_delete_competitions_cleanup_related_rows(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"
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
    active_id = upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="active-opportunity",
            title="Active opportunity",
            organizer="TED",
            source_url="https://example.com/active",
            deadline_at=date(2026, 5, 20),
        ),
    )

    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO workspace_watchlist_entries (
                workspace_key, opportunity_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?)
            """,
            ("workspace", expired_id, "2026-05-09T00:00:00+00:00", "2026-05-09T00:00:00+00:00"),
        )
        connection.execute(
            """
            INSERT INTO ops_review_queue_items (
                queue_id, origin, reason_code, status, priority, title, summary, payload_json,
                is_active, first_detected_at, last_detected_at, updated_at, competition_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "queue-expired",
                "worker_diagnostic",
                "duplicate_candidate",
                "pending",
                1,
                "Expired queue",
                "Expired queue item",
                "{}",
                1,
                "2026-05-09T00:00:00+00:00",
                "2026-05-09T00:00:00+00:00",
                "2026-05-09T00:00:00+00:00",
                expired_id,
            ),
        )
        connection.execute(
            """
            INSERT INTO ops_review_decisions (queue_id, decision, actor_label, note, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            ("queue-expired", "pending", "tester", None, "2026-05-09T00:00:00+00:00"),
        )
        connection.commit()

    expired_ids = list_expired_competition_ids(
        db_path,
        expired_before=date(2026, 5, 13),
        limit=10,
    )
    assert expired_ids == [expired_id]

    deleted = delete_competitions(db_path, competition_ids=[expired_id])
    assert deleted == 1

    with sqlite3.connect(db_path) as connection:
        remaining_competitions = connection.execute(
            "SELECT id FROM competitions ORDER BY id ASC"
        ).fetchall()
        remaining_watchlist = connection.execute(
            "SELECT opportunity_id FROM workspace_watchlist_entries"
        ).fetchall()
        remaining_queue = connection.execute(
            "SELECT competition_id FROM ops_review_queue_items"
        ).fetchall()
        remaining_decisions = connection.execute(
            "SELECT queue_id FROM ops_review_decisions"
        ).fetchall()

    assert [row[0] for row in remaining_competitions] == [active_id]
    assert remaining_watchlist == []
    assert remaining_queue == []
    assert remaining_decisions == []


def test_competition_is_stale_expired_respects_retention_window() -> None:
    stale_record = CompetitionRecord(
        title="Stale opportunity",
        organizer="TED",
        source_url="https://example.com/stale",
        deadline_at=date(2026, 5, 1),
    )
    fresh_record = CompetitionRecord(
        title="Fresh opportunity",
        organizer="TED",
        source_url="https://example.com/fresh",
        deadline_at=date(2026, 5, 10),
    )

    assert (
        competition_is_stale_expired(
            stale_record,
            retention_days=7,
            today=date(2026, 5, 13),
        )
        is True
    )
    assert (
        competition_is_stale_expired(
            fresh_record,
            retention_days=7,
            today=date(2026, 5, 13),
        )
        is False
    )


def test_ensure_schema_creates_source_diagnostics_tables(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"

    ensure_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        source_run_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(source_runs)").fetchall()
        }
        source_health_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(source_health)").fetchall()
        }

    assert {
        "source_id",
        "source_name",
        "status",
        "document_count",
        "upserted_count",
        "parse_failure_count",
        "duplicate_group_count",
        "max_duplicate_group_size",
        "last_error",
    }.issubset(source_run_columns)
    assert {
        "source_id",
        "source_name",
        "last_status",
        "last_run_started_at",
        "last_run_completed_at",
        "last_success_at",
        "last_document_count",
        "last_upserted_count",
        "last_parse_failure_count",
        "duplicate_group_count",
        "max_duplicate_group_size",
        "last_error",
    }.issubset(source_health_columns)


def test_ensure_schema_creates_workspace_tables(tmp_path) -> None:
    db_path = tmp_path / "competitions.sqlite"

    ensure_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        saved_search_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(workspace_saved_searches)"
            ).fetchall()
        }
        watchlist_columns = {
            row["name"]
            for row in connection.execute(
                "PRAGMA table_info(workspace_watchlist_entries)"
            ).fetchall()
        }
        watchlist_index_list = connection.execute(
            "PRAGMA index_list(workspace_watchlist_entries)"
        ).fetchall()

    assert {
        "workspace_key",
        "name",
        "filters_json",
        "created_at",
        "updated_at",
    }.issubset(saved_search_columns)
    assert {
        "workspace_key",
        "opportunity_id",
        "created_at",
        "updated_at",
    }.issubset(watchlist_columns)
    assert any(row["unique"] == 1 for row in watchlist_index_list)


def test_ensure_schema_backfills_watchlist_uniqueness_on_legacy_workspace_table(
    tmp_path,
) -> None:
    db_path = tmp_path / "competitions.sqlite"
    _create_legacy_competitions_table(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        connection.executescript(
            """
            CREATE TABLE workspace_watchlist_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                workspace_key TEXT NOT NULL,
                opportunity_id TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            """
        )
        connection.execute(
            """
            INSERT INTO workspace_watchlist_entries (
                workspace_key,
                opportunity_id,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?)
            """,
            (
                "local_practice",
                "italy-library",
                "2026-04-18T00:00:00+00:00",
                "2026-04-18T00:00:00+00:00",
            ),
        )
        connection.execute(
            """
            INSERT INTO workspace_watchlist_entries (
                workspace_key,
                opportunity_id,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?)
            """,
            (
                "local_practice",
                "italy-library",
                "2026-04-19T00:00:00+00:00",
                "2026-04-19T00:00:00+00:00",
            ),
        )
        connection.commit()

    ensure_schema(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT workspace_key, opportunity_id, created_at, updated_at
            FROM workspace_watchlist_entries
            ORDER BY id ASC
            """
        ).fetchall()
        unique_indexes = [
            row
            for row in connection.execute(
                "PRAGMA index_list(workspace_watchlist_entries)"
            ).fetchall()
            if row["unique"] == 1
        ]

    assert len(rows) == 1
    assert rows[0]["workspace_key"] == "local_practice"
    assert rows[0]["opportunity_id"] == "italy-library"
    assert rows[0]["updated_at"] == "2026-04-19T00:00:00+00:00"
    assert unique_indexes


def test_run_doctor_initializes_source_diagnostics_schema(tmp_path) -> None:
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "config" / "sources.yml").write_text("sources: []\n", encoding="utf-8")
    (tmp_path / "config" / "filters.yml").write_text("targeting: {}\n", encoding="utf-8")
    (tmp_path / "config" / "taxonomy.yml").write_text(
        """
regions: []
languages: []
source_kinds: []
source_tiers: []
scan_methods: []
competition_statuses: []
competition_types: []
opportunity_types: []
procedure_types: []
implementation_paths: []
evidence_levels: []
audience: []
""".strip()
        + "\n",
        encoding="utf-8",
    )

    settings = Settings(root=tmp_path)
    results = run_doctor(settings)
    db_path = settings.resolve_path(settings.db)

    with sqlite3.connect(db_path) as connection:
        source_runs_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='source_runs'"
        ).fetchone()
        source_health_table = connection.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='source_health'"
        ).fetchone()

    assert all(result.ok for result in results)
    assert source_runs_table is not None
    assert source_health_table is not None


def test_restore_legacy_competitions_backfills_missing_rows_without_overwriting_current_rows(
    tmp_path,
) -> None:
    db_path = tmp_path / "competitions.sqlite"
    ensure_schema(db_path)

    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="shared-row",
            title="Current Competition",
            organizer="Current Organizer",
            source_url="https://example.com/current",
            official_url="https://example.com/current-official",
            documents_portal_url="https://example.com/current-documents",
            deadline_at=date(2026, 8, 1),
        ),
    )

    _create_legacy_competitions_table(db_path, table_name="competitions_legacy")

    _insert_legacy_row(
        db_path,
        table_name="competitions_legacy",
        competition_id="shared-row",
        title="Legacy Shared Competition",
        organizer="Legacy Organizer",
        source_url="https://example.com/legacy-shared",
        official_url="https://example.com/legacy-shared-official",
    )
    _insert_legacy_row(
        db_path,
        table_name="competitions_legacy",
        competition_id="legacy-only-row",
        title="Legacy Only Competition",
        organizer="Legacy Organizer",
        source_url="https://example.com/legacy-only",
        official_url="https://example.com/legacy-only-official",
    )

    restored_count = restore_legacy_competitions(db_path)

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        restored = connection.execute(
            """
            SELECT id, title, official_url, source_url, documents_portal_url
            FROM competitions
            ORDER BY id ASC
            """
        ).fetchall()

    assert restored_count == 1
    assert [row["id"] for row in restored] == ["legacy-only-row", "shared-row"]
    assert restored[0]["title"] == "Legacy Only Competition"
    assert restored[0]["documents_portal_url"] is None
    assert restored[1]["title"] == "Current Competition"
    assert restored[1]["official_url"] == "https://example.com/current-official"
    assert restored[1]["source_url"] == "https://example.com/current"
    assert restored[1]["documents_portal_url"] == "https://example.com/current-documents"
