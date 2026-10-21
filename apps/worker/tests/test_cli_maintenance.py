from __future__ import annotations

import sqlite3
from types import SimpleNamespace

from arch_competition_ops.cli import main
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import upsert_competition


def test_refresh_geocodes_command_backfills_missing_coordinates(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text("sources: []\n", encoding="utf-8")

    settings = Settings(root=tmp_path)
    upsert_competition(
        settings.resolve_path(settings.db),
        CompetitionRecord(
            competition_id="maur-opportunity",
            title="Extension du complexe sportif et de loisirs Looren, 8124 Maur",
            organizer="SIMAP",
            authority_name="Gemeindeverwaltung Maur",
            source_url="https://www.simap.ch/example/maur",
            jurisdiction="switzerland",
        ),
    )

    def fake_enrich(record: CompetitionRecord, **_kwargs) -> CompetitionRecord:
        record.location_label = "Maur"
        record.geo_lat = 47.3407
        record.geo_lng = 8.671
        record.geo_source = "nominatim"
        record.geo_confidence = 0.91
        return record

    monkeypatch.setattr(
        "arch_competition_ops.maintenance.enrich_record_geocode",
        fake_enrich,
    )

    exit_code = main(["refresh-geocodes", "--limit", "10"])

    assert exit_code == 0
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.row_factory = sqlite3.Row
        row = connection.execute(
            "SELECT location_label, geo_lat, geo_lng FROM competitions WHERE id = 'maur-opportunity'"
        ).fetchone()

    assert row["location_label"] == "Maur"
    assert row["geo_lat"] == 47.3407
    assert row["geo_lng"] == 8.671


def test_prewarm_card_previews_command_reports_generated_counts(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "arch_competition_ops.cli.prewarm_opportunity_card_previews",
        lambda settings, *, competition_ids: SimpleNamespace(
            status="ok",
            detail="ran",
            attempted=len(competition_ids),
            generated=max(0, len(competition_ids) - 1),
            skipped=1 if competition_ids else 0,
        ),
    )

    exit_code = main(
        [
            "prewarm-card-previews",
            "--competition-id",
            "alpha-opportunity",
            "--competition-id",
            "beta-opportunity",
        ]
    )

    output = capsys.readouterr().out

    assert exit_code == 0
    assert "attempted=2" in output
    assert "generated=1" in output
    assert "skipped=1" in output


def test_cleanup_expired_competitions_command_reports_deleted_counts(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(
        "arch_competition_ops.cli.cleanup_expired_competitions",
        lambda settings, *, retention_days, limit, force: SimpleNamespace(
            already_ran_today=False,
            last_run_date="2026-05-13",
            attempted=3,
            deleted_competitions=2,
            deleted_preview_files=2,
            deleted_static_preview_files=4,
            skipped=1,
        ),
    )

    exit_code = main(
        [
            "cleanup-expired-competitions",
            "--retention-days",
            "7",
            "--limit",
            "50",
        ]
    )

    output = capsys.readouterr().out

    assert exit_code == 0
    assert "attempted=3" in output
    assert "deleted=2" in output
    assert "preview_files=2" in output
    assert "static_preview_files=4" in output
    assert "skipped=1" in output


def test_normalize_anac_source_traces_command_rewrites_machine_urls_to_public_pages(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text("sources: []\n", encoding="utf-8")

    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="villa-giulia-anac",
            title="Affidamento diretto dei servizi di progettazione per Villa Giulia",
            organizer="",
            source_id="anac_bdncp_contracts",
            source_name="ANAC BDNCP",
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
            competition_id="school-campus-anac",
            title="Servizi di progettazione per nuovo polo civico",
            organizer="",
            source_id="anac_bdncp_contracts",
            source_name="ANAC BDNCP",
            authority_name="Comune di Ravenna",
            source_url="https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/fb7c96cb-1af5-4008-a0c4-2d4197479540",
            official_url="https://example.it/gara/123",
            official_notice_id="fb7c96cb-1af5-4008-a0c4-2d4197479540",
            jurisdiction="italy",
        ),
    )
    monkeypatch.setattr(
        "arch_competition_ops.postprocess.anac.fetch_notice_detail",
        lambda official_notice_id: {
            "49320bc2-6c80-4bc7-80f0-1e6a7eaeea82": {"codiceScheda": "AD3", "tipo": "avviso"},
            "fb7c96cb-1af5-4008-a0c4-2d4197479540": {"codiceScheda": "P1", "tipo": "avviso"},
        }.get(official_notice_id),
    )

    exit_code = main(["normalize-anac-source-traces", "--limit", "10"])

    assert exit_code == 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT official_notice_id, source_url
            FROM competitions
            WHERE id IN ('villa-giulia-anac', 'school-campus-anac')
            ORDER BY official_notice_id
            """
        ).fetchall()

    assert rows[0]["official_notice_id"] == "49320bc2-6c80-4bc7-80f0-1e6a7eaeea82"
    assert (
        rows[0]["source_url"]
        == "https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true"
    )
    assert rows[1]["official_notice_id"] == "fb7c96cb-1af5-4008-a0c4-2d4197479540"
    assert (
        rows[1]["source_url"]
        == "https://pubblicitalegale.anticorruzione.it/bandi/fb7c96cb-1af5-4008-a0c4-2d4197479540?ricercaArchivio=true"
    )


def test_normalize_anac_record_statuses_command_marks_archived_result_notices(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text("sources: []\n", encoding="utf-8")

    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="villa-giulia-anac",
            title="Affidamento diretto dei servizi di progettazione per Villa Giulia",
            organizer="",
            source_id="anac_bdncp_contracts",
            source_name="ANAC BDNCP",
            authority_name="MUSEO ETRUSCO DI VILLA GIULIA",
            source_url="https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true",
            official_url="https://www.museoetru.it/",
            official_notice_id="49320bc2-6c80-4bc7-80f0-1e6a7eaeea82",
            jurisdiction="italy",
            status="discovered",
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="school-campus-anac",
            title="Servizi di progettazione per nuovo polo civico",
            organizer="",
            source_id="anac_bdncp_contracts",
            source_name="ANAC BDNCP",
            authority_name="Comune di Ravenna",
            source_url="https://pubblicitalegale.anticorruzione.it/bandi/fb7c96cb-1af5-4008-a0c4-2d4197479540?ricercaArchivio=true",
            official_url="https://example.it/gara/123",
            official_notice_id="fb7c96cb-1af5-4008-a0c4-2d4197479540",
            jurisdiction="italy",
            status="discovered",
        ),
    )
    monkeypatch.setattr(
        "arch_competition_ops.postprocess.anac.fetch_notice_detail",
        lambda official_notice_id: {
            "49320bc2-6c80-4bc7-80f0-1e6a7eaeea82": {"codiceScheda": "AD3", "tipo": "avviso"},
            "fb7c96cb-1af5-4008-a0c4-2d4197479540": {"codiceScheda": "P1", "tipo": "avviso"},
        }.get(official_notice_id),
    )

    exit_code = main(["normalize-anac-record-statuses", "--limit", "10"])

    assert exit_code == 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, status
            FROM competitions
            WHERE id IN ('villa-giulia-anac', 'school-campus-anac')
            ORDER BY id
            """
        ).fetchall()

    assert rows[0]["id"] == "school-campus-anac"
    assert rows[0]["status"] == "discovered"
    assert rows[1]["id"] == "villa-giulia-anac"
    assert rows[1]["status"] == "archived"


