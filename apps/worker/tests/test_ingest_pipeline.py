from __future__ import annotations

import json
import sqlite3
import sys
from datetime import timedelta

import pytest
from support import write_source_catalog

from arch_competition_ops import clock
from arch_competition_ops.cli import main
from arch_competition_ops.collectors import CollectedSourceDocument
from arch_competition_ops.http import HttpTransportError
from arch_competition_ops.ingest import (
    IngestError,
    SourceDisabledError,
    SourceNotFoundError,
    ingest_source,
)
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import list_competitions, upsert_competition


def _days_from_today(days: int) -> str:
    return (clock.today() + timedelta(days=days)).isoformat()


def _ted_document(notice_id: str = "DEMO-TED-INGEST-001", **overrides) -> CollectedSourceDocument:
    payload = {
        "noticeId": notice_id,
        "title": "Municipal Waterfront Design Competition",
        "buyer": "Comune Demo Nord",
        "procedureType": "design_contest",
        "deadline": _days_from_today(30),
        "estimatedValueEur": "1850000",
        "eligibility": "Lead consultant must hold architect registration.",
        "cpv": ["71230000"],
        "officialUrl": f"https://ted.europa.eu/en/notice/{notice_id}/html",
    }
    payload.update(overrides)
    return CollectedSourceDocument(
        source_url=f"https://ted.europa.eu/en/notice/{notice_id}/html",
        payload=json.dumps(payload),
    )


@pytest.fixture
def workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path, "ted_design_notices")
    monkeypatch.setattr(
        "arch_competition_ops.ingest.enrich_record_geocode", lambda record, **_kwargs: record
    )
    return tmp_path


def _use_documents(monkeypatch, documents) -> None:
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda *_args, **_kwargs: list(documents),
    )


def _db(workspace) -> sqlite3.Connection:
    settings = Settings(root=workspace)
    connection = sqlite3.connect(settings.resolve_path(settings.db))
    connection.row_factory = sqlite3.Row
    return connection


def test_ingest_source_command_fetches_and_upserts_records(workspace, monkeypatch) -> None:
    _use_documents(monkeypatch, [_ted_document()])

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"])

    assert exit_code == 0
    settings = Settings(root=workspace)
    rows = list_competitions(settings.resolve_path(settings.db), limit=5)
    assert len(rows) == 1
    assert rows[0]["title"] == "Municipal Waterfront Design Competition"
    # The stored id follows the stable-identity scheme and carries no deadline.
    assert rows[0]["id"] == (
        "municipal-waterfront-design-competition__ted_design_notices__demo-ted-ingest-001"
    )


def test_ingest_stores_source_identity_and_only_evidenced_fields(workspace, monkeypatch) -> None:
    _use_documents(monkeypatch, [_ted_document()])

    ingest_source(Settings(root=workspace), source_id="ted_design_notices", limit=1)

    with _db(workspace) as connection:
        row = connection.execute("SELECT * FROM competitions").fetchone()
    assert row["source_id"] == "ted_design_notices"
    assert row["source_name"] == "TED Design and Procurement Notices"
    assert row["organizer"] == "Comune Demo Nord"
    assert row["official_url"] == "https://ted.europa.eu/en/notice/DEMO-TED-INGEST-001/html"
    assert row["registration_fee_eur"] is None
    assert row["submission_fee_eur"] is None
    assert row["audience"] == "[]"
    assert row["implementation_path"] is None
    assert row["licensed_architect_required"] == 1  # the notice's own eligibility clause says so


def test_ingest_source_persists_geocoded_location_fields(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path, "simap_public_design_notices")
    payload = json.dumps(
        {
            "officialNoticeId": "34414-02",
            "title": "Extension du complexe sportif et de loisirs Looren, 8124 Maur",
            "buyer": "Gemeindeverwaltung Maur",
            "location": "Maur",
            "procedureType": "open",
            "deadline": _days_from_today(45),
            "description": "Projet pour une extension sportive.",
            "cpv": ["71200000"],
        },
        ensure_ascii=False,
    )
    _use_documents(
        monkeypatch,
        [CollectedSourceDocument("https://www.simap.ch/example/34414-02", payload)],
    )

    def fake_enrich(record: CompetitionRecord, **_kwargs) -> CompetitionRecord:
        assert record.location_label == "Maur"
        record.geo_lat = 47.3407
        record.geo_lng = 8.671
        record.geo_source = "nominatim"
        record.geo_confidence = 0.91
        return record

    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", fake_enrich)

    assert (
        main(["ingest-source", "--source-id", "simap_public_design_notices", "--limit", "1"]) == 0
    )

    with _db(tmp_path) as connection:
        row = connection.execute(
            "SELECT location_label, geo_lat, geo_lng, geo_source, geo_confidence FROM competitions"
        ).fetchone()
    assert (row["location_label"], row["geo_lat"], row["geo_lng"]) == ("Maur", 47.3407, 8.671)
    assert (row["geo_source"], row["geo_confidence"]) == ("nominatim", 0.91)


