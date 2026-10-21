from __future__ import annotations

import json
import shutil
import sqlite3
import sys
from pathlib import Path

import pytest

from arch_competition_ops.card_previews import (
    PREWARM_SCRIPT,
    build_prewarm_argv,
    prewarm_opportunity_card_previews,
)
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema

REPO_ROOT = Path(__file__).resolve().parents[3]


def _fake_cli(root: Path, body: str) -> Path:
    """A stand-in for prewarm.mjs: python runs it, because ARCH_PREVIEW_NODE points at python."""
    script = root / PREWARM_SCRIPT
    script.parent.mkdir(parents=True)
    script.write_text(body, encoding="utf-8")
    return script


def _settings(root: Path, **overrides) -> Settings:
    return Settings(root=root, preview_prewarm=True, preview_node=sys.executable, **overrides)


def test_prewarm_is_skipped_and_reported_when_not_enabled(tmp_path) -> None:
    result = prewarm_opportunity_card_previews(
        Settings(root=tmp_path, preview_prewarm=False), competition_ids=["some-opportunity"]
    )

    assert result.status == "skipped"
    assert result.attempted == 1
    assert "ARCH_PREVIEW_PREWARM" in result.detail


def test_prewarm_without_ids_is_skipped(tmp_path) -> None:
    result = prewarm_opportunity_card_previews(_settings(tmp_path), competition_ids=["", ""])

    assert result.status == "skipped"
    assert result.attempted == 0


def test_the_argument_vector_is_fixed_and_ids_travel_on_stdin(tmp_path) -> None:
    capture = tmp_path / "capture.json"
    _fake_cli(
        tmp_path,
        "import json, pathlib, sys\n"
        "payload = sys.stdin.read()\n"
        f"pathlib.Path({str(capture)!r}).write_text(\n"
        "    json.dumps({'argv': sys.argv[1:], 'stdin': payload}), encoding='utf-8')\n"
        "ids = json.loads(payload)['competitionIds']\n"
        "print('progress noise that is not json')\n"
        "print(json.dumps({'attempted': len(ids), 'generated': 1, 'skipped': 0, 'failed': 1}))\n",
    )
    settings = _settings(tmp_path, db=Path("data") / "x.sqlite")

    result = prewarm_opportunity_card_previews(settings, competition_ids=["a", "b", "a"])

    captured = json.loads(capture.read_text(encoding="utf-8"))
    assert captured["argv"] == [
        "--db",
        str((tmp_path / "data" / "x.sqlite").resolve()),
        "--only-from-stdin",
    ]
    assert json.loads(captured["stdin"]) == {"competitionIds": ["a", "b"]}
    assert build_prewarm_argv(settings)[:2] == [sys.executable, str(tmp_path / PREWARM_SCRIPT)]
    assert (result.status, result.attempted, result.generated, result.skipped, result.failed) == (
        "ok",
        2,
        1,
        0,
        1,
    )


def test_prewarm_failure_is_reported_not_raised(tmp_path) -> None:
    _fake_cli(tmp_path, "import sys\nsys.stderr.write('render crashed')\nsys.exit(3)\n")

    result = prewarm_opportunity_card_previews(_settings(tmp_path), competition_ids=["a"])

    assert result.status == "failed"
    assert "exited with 3" in result.detail
    assert "render crashed" in result.detail


def test_a_held_lock_is_reported_as_an_active_run(tmp_path) -> None:
    _fake_cli(tmp_path, "import sys\nsys.exit(75)\n")

    result = prewarm_opportunity_card_previews(_settings(tmp_path), competition_ids=["a"])

    assert result.status == "failed"
    assert "another preview run is active" in result.detail


def test_a_missing_script_or_runtime_is_reported_not_raised(tmp_path) -> None:
    missing_script = prewarm_opportunity_card_previews(_settings(tmp_path), competition_ids=["a"])
    assert missing_script.status == "failed"
    assert "script not found" in missing_script.detail

    _fake_cli(tmp_path, "pass\n")
    settings = Settings(
        root=tmp_path, preview_prewarm=True, preview_node="definitely-not-a-real-binary-xyz"
    )
    missing_runtime = prewarm_opportunity_card_previews(settings, competition_ids=["a"])
    assert missing_runtime.status == "failed"
    assert "could not run" in missing_runtime.detail


def _insert_record(db_path: Path, competition_id: str) -> None:
    ensure_schema(db_path)
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """
            INSERT INTO competitions (
                id, dedup_key, title, organizer, source_url, status, opportunity_type, regions,
                languages, competition_types, audience, cpv_codes, extraction_confidence,
                evidence_level, discovered_at, updated_at
            ) VALUES (?, ?, 'Untraceable notice', '', '', 'discovered', 'unknown', '[]', '[]', '[]',
                      '[]', '[]', 0.5, 'unknown', '2026-05-01', '2026-05-01')
            """,
            (competition_id, competition_id),
        )


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_real_cli_honours_the_worker_contract(tmp_path, monkeypatch) -> None:
    """Python -> packages/previews/bin/prewarm.mjs -> one JSON line, offline (nothing to locate)."""
    db_path = tmp_path / "competitions.sqlite"
    _insert_record(db_path, "untraceable-1")
    monkeypatch.setenv("ARCH_PREVIEWS_DIR", str(tmp_path / "previews"))
    settings = Settings(root=REPO_ROOT, db=db_path, preview_prewarm=True)

    result = prewarm_opportunity_card_previews(settings, competition_ids=["untraceable-1"])

    assert (result.status, result.attempted, result.generated, result.skipped, result.failed) == (
        "ok",
        1,
        0,
        1,
        0,
    )
    manifest = json.loads((tmp_path / "previews" / "manifest.json").read_text(encoding="utf-8"))
    assert manifest["entries"]["untraceable-1"]["kind"] == "none"
    assert manifest["entries"]["untraceable-1"]["algorithmVersion"]
