from __future__ import annotations

import json
import os
import subprocess
import sys
import threading
from pathlib import Path

import pytest
from support import write_source_catalog

from arch_competition_ops.automation import run_automation_batch
from arch_competition_ops.cli import main
from arch_competition_ops.ingest import IngestResult
from arch_competition_ops.locking import (
    LockHeldError,
    exclusive_lock,
    is_locked,
    read_lock_holder,
)
from arch_competition_ops.settings import Settings

SRC_DIR = str(Path(__file__).resolve().parents[1] / "src")

HOLDER_SCRIPT = """
import os
import sys
from pathlib import Path
from arch_competition_ops.locking import exclusive_lock

with exclusive_lock(Path(sys.argv[1]), label="child"):
    print("locked", os.getpid(), flush=True)
    sys.stdin.readline()
"""


@pytest.fixture
def lock_holder(tmp_path):
    """A separate process that holds ``tmp_path/ingest.lock`` until the test releases it."""
    lock_path = tmp_path / "ingest.lock"
    process = subprocess.Popen(
        [sys.executable, "-c", HOLDER_SCRIPT, str(lock_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "PYTHONPATH": SRC_DIR},
    )
    marker, pid = process.stdout.readline().split()
    assert marker == "locked"
    process.child_pid = int(pid)  # the venv launcher makes Popen.pid differ from the real owner
    try:
        yield lock_path, process
    finally:
        process.stdin.close()
        process.wait(timeout=10)


def test_lock_is_exclusive_and_reports_its_holder(tmp_path) -> None:
    lock_path = tmp_path / "locks" / "ingest.lock"

    with exclusive_lock(lock_path, label="batch:a") as holder:
        assert holder.pid == os.getpid()
        assert is_locked(lock_path)
        with pytest.raises(LockHeldError) as excinfo, exclusive_lock(lock_path, label="batch:b"):
            pass
        assert excinfo.value.holder is not None
        assert excinfo.value.holder.label == "batch:a"
        assert str(os.getpid()) in str(excinfo.value)

    assert not is_locked(lock_path)
    with exclusive_lock(lock_path):  # released: it can be taken again
        pass


def test_lock_is_released_when_the_body_raises(tmp_path) -> None:
    lock_path = tmp_path / "ingest.lock"

    with pytest.raises(RuntimeError), exclusive_lock(lock_path):
        raise RuntimeError("batch crashed")

    assert not is_locked(lock_path)


def test_a_lock_held_by_another_process_blocks_this_one(lock_holder) -> None:
    lock_path, process = lock_holder

    assert is_locked(lock_path)
    holder = read_lock_holder(lock_path)
    assert holder is not None and holder.pid == process.child_pid and holder.label == "child"
    with pytest.raises(LockHeldError), exclusive_lock(lock_path):
        pass

    process.stdin.write("\n")
    process.stdin.flush()
    process.wait(timeout=10)
    assert not is_locked(lock_path)  # the OS drops the lock with its owner: nothing stale to clear


def test_lock_survives_a_crashed_owner(tmp_path) -> None:
    lock_path = tmp_path / "ingest.lock"
    process = subprocess.Popen(
        [sys.executable, "-c", HOLDER_SCRIPT, str(lock_path)],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        text=True,
        env={**os.environ, "PYTHONPATH": SRC_DIR},
    )
    marker, pid = process.stdout.readline().split()
    assert marker == "locked"
    subprocess.run(
        ["taskkill", "/F", "/PID", pid], check=True, capture_output=True
    ) if os.name == "nt" else os.kill(int(pid), 9)
    process.wait(timeout=10)

    assert not is_locked(lock_path)
    with exclusive_lock(lock_path):
        pass


def test_threads_cannot_hold_the_lock_at_once(tmp_path) -> None:
    lock_path = tmp_path / "ingest.lock"
    inside = []
    errors = []
    barrier = threading.Barrier(2)

    def worker() -> None:
        barrier.wait()
        try:
            with exclusive_lock(lock_path):
                inside.append(1)
                threading.Event().wait(0.2)
        except LockHeldError as exc:
            errors.append(exc)

    threads = [threading.Thread(target=worker) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert len(inside) + len(errors) == 2
    assert len(inside) >= 1


# -- batches --------------------------------------------------------------------------------------


def test_ai_sources_overlap_but_share_the_batch_lock(tmp_path, monkeypatch):
    from types import SimpleNamespace

    from arch_competition_ops.automation import AutomationBatchDefinition

    barrier = threading.Barrier(2)
    settings = Settings(root=tmp_path, ai_enabled=True, _env_file=None)
    sources = [SimpleNamespace(source_id=name) for name in ["first", "second"]]
    monkeypatch.setattr(
        "arch_competition_ops.automation.resolve_batch_sources",
        lambda *a, **k: (AutomationBatchDefinition(batch_id="all", max_workers=2), sources),
    )

    def ingest(s, *, source_id, **kwargs):
        assert is_locked(s.resolve_path(s.ingest_lock))
        barrier.wait(timeout=3)
        return IngestResult(source_id=source_id, status="success", document_count=5, deferred=2)

    monkeypatch.setattr("arch_competition_ops.automation.ingest_source", ingest)
    result = run_automation_batch(settings, batch_id="all")
    assert not result.has_failures
    assert [r.source_id for r in result.succeeded] == ["first", "second"]
    assert all(r.document_count == 5 and r.deferred == 2 for r in result.succeeded)


def _write_batch_config(root: Path) -> None:
    write_source_catalog(root, "ted_design_notices")
    (root / "config" / "automation.yml").write_text(
        "batches:\n  - batch_id: official\n    include_kinds: [official_procurement]\n"
        "    limit_per_source: 3\n",
        encoding="utf-8",
    )


def test_batch_holds_the_ingest_lock_while_it_runs(tmp_path, monkeypatch) -> None:
    _write_batch_config(tmp_path)
    settings = Settings(root=tmp_path)
    observed = {}

    def fake_ingest(settings_arg, *, source_id, limit, publication_date_from):
        observed["locked_during_ingest"] = is_locked(
            settings_arg.resolve_path(settings_arg.ingest_lock)
        )
        return IngestResult(source_id=source_id, status="success", ingested_ids=["a"])

    monkeypatch.setattr("arch_competition_ops.automation.ingest_source", fake_ingest)

    result = run_automation_batch(settings, batch_id="official")

    assert observed == {"locked_during_ingest": True}
    assert result.total_ingested == 1
    assert not is_locked(settings.resolve_path(settings.ingest_lock))


def test_second_batch_is_refused_while_the_first_is_running(tmp_path, monkeypatch, capsys) -> None:
    _write_batch_config(tmp_path)
    monkeypatch.chdir(tmp_path)
    ingested = []
    monkeypatch.setattr(
        "arch_competition_ops.automation.ingest_source",
        lambda *a, **k: ingested.append(1),
    )
    lock_path = Settings(root=tmp_path).resolve_path(Settings(root=tmp_path).ingest_lock)

    with exclusive_lock(lock_path, label="batch:other"):
        assert main(["ingest-batch", "--batch-id", "official"]) == 75
        assert main(["ingest-lock-status"]) == 75

    output = capsys.readouterr().out
    assert "Lock is held by another process" in output
    assert "batch:other" in output
    assert ingested == []
    assert main(["ingest-lock-status"]) == 0


def test_ingest_lock_status_reports_a_lock_held_by_another_process(
    tmp_path, monkeypatch, capsys, lock_holder
) -> None:
    lock_path, process = lock_holder
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("ARCH_COMPETITION_OPS_INGEST_LOCK", str(lock_path))

    assert main(["ingest-lock-status"]) == 75

    assert f"pid={process.child_pid}" in capsys.readouterr().out


def test_ingest_batch_command_runs_lists_and_reports_failures(
    tmp_path, monkeypatch, capsys
) -> None:
    _write_batch_config(tmp_path)
    monkeypatch.chdir(tmp_path)

    assert main(["ingest-batch", "--list-batches"]) == 0
    assert "official | limit=3" in capsys.readouterr().out

    outcomes = iter(
        [IngestResult(source_id="ted_design_notices", status="success", ingested_ids=["x", "y"])]
    )
    monkeypatch.setattr(
        "arch_competition_ops.automation.ingest_source", lambda *a, **k: next(outcomes)
    )
    assert main(["ingest-batch", "--batch-id", "official", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["total_ingested"] == 2 and payload["has_failures"] is False

    def failing(*_args, **_kwargs):
        raise RuntimeError("source exploded")

    monkeypatch.setattr("arch_competition_ops.automation.ingest_source", failing)
    assert main(["ingest-batch", "--batch-id", "official"]) == 1
    assert "[FAIL] ted_design_notices :: source exploded" in capsys.readouterr().out


def test_partial_source_failures_make_the_batch_exit_nonzero(tmp_path, monkeypatch, capsys) -> None:
    from arch_competition_ops.ingest import DocumentFailure

    _write_batch_config(tmp_path)
    monkeypatch.chdir(tmp_path)
    partial = IngestResult(
        source_id="ted_design_notices",
        status="completed_with_failures",
        ingested_ids=["x"],
        failures=[DocumentFailure("https://e/1", "parse", "bad payload")],
    )
    monkeypatch.setattr("arch_competition_ops.automation.ingest_source", lambda *a, **k: partial)

    assert main(["ingest-batch", "--batch-id", "official"]) == 1

    assert (
        "[PARTIAL] ted_design_notices :: ingested=1 :: skipped_documents=1"
        in capsys.readouterr().out
    )


def test_unknown_batch_and_missing_batch_id_are_usage_errors(tmp_path, monkeypatch, capsys) -> None:
    _write_batch_config(tmp_path)
    monkeypatch.chdir(tmp_path)

    assert main(["ingest-batch", "--batch-id", "nope"]) == 2
    assert "Unknown automation batch: nope" in capsys.readouterr().out
    assert main(["ingest-batch"]) == 2
    assert "--batch-id is required" in capsys.readouterr().out