def test_ingest_runs_the_preview_cli_with_the_new_ids(workspace, monkeypatch, capsys) -> None:
    capture = workspace / "ids.json"
    script = workspace / "packages" / "previews" / "bin" / "prewarm.mjs"
    script.parent.mkdir(parents=True)
    script.write_text(
        "import pathlib, sys\n"
        f"pathlib.Path({str(capture)!r}).write_text(sys.stdin.read(), encoding='utf-8')\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ARCH_PREVIEW_PREWARM", "1")
    monkeypatch.setenv("ARCH_PREVIEW_NODE", sys.executable)
    _use_documents(monkeypatch, [_ted_document()])

    assert main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"]) == 0

    sent = json.loads(capture.read_text(encoding="utf-8"))
    assert sent["competitionIds"] == [
        "municipal-waterfront-design-competition__ted_design_notices__demo-ted-ingest-001"
    ]
    assert "card previews" not in capsys.readouterr().out


def test_ingest_reports_skipped_preview_prewarm_when_it_is_not_enabled(
    workspace, monkeypatch, capsys
) -> None:
    monkeypatch.delenv("ARCH_PREVIEW_PREWARM", raising=False)
    _use_documents(monkeypatch, [_ted_document()])

    assert main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"]) == 0

    output = capsys.readouterr().out
    assert "card previews skipped" in output
    assert "ARCH_PREVIEW_PREWARM is not enabled" in output


def test_failing_preview_cli_only_warns(workspace, monkeypatch, capsys) -> None:
    monkeypatch.setenv("ARCH_PREVIEW_PREWARM", "1")
    monkeypatch.setenv("ARCH_PREVIEW_NODE", "definitely-not-a-real-binary-xyz")
    (workspace / "packages" / "previews" / "bin").mkdir(parents=True)
    (workspace / "packages" / "previews" / "bin" / "prewarm.mjs").write_text("", encoding="utf-8")
    _use_documents(monkeypatch, [_ted_document()])

    assert main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"]) == 0

    assert "card previews failed" in capsys.readouterr().out
    with _db(workspace) as connection:
        assert connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0] == 1


def test_ingest_source_records_source_health_with_parse_failures_and_duplicate_pressure(
    workspace, monkeypatch, capsys
) -> None:
    documents = [
        CollectedSourceDocument(
            "https://ted.europa.eu/en/notice/1/html", json.dumps({"case": "first"})
        ),
        CollectedSourceDocument(
            "https://ted.europa.eu/en/notice/2/html", json.dumps({"case": "duplicate"})
        ),
        CollectedSourceDocument(
            "https://ted.europa.eu/en/notice/3/html", json.dumps({"case": "bad"})
        ),
    ]
    _use_documents(monkeypatch, documents)
    deadline = clock.today() + timedelta(days=30)

    def fake_parse(_source, payload: str, *, source_url: str) -> CompetitionRecord:
        if json.loads(payload)["case"] == "bad":
            raise ValueError("parser exploded on bad payload")
        return CompetitionRecord(
            title="Municipal Waterfront Design Competition",
            organizer="Comune Demo Nord",
            source_id="ted_design_notices",
            source_url=source_url,
            official_url="https://ted.europa.eu/en/official/demo",
            opportunity_type="public_design_contest",
            deadline_at=deadline,
            extraction_confidence=0.91,
            evidence_level="official_notice",
        )

    monkeypatch.setattr("arch_competition_ops.ingest.parse_source_payload", fake_parse)
    monkeypatch.setattr("arch_competition_ops.ingest.verify_record", lambda **kw: kw["record"])

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "3"])

    assert exit_code == 1
    output = capsys.readouterr().out
    assert "[WARN] parse failed for https://ted.europa.eu/en/notice/3/html" in output
    with _db(workspace) as connection:
        assert connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0] == 2
        run_row = connection.execute(
            "SELECT * FROM source_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        health_row = connection.execute(
            "SELECT * FROM source_health WHERE source_id = 'ted_design_notices'"
        ).fetchone()

    assert run_row["status"] == "completed_with_failures"
    assert (run_row["document_count"], run_row["upserted_count"]) == (3, 2)
    assert run_row["parse_failure_count"] == 1
    assert (run_row["duplicate_group_count"], run_row["max_duplicate_group_size"]) == (1, 2)
    assert "parser exploded" in run_row["last_error"]
    assert health_row["last_status"] == "completed_with_failures"
    assert health_row["last_success_at"] is not None


