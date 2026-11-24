from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
import yaml
from support import write_source_catalog
from test_ai_screening import (  # noqa: F401
    NOTICE,
    ai_workspace,
    decision_payload,
    mock_client,
    response,
)

from arch_competition_ops import clock
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.http import HttpStatusError, HttpTransportError
from arch_competition_ops.ingest import IngestError, ingest_source
from arch_competition_ops.locking import LockHeldError
from arch_competition_ops.screening import service
from arch_competition_ops.screening.client import ScreeningError, ScreeningPaused
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import backlog
from arch_competition_ops.storage.connection import connect

URL = "https://city.example/n/1?token=PRIVATE#PRIVATE"
DOC = CollectedSourceDocument(URL, NOTICE)


@pytest.fixture
def workspace(ai_workspace, monkeypatch):  # noqa: F811
    settings, source = ai_workspace
    settings.ai_enabled = True
    (settings.root / "config/sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}), encoding="utf-8"
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **kw: r)
    monkeypatch.setattr(
        service, "create_client", lambda _: mock_client(lambda _: response(decision_payload()))
    )
    return settings, source, initialize_database(settings)


@pytest.mark.parametrize(
    ("error", "specific"),
    [
        *[
            (ScreeningError(code), True)
            for code in (
                "invalid_schema",
                "missing_text",
                "max_tokens",
                "refusal",
                "http_400",
                "http_413",
            )
        ],
        *[
            (ScreeningError(code), False)
            for code in ("http_500", "http_529", "transport_error", "api_error")
        ],
        (ScreeningPaused("http_429"), False),
        (ScreeningPaused("insufficient_quota"), False),
        (LockHeldError(Path("private"), None), False),
        (HttpTransportError("PRIVATE", url=URL), False),
        *[(HttpStatusError("PRIVATE", url=URL, status_code=code), False) for code in (403, 429)],
    ],
)
def test_notice_attempts_and_transient_backoff(workspace, monkeypatch, error, specific):
    settings, source, db = workspace
    now = datetime(2026, 11, 24, tzinfo=UTC)
    monkeypatch.setattr(clock, "now_utc", lambda: now)
    calls = []

    def fail(*a, **kw):
        calls.append(1)
        raise error

    monkeypatch.setattr(service, "assess_document", fail)

    def run():
        return ingest_source(settings, source_id=source.source_id, collected_documents=[DOC])

    result = run()
    with connect(db) as cx:
        assert tuple(cx.execute("SELECT attempts,status FROM notice_backlog").fetchone()) == (
            int(specific),
            "queued",
        )
    if not specific:
        assert any("deferred" in n for n in result.notes)
        run()
        assert len(calls) == 1
        now += timedelta(days=2)
        run()
        assert len(calls) == 2


@pytest.mark.parametrize("fails", [False, True])
def test_prior_hash_is_finished_by_row_id(workspace, monkeypatch, fails):
    settings, source, db = workspace
    ingest_source(
        settings, source_id=source.source_id, collected_documents=[DOC], collect_only=True
    )
    with connect(db) as cx:
        cx.execute("UPDATE notice_backlog SET content_hash='old-hash'")
    if fails:

        def fail(*args, **kw):
            raise ScreeningError("invalid_schema")

        monkeypatch.setattr(service, "assess_document", fail)
    ingest_source(settings, source_id=source.source_id, collected_documents=[])
    with connect(db) as cx:
        assert tuple(cx.execute("SELECT status,attempts FROM notice_backlog").fetchone()) == (
            "queued" if fails else "done",
            1,
        )
        if not fails:
            assert (
                cx.execute("SELECT content_hash FROM ai_notice_ledger").fetchone()[0] == "old-hash"
            )


def test_source_groups_keep_notice_order(tmp_path, monkeypatch):
    from arch_competition_ops import automation
    from arch_competition_ops.ingest import IngestResult

    ids = ["ted_design_notices", "simap_public_design_notices"]
    write_source_catalog(tmp_path, *ids)
    (tmp_path / "config/automation.yml").write_text(
        "batches:\n  - batch_id: all\n    max_workers: 1\n"
    )
    settings = Settings(root=tmp_path, ai_enabled=True)
    db = initialize_database(settings)
    for i, source in enumerate(ids * 2):
        backlog.enqueue(
            db,
            source,
            [CollectedSourceDocument(f"https://city.example/{i}", str(i))],
            None,
            unfinished=0,
            cap=10,
        )
    calls = []

    def read(settings, source_id, **kwargs):
        if "queued_row_ids" in kwargs:
            calls.append((source_id, kwargs["queued_row_ids"]))
        return IngestResult(source_id, "success")

    monkeypatch.setattr(automation, "ingest_source", read)
    automation.run_automation_batch(settings, batch_id="all")
    assert calls == [(ids[1], [2, 4]), (ids[0], [1, 3])]


def test_terminal_payload_retention_preserves_reason_and_pending_text(tmp_path):
    from arch_competition_ops.storage.screening import shrink_old_screening_runs

    db = initialize_database(Settings(root=tmp_path))
    states = ["failed", "aged_out", "expired_unread", "queued"]
    with connect(db) as cx:
        for state in states:
            cx.execute(
                "INSERT INTO notice_backlog(source_id,source_url,content_hash,payload,"
                "first_seen,status,last_error) VALUES('city','https://city.example',?,"
                "'private text','2026-01-01',?,'reason')",
                (state, state),
            )
    shrink_old_screening_runs(db, started_before=date(2026, 2, 1))
    with connect(db) as cx:
        rows = list(
            cx.execute("SELECT status,payload,last_error FROM notice_backlog ORDER BY rowid")
        )
    assert [tuple(r) for r in rows] == [
        (s, "private text" if s == "queued" else "", "reason") for s in states
    ]


