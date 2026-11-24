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