def test_normalize_gets_preannouncement_statuses_command_discards_advance_notices(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text("sources: []\n", encoding="utf-8")

    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="gets-advance-notice",
            title="14247 - Ashhurst Domain to Western Gateway Shared Use Path",
            organizer="",
            source_id="gets_open_tenders",
            source_name="GETS Open Tenders",
            authority_name="New Zealand Transport Agency (Waka Kotahi) - HISTORIC",
            source_url="https://www.gets.govt.nz/NZTAHNO/ExternalTenderDetails.htm?id=34033788",
            official_url="https://www.gets.govt.nz/NZTAHNO/ExternalTenderDetails.htm?id=34033788",
            jurisdiction="new_zealand",
            status="discovered",
            eligibility_summary=(
                "This Notice of Information (NOI) – Advance Notice is to provide early information "
                "ahead of a future Request for Tenders. This notice is provided as an early indication "
                "only and is NOT the commencement of a tender process."
            ),
        ),
    )
    upsert_competition(
        db_path,
        CompetitionRecord(
            competition_id="gets-live-rft",
            title="SH29 Tauriko West Utilities Investigation",
            organizer="",
            source_id="gets_open_tenders",
            source_name="GETS Open Tenders",
            authority_name="New Zealand Transport Agency (Waka Kotahi) - HISTORIC",
            source_url="https://www.gets.govt.nz/NZTAHNO/ExternalTenderDetails.htm?id=33961386",
            official_url="https://www.gets.govt.nz/NZTAHNO/ExternalTenderDetails.htm?id=33961386",
            jurisdiction="new_zealand",
            status="discovered",
            eligibility_summary=(
                "This Request for Tender invites suitable qualified Utilities Location companies to "
                "undertake utilities survey works. Electronic copies of the RFT documentation are attached."
            ),
        ),
    )

    exit_code = main(["normalize-gets-preannouncement-statuses", "--limit", "10"])

    assert exit_code == 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute(
            """
            SELECT id, status
            FROM competitions
            WHERE id IN ('gets-advance-notice', 'gets-live-rft')
            ORDER BY id
            """
        ).fetchall()

    assert rows[0]["id"] == "gets-advance-notice"
    assert rows[0]["status"] == "discarded"
    assert rows[1]["id"] == "gets-live-rft"
    assert rows[1]["status"] == "discovered"