def test_public_run_logs_hide_credentials_and_exception_body(
    workspace, monkeypatch, caplog, capsys
):
    from arch_competition_ops.cli import _print_ingest_result

    settings, source, db = workspace

    def fail(*a, **kw):
        raise HttpStatusError("PRIVATE", url=URL, status_code=403)

    monkeypatch.setattr(service, "assess_document", fail)
    result = ingest_source(settings, source_id=source.source_id, collected_documents=[DOC])
    _print_ingest_result(result)
    monkeypatch.setattr("arch_competition_ops.ingest.collect_source_documents", fail)
    with pytest.raises(IngestError) as exc:
        ingest_source(settings, source_id=source.source_id)
    logged = caplog.text + capsys.readouterr().out + str(exc.value)
    assert "PRIVATE" not in logged and "?token=" not in logged
    assert "http_403" in logged


@pytest.mark.parametrize("repeated", [False, True])
def test_invalid_cursor_and_repeated_pages_recover_first_page(tmp_path, monkeypatch, repeated):
    from arch_competition_ops.collectors import ted

    write_source_catalog(tmp_path, "ted_design_notices")
    settings = Settings(root=tmp_path, ai_candidate_cap=1, ai_enabled=False)
    calls = []

    def fetch(url, body):
        token = body.get("iterationNextToken")
        calls.append(token)
        if token and not repeated:
            raise HttpStatusError("expired PRIVATE", url=url, status_code=400)
        number = "one" if len(calls) < 3 else "new"
        return {
            "notices": [{"publication-number": number, "notice-title": {"eng": number}}],
            "iterationNextToken": f"page{len(calls)}",
        }

    monkeypatch.setattr(ted, "_default_fetch_json", fetch)

    def run():
        return ingest_source(settings, source_id="ted_design_notices", collect_only=True)

    run()
    recovered = run()
    if repeated:
        assert any("paging_reset=repeated_page" in line for line in recovered.notes)
        assert any("unavailable_windows=1" in line for line in recovered.notes)
        run()
    else:
        assert any("cursor_reset=http_400" in line for line in recovered.notes)
    assert calls == [None, "page1", None]
    with connect(settings.resolve_path(settings.db)) as cx:
        assert cx.execute("SELECT count(*) FROM notice_backlog").fetchone()[0] == 2


def test_changed_model_reopens_failed_with_fresh_attempts_during_discovery_outage(
    workspace, monkeypatch
):
    settings, source, db = workspace
    calls = []

    def fail(*args, **kwargs):
        calls.append(1)
        raise ScreeningError("invalid_schema")

    monkeypatch.setattr(service, "assess_document", fail)
    for _ in range(4):
        ingest_source(settings, source_id=source.source_id, collected_documents=[DOC])
    assert len(calls) == 3
    settings.ai_reasoning_effort = "medium"

    def offline(*args, **kwargs):
        raise HttpTransportError("unavailable", url=URL)

    monkeypatch.setattr("arch_competition_ops.ingest.collect_source_documents", offline)
    with pytest.raises(IngestError):
        ingest_source(settings, source_id=source.source_id)
    row = backlog.queued(db, source.source_id, 1)[0]
    for _ in range(4):
        ingest_source(settings, source_id=source.source_id, queued_row_ids=[row.row_id])
    assert len(calls) == 6
    with connect(db) as cx:
        assert tuple(cx.execute("SELECT status,attempts FROM notice_backlog").fetchone()) == (
            "failed",
            3,
        )


def test_cursor_restart_shares_item_cap_and_reports_failed_restart(tmp_path, monkeypatch):
    from arch_competition_ops.collectors import ted

    write_source_catalog(tmp_path, "ted_design_notices")
    settings = Settings(root=tmp_path, ai_candidate_cap=1, ai_enabled=False)
    monkeypatch.setattr(ted, "TED_PAGE_SIZE", 1)
    calls = []
    offline = False

    def fetch(url, body):
        token = body.get("iterationNextToken")
        calls.append(token)
        if offline or token == "next2":
            raise HttpStatusError("expired PRIVATE", url=url, status_code=400)
        number = 1 if token is None else 2
        return {
            "notices": [{"publication-number": str(number)}],
            "iterationNextToken": f"next{number}",
        }

    monkeypatch.setattr(ted, "_default_fetch_json", fetch)

    def run():
        return ingest_source(settings, source_id="ted_design_notices", collect_only=True)

    run()
    settings.ai_candidate_cap = 2
    result = run()
    assert calls == [None, "next1", "next2", None]
    assert any("cursor_reset=http_400" in note for note in result.notes)
    offline = True
    with pytest.raises(IngestError, match="unavailable_windows=1"):
        run()
    assert calls[-2:] == ["next1", None]
    with connect(settings.resolve_path(settings.db)) as cx:
        assert not cx.execute("SELECT * FROM collection_resume").fetchall()


def test_enrichment_warning_omits_remote_identifier_and_error_text(monkeypatch, caplog):
    from arch_competition_ops.postprocess import anac

    def fail(*args, **kwargs):
        raise HttpStatusError("PRIVATE", url=URL, status_code=503)

    monkeypatch.setattr(anac, "fetch_json_get", fail)
    assert anac.fetch_notice_detail("notice?token=PRIVATE") is None
    assert "PRIVATE" not in caplog.text
    assert "http_503" in caplog.text