def test_partial_failures_come_back_as_a_result_not_an_exception(workspace, monkeypatch) -> None:
    _use_documents(
        monkeypatch,
        [_ted_document("GOOD-1"), CollectedSourceDocument("https://ted.europa.eu/bad", "not json")],
    )

    result = ingest_source(Settings(root=workspace), source_id="ted_design_notices", limit=2)

    assert result.status == "completed_with_failures"
    assert len(result.ingested_ids) == 1
    assert [(failure.source_url, failure.stage) for failure in result.failures] == [
        ("https://ted.europa.eu/bad", "parse")
    ]


def test_ingest_source_reports_duplicate_pressure_against_existing_canonical_rows(
    workspace, monkeypatch
) -> None:
    settings = Settings(root=workspace)
    db_path = settings.resolve_path(settings.db)
    deadline = clock.today() + timedelta(days=30)
    for competition_id in ("existing-a", "existing-b"):
        upsert_competition(
            db_path,
            CompetitionRecord(
                competition_id=competition_id,
                title="Municipal Waterfront Design Competition",
                organizer="Comune Demo Nord",
                source_url=f"https://ted.europa.eu/en/notice/{competition_id}/html",
                status="verified",
                deadline_at=deadline,
                extraction_confidence=0.91,
                evidence_level="official_notice",
            ),
        )
    _use_documents(monkeypatch, [_ted_document("LIVE-1")])

    assert main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"]) == 0

    with _db(workspace) as connection:
        run_row = connection.execute(
            "SELECT * FROM source_runs ORDER BY id DESC LIMIT 1"
        ).fetchone()
        health_row = connection.execute("SELECT * FROM source_health").fetchone()
        same_key = connection.execute(
            "SELECT COUNT(*) FROM competitions WHERE title = 'Municipal Waterfront Design Competition'"
        ).fetchone()[0]

    # Same title, buyer and deadline from another source is a duplicate *signal*, not a merge.
    assert same_key == 3
    assert run_row["status"] == "success"
    assert (run_row["duplicate_group_count"], run_row["max_duplicate_group_size"]) == (1, 3)
    assert (health_row["duplicate_group_count"], health_row["max_duplicate_group_size"]) == (1, 3)


def test_disabled_source_is_rejected_with_a_clear_error(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path, "ted_design_notices")
    sources_yml = tmp_path / "config" / "sources.yml"
    sources_yml.write_text(
        sources_yml.read_text(encoding="utf-8").replace("enabled: true", "enabled: false"),
        encoding="utf-8",
    )
    called = []
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda *a, **k: called.append(1) or [],
    )

    with pytest.raises(SourceDisabledError, match="disabled"):
        ingest_source(Settings(root=tmp_path), source_id="ted_design_notices")
    assert main(["ingest-source", "--source-id", "ted_design_notices"]) == 2

    assert "is disabled (enabled: false)" in capsys.readouterr().out
    assert called == []
    assert not (tmp_path / "data" / "competitions.sqlite").exists()  # nothing was touched


def test_unknown_source_is_a_usage_error(workspace, capsys) -> None:
    with pytest.raises(SourceNotFoundError):
        ingest_source(Settings(root=workspace), source_id="nope")
    assert main(["ingest-source", "--source-id", "nope"]) == 2
    assert "Unknown source id: nope" in capsys.readouterr().out


def test_network_failure_gives_a_friendly_error_not_a_traceback(
    workspace, monkeypatch, capsys
) -> None:
    def failing_collect(*_args, **_kwargs):
        raise HttpTransportError("connection reset", url="https://ted.europa.eu/api", attempts=3)

    monkeypatch.setattr("arch_competition_ops.ingest.collect_source_documents", failing_collect)

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices"])

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "error: Ingest of 'ted_design_notices' failed during collection" in captured.out
    assert "connection reset" in captured.out
    assert "Traceback" not in captured.out + captured.err
    with _db(workspace) as connection:
        run_row = connection.execute("SELECT status, last_error FROM source_runs").fetchone()
    assert run_row["status"] == "failed"
    assert "connection reset" in run_row["last_error"]


