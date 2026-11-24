from datetime import date

import pytest
from support import write_source_catalog

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.ingest import IngestError, ingest_source
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.backlog import queued
from arch_competition_ops.storage.connection import connect


def test_collection_resumes_after_outage_and_read_budget(tmp_path, monkeypatch):
    source = "ted_design_notices"
    write_source_catalog(tmp_path, source)
    settings = Settings(root=tmp_path, ai_enabled=False)
    start = "2026-05-06"
    old = CollectedSourceDocument("https://example.org/1", "Goods: public library renovation")
    amended = CollectedSourceDocument(old.source_url, old.payload + " Deadline extended")
    new = CollectedSourceDocument("https://example.org/2", "Hospital planning")
    attempts = []

    def collect(*args, publication_date_from, **kwargs):
        attempts.append(publication_date_from)
        if len(attempts) == 1:
            raise PermissionError("403")
        return [old, old] if len(attempts) == 2 else [amended, new]

    monkeypatch.setattr("arch_competition_ops.ingest.collect_source_documents", collect)

    def forbid(*args, **kwargs):
        pytest.fail("collection spent reading budget")

    monkeypatch.setattr("arch_competition_ops.ingest.assess_documents", forbid)
    with pytest.raises(IngestError):
        ingest_source(settings, source_id=source, publication_date_from=start)
    clock.set_today_provider(lambda: date(2026, 6, 1))
    result = ingest_source(settings, source_id=source, limit=1, collect_only=True)
    assert attempts == [start, start]
    assert "new=1" in result.notes[0]
    ingest_source(settings, source_id=source, limit=1)
    db = settings.resolve_path(settings.db)
    assert queued(db, source, 1) == [old]
    assert queued(db, source, 10) == [old, amended, new]
    with connect(db) as cx:
        assert cx.execute("SELECT count(*) FROM competitions").fetchone()[0] == 0


@pytest.mark.parametrize("provider", ["openai", "anthropic"])
def test_quota_pauses_all_sources_and_preserves_oldest_notice(tmp_path, monkeypatch, provider):
    import httpx
    from test_ai_screening import mock_client

    from arch_competition_ops.automation import run_automation_batch
    from arch_competition_ops.screening import service

    sources = ["ted_design_notices", "simap_public_design_notices"]
    write_source_catalog(tmp_path, *sources)
    (tmp_path / "config/automation.yml").write_text(
        "batches:\n  - batch_id: all\n    max_workers: 1\n", encoding="utf8"
    )
    settings = Settings(
        root=tmp_path,
        ai_provider=provider,
        ai_model="gpt-6-luna" if provider == "openai" else "claude-haiku-5-5",
        anthropic_api_key="fixture-only",
        ai_enabled=True,
        ai_concurrency=1,
        ai_fetch_details=False,
    )
    calls = []

    def fail(request):
        calls.append(request.read())
        return httpx.Response(
            429, json={"error": {"code": "insufficient_quota", "message": "quota"}}
        )

    if provider == "openai":
        monkeypatch.setattr(service, "create_client", lambda _: mock_client(fail))
    else:
        from test_anthropic_screening import reply

        from arch_competition_ops.screening.anthropic import AnthropicMessages

        def no_credit(self, request, **kwargs):
            calls.append(request.body)
            return reply(
                400, error={"type": "invalid_request_error", "message": "credit balance is too low"}
            )

        monkeypatch.setattr(AnthropicMessages, "send", no_credit)
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda source, **kwargs: [
            CollectedSourceDocument(f"https://city.example/{source.source_id}", "Library")
        ],
    )
    run_automation_batch(settings, batch_id="all")
    monkeypatch.setattr("arch_competition_ops.ingest.collect_source_documents", lambda *a, **k: [])
    run_automation_batch(settings, batch_id="all")
    assert len(calls) == 2 and calls[0] == calls[1]
    with connect(settings.resolve_path(settings.db)) as cx:
        rows = cx.execute(
            "SELECT source_id,status,attempts,last_error FROM notice_backlog ORDER BY rowid"
        ).fetchall()
    assert [tuple(r) for r in rows] == [
        (sources[0], "queued", 0, "insufficient_quota"),
        (sources[1], "queued", 0, None),
    ]


def test_poison_notice_releases_slot_and_changed_criteria_requeues(tmp_path):
    from arch_competition_ops.bootstrap import initialize_database
    from arch_competition_ops.storage import backlog

    db = initialize_database(Settings(root=tmp_path))
    docs = [CollectedSourceDocument(f"https://city.example/{n}", f"Project {n}") for n in range(2)]
    backlog.enqueue(db, "city", docs, "v1", unfinished=0, cap=2)
    for _ in range(3):
        backlog.record_failure(db, "city", docs[0], "invalid_schema", criteria="v1", limit=3)
    assert queued(db, "city", 1) == docs[1:]
    backlog.enqueue(db, "city", [], "v1", unfinished=0, cap=2)
    assert queued(db, "city", 1) == docs[1:]
    backlog.enqueue(db, "city", [], "v2", unfinished=0, cap=2)
    assert queued(db, "city", 1) == docs[:1]


def test_backfill_never_grows_caps_and_resumes_ted_page(tmp_path, monkeypatch):
    from arch_competition_ops.collectors import ted
    from arch_competition_ops.ingest import ingest_source

    write_source_catalog(tmp_path, "ted_design_notices")
    settings = Settings(root=tmp_path, ai_candidate_cap=1, ai_enabled=False)
    calls = []

    def fetch(url, body):
        calls.append(body.copy())
        i = int(body.get("iterationNextToken", 0))
        return {
            "notices": [{"publication-number": str(i), "notice-title": {"eng": f"Library {i}"}}],
            "iterationNextToken": str(i + 1),
        }

    monkeypatch.setattr(ted, "_default_fetch_json", fetch)
    for _ in range(5):
        ingest_source(
            settings,
            source_id="ted_design_notices",
            publication_date_from="2026-01-01",
            collect_only=True,
        )
    assert len(calls) == 5
    assert [int(c.get("iterationNextToken", 0)) for c in calls] == list(range(5))
    assert all(c["limit"] == 1 and "<=" in c["query"] for c in calls)


def test_expired_and_aged_notices_do_not_spend_read_slots(tmp_path):
    from arch_competition_ops.bootstrap import initialize_database
    from arch_competition_ops.storage import backlog

    db = initialize_database(Settings(root=tmp_path))
    docs = [
        CollectedSourceDocument("https://city.example/a", '{"deadline":"2026-05-12","title":"A"}'),
        CollectedSourceDocument("https://city.example/b", "Old library"),
    ]
    backlog.enqueue(db, "city", docs, "v", unfinished=0, cap=2)
    with connect(db) as cx:
        cx.execute("UPDATE notice_backlog SET first_seen='2001-01-01' WHERE status='queued'")
        cx.commit()
    _, count, report, _ = backlog.enqueue(db, "city", [], "v", unfinished=0, cap=2)
    assert count == 0 and "expired_unread=1" in report and "aged_out=1" in report
