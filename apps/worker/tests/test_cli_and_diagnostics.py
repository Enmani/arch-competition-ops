from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest
from support import write_minimal_config, write_source_catalog

from arch_competition_ops.cli import main
from arch_competition_ops.demo import DemoSeedRefusedError, seed_demo_records
from arch_competition_ops.diagnostics import run_verify
from arch_competition_ops.http import HttpTransportError
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema, upsert_competition

SRC = Path(__file__).resolve().parents[1] / "src" / "arch_competition_ops"

GOOD_SOURCE = """
sources:
  - source_id: s1
    name: Source One
    kind: official_procurement
    jurisdiction: eu
    base_url: https://example.invalid/
    collector: {collector}
    scan_method: api
    extractor: {extractor}
    source_tier: primary
"""


def _verify(tmp_path, *, collector: str, extractor: str):
    write_minimal_config(tmp_path, GOOD_SOURCE.format(collector=collector, extractor=extractor))
    return {result.label: result for result in run_verify(Settings(root=tmp_path))}


def test_verify_accepts_registered_collector_and_extractor(tmp_path) -> None:
    results = _verify(tmp_path, collector="ted_search_api", extractor="ted_notice_parser")

    assert results["source collector/extractor wiring"].ok
    assert all(result.ok for result in results.values()), [r for r in results.values() if not r.ok]


def test_verify_rejects_unknown_collector_and_extractor_names(tmp_path) -> None:
    results = _verify(tmp_path, collector="no_such_family", extractor="no_such_parser")

    wiring = results["source collector/extractor wiring"]
    assert not wiring.ok
    assert "no_such_family" in wiring.detail and "no_such_parser" in wiring.detail


def test_verify_checks_disabled_sources_too(tmp_path) -> None:
    write_minimal_config(
        tmp_path,
        GOOD_SOURCE.format(collector="typo_family", extractor="ted_notice_parser")
        + "    enabled: false\n"
        + "  - source_id: s2\n    name: Two\n    kind: official_procurement\n    jurisdiction: eu\n"
        + "    base_url: https://example.invalid/\n    collector: ted_search_api\n    scan_method: api\n"
        + "    extractor: ted_notice_parser\n    source_tier: primary\n",
    )

    results = {result.label: result for result in run_verify(Settings(root=tmp_path))}

    assert not results["source collector/extractor wiring"].ok


def test_verify_reports_dedup_clusters_without_failing(tmp_path) -> None:
    write_minimal_config(
        tmp_path, GOOD_SOURCE.format(collector="ted_search_api", extractor="ted_notice_parser")
    )
    settings = Settings(root=tmp_path)
    for index in range(2):
        upsert_competition(
            settings.resolve_path(settings.db),
            CompetitionRecord(
                title="Same title",
                organizer="Same buyer",
                source_url=f"https://example.invalid/{index}",
            ),
        )

    results = {result.label: result for result in run_verify(settings)}

    assert results["database duplicates"].ok
    assert "1 dedup-key clusters" in results["database duplicates"].detail


# -- demo seed ------------------------------------------------------------------------------------


def _demo_settings(tmp_path):
    write_source_catalog(tmp_path)
    return Settings(root=tmp_path)


def test_seed_demo_writes_clearly_fictional_records(tmp_path) -> None:
    settings = _demo_settings(tmp_path)

    ids = seed_demo_records(settings)

    assert len(ids) == 2
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.row_factory = sqlite3.Row
        rows = connection.execute("SELECT * FROM competitions").fetchall()
    for row in rows:
        assert row["source_id"] == "demo"
        assert row["official_url"].startswith("https://example.invalid/")
        assert row["source_url"].startswith("https://example.invalid/")
        assert row["evidence_note"].startswith("DEMO RECORD")
        assert row["registration_fee_eur"] is None
        assert row["status"] == "discovered"


def test_seed_demo_refuses_a_database_that_already_has_records(tmp_path) -> None:
    settings = _demo_settings(tmp_path)
    upsert_competition(
        settings.resolve_path(settings.db),
        CompetitionRecord(title="A real notice", source_url="https://real.example/n/1"),
    )

    with pytest.raises(DemoSeedRefusedError, match="--force"):
        seed_demo_records(settings)

    assert len(seed_demo_records(settings, force=True)) == 2