def test_collection_error_keeps_the_original_exception_as_cause(workspace, monkeypatch) -> None:
    def failing_collect(*_args, **_kwargs):
        raise HttpTransportError("boom", url="https://ted.europa.eu/api")

    monkeypatch.setattr("arch_competition_ops.ingest.collect_source_documents", failing_collect)

    with pytest.raises(IngestError) as excinfo:
        ingest_source(Settings(root=workspace), source_id="ted_design_notices")

    assert isinstance(excinfo.value.__cause__, HttpTransportError)
    assert excinfo.value.stage == "collection"


def test_one_ingest_is_one_transaction(workspace, monkeypatch) -> None:
    _use_documents(monkeypatch, [_ted_document("A-1"), _ted_document("B-2")])
    import arch_competition_ops.storage.competitions as repository

    real_upsert = repository.upsert_in_connection
    calls = {"count": 0}

    def failing_second_upsert(connection, record, *, now_iso):
        calls["count"] += 1
        if calls["count"] == 2:
            raise sqlite3.OperationalError("disk I/O error")
        return real_upsert(connection, record, now_iso=now_iso)

    monkeypatch.setattr(repository, "upsert_in_connection", failing_second_upsert)

    with pytest.raises(IngestError, match="database write"):
        ingest_source(Settings(root=workspace), source_id="ted_design_notices", limit=2)

    with _db(workspace) as connection:
        assert connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0] == 0
        assert connection.execute("SELECT status FROM source_runs").fetchone()["status"] == "failed"


def test_expired_notices_are_counted_and_skipped(workspace, monkeypatch) -> None:
    _use_documents(
        monkeypatch,
        [
            _ted_document("FRESH-1"),
            _ted_document("OLD-1", deadline=_days_from_today(-30)),
        ],
    )

    result = ingest_source(Settings(root=workspace), source_id="ted_design_notices", limit=2)

    assert len(result.ingested_ids) == 1
    assert result.skipped_expired == 1
    assert result.status == "success"


def test_negative_keywords_from_filters_yml_exclude_records(workspace, monkeypatch) -> None:
    (workspace / "config" / "filters.yml").write_text(
        "targeting:\n  negative_keywords:\n    - ideas competition\n", encoding="utf-8"
    )
    _use_documents(
        monkeypatch,
        [
            _ted_document("KEEP-1"),
            _ted_document("DROP-1", title="Ideas competition for a new civic square"),
        ],
    )

    result = ingest_source(Settings(root=workspace), source_id="ted_design_notices", limit=2)

    assert len(result.ingested_ids) == 1
    assert result.filtered_out == 1


def test_positive_keywords_add_a_small_qualification_bonus(workspace, monkeypatch) -> None:
    _use_documents(monkeypatch, [_ted_document("BONUS-1")])
    settings = Settings(root=workspace)

    ingest_source(settings, source_id="ted_design_notices", limit=1)
    with _db(workspace) as connection:
        baseline = connection.execute("SELECT qualification_score FROM competitions").fetchone()[0]
        connection.execute("DELETE FROM competitions")
        connection.commit()

    (workspace / "config" / "filters.yml").write_text(
        "targeting:\n  positive_keywords:\n    - waterfront\n", encoding="utf-8"
    )
    ingest_source(settings, source_id="ted_design_notices", limit=1)
    with _db(workspace) as connection:
        boosted = connection.execute("SELECT qualification_score FROM competitions").fetchone()[0]

    assert boosted == pytest.approx(baseline + 0.05)


def test_reingest_keeps_human_status_and_source_identity(workspace, monkeypatch) -> None:
    _use_documents(monkeypatch, [_ted_document()])
    settings = Settings(root=workspace)
    ingest_source(settings, source_id="ted_design_notices", limit=1)
    with _db(workspace) as connection:
        connection.execute("UPDATE competitions SET status = 'shortlisted'")
        connection.commit()

    ingest_source(settings, source_id="ted_design_notices", limit=1)

    with _db(workspace) as connection:
        rows = connection.execute("SELECT status, source_id FROM competitions").fetchall()
    assert [(row["status"], row["source_id"]) for row in rows] == [
        ("shortlisted", "ted_design_notices")
    ]