def test_seed_demo_command_exit_codes(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path)

    assert main(["seed-demo"]) == 0
    assert "Seeded 2 demo records" in capsys.readouterr().out
    assert main(["seed-demo"]) == 2
    assert "already holds 2 competition records" in capsys.readouterr().out
    assert main(["seed-demo", "--force"]) == 0


# -- CLI error paths ------------------------------------------------------------------------------


def test_network_errors_never_print_a_traceback(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)

    def exploding_handler(*_args, **_kwargs):
        raise HttpTransportError("dns failure", url="https://example.invalid/", attempts=3)

    monkeypatch.setattr("arch_competition_ops.cli.ingest_source", exploding_handler)
    write_source_catalog(tmp_path, "ted_design_notices")

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices"])

    captured = capsys.readouterr()
    assert exit_code == 1
    assert "error: network or file access failed" in captured.out
    assert "dns failure" in captured.out
    assert "Traceback" not in captured.out + captured.err


def test_invalid_configuration_is_a_usage_error_not_a_crash(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "config" / "sources.yml").write_text(
        "sources:\n  - source_id: x\n    surprise: 1\n", encoding="utf-8"
    )

    assert main(["show-sources"]) == 2
    assert "error:" in capsys.readouterr().out


def test_parse_source_file_reports_unknown_source_and_missing_file(
    tmp_path, monkeypatch, capsys
) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path, "ted_design_notices")

    assert main(["parse-source-file", "--source-id", "nope", "--path", "x.json"]) == 1
    assert "Unknown source id: nope" in capsys.readouterr().out
    assert main(["parse-source-file", "--source-id", "ted_design_notices", "--path", "x.json"]) == 1
    assert "Missing payload file" in capsys.readouterr().out


def test_parse_source_file_prints_the_record(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path, "ted_design_notices")
    (tmp_path / "notice.json").write_text(
        '{"title": "Library design", "noticeId": "N-9"}', encoding="utf-8"
    )

    assert (
        main(["parse-source-file", "--source-id", "ted_design_notices", "--path", "notice.json"])
        == 0
    )

    output = capsys.readouterr().out
    assert '"title": "Library design"' in output
    assert '"official_notice_id": "N-9"' in output


def test_list_and_init_db_commands(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path)

    assert main(["list"]) == 0
    assert "No competition records" in capsys.readouterr().out
    assert main(["init-db"]) == 0
    assert "Initialized database at" in capsys.readouterr().out
    settings = Settings(root=tmp_path)
    ensure_schema(settings.resolve_path(settings.db))
    upsert_competition(
        settings.resolve_path(settings.db),
        CompetitionRecord(title="Unnamed buyer notice", source_url="https://example.invalid/n"),
    )
    assert main(["list"]) == 0
    assert "Unnamed buyer notice | unknown" in capsys.readouterr().out


def test_every_postprocess_task_is_a_cli_command(tmp_path, monkeypatch, capsys) -> None:
    monkeypatch.chdir(tmp_path)
    write_source_catalog(tmp_path)
    for command in (
        "normalize-anac-source-traces",
        "normalize-anac-record-statuses",
        "normalize-gets-preannouncement-statuses",
    ):
        assert main([command, "--limit", "5"]) == 0
        assert f"{command}: updated 0 records" in capsys.readouterr().out


# -- configuration conventions --------------------------------------------------------------------


def test_database_path_has_a_single_environment_variable(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("ARCH_COMPETITION_OPS_DB", str(tmp_path / "custom.sqlite"))

    assert Settings(root=tmp_path).resolve_path(Settings().db) == tmp_path / "custom.sqlite"
    for path in SRC.rglob("*.py"):
        assert "ARCH_COMPETITION_DB_PATH" not in path.read_text(encoding="utf-8")


def test_no_module_uses_urllib_for_http_or_datetime_today() -> None:
    offenders = []
    for path in SRC.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if "urllib.request" in text or "from urllib import request" in text:
            offenders.append(f"{path.relative_to(SRC)}: urllib request")
        if path.name != "clock.py" and "date.today()" in text:  # clock.py is the one allowed caller
            offenders.append(f"{path.relative_to(SRC)}: date.today()")
        if path.name != "clock.py" and "date('now')" in text:
            offenders.append(f"{path.relative_to(SRC)}: SQL date('now')")
        if "__file__).resolve().parents" in text or "parents[5]" in text:
            offenders.append(f"{path.relative_to(SRC)}: parents[n] path guess")
    assert offenders == []
