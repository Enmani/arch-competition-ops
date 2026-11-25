from test_ai_screening import (  # noqa: F401
    NOTICE,
    ai_workspace,
    decision_payload,
    mock_client,
    response,
)

from arch_competition_ops.storage.connection import connect


def test_raw_notice_ingestion_publishes_exclusion_without_changing_human_status(
    ai_workspace,  # noqa: F811
    monkeypatch,
):
    settings, source = ai_workspace
    import yaml

    from arch_competition_ops.collectors.base import CollectedSourceDocument
    from arch_competition_ops.ingest import ingest_source
    from arch_competition_ops.screening import service

    settings.ai_enabled = True
    (settings.root / "config" / "sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}),
        encoding="utf-8",
    )
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda *_a, **_kw: [CollectedSourceDocument(source.base_url + "notice/1", NOTICE)],
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **_kw: r)
    with mock_client(lambda _r: response(decision_payload(decision="recommend"))) as client:
        monkeypatch.setattr(service, "create_client", lambda _settings: client)
        first = ingest_source(settings, source_id="city")
        assert len(first.ingested_ids) == 1
        from arch_competition_ops.storage.screening import latest_screening_notice_text

        assert "Civic School Design Competition" in latest_screening_notice_text(
            settings.resolve_path(settings.db), first.ingested_ids[0]
        )
    settings.ai_reasoning_effort = "medium"
    with mock_client(
        lambda _r: response(
            decision_payload(decision="exclude", title_quote="", extracted_fields=[])
        )
    ) as client:
        monkeypatch.setattr(service, "create_client", lambda _settings: client)
        result = ingest_source(settings, source_id="city")
    assert not result.failures
    with connect(settings.resolve_path(settings.db)) as connection:
        record = connection.execute("SELECT * FROM competitions").fetchone()
        advice = connection.execute("SELECT * FROM ai_screening_results").fetchone()
    assert record["status"] == "discovered"
    assert record["location_label"] == "Via Roma 10, Milano"
    assert advice["decision"] == "exclude"
    assert advice["source_updated_at"] == record["updated_at"]


def test_ingest_screens_each_listed_notice_once_until_its_content_changes(
    ai_workspace,  # noqa: F811
    monkeypatch,
):
    settings, source = ai_workspace
    import yaml

    from arch_competition_ops.collectors.base import CollectedSourceDocument
    from arch_competition_ops.ingest import ingest_source
    from arch_competition_ops.screening import service

    settings.ai_enabled = True
    (settings.root / "config" / "sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}),
        encoding="utf-8",
    )
    listing = [
        CollectedSourceDocument("https://city.example/n/1", NOTICE),
        CollectedSourceDocument("https://city.example/n/2", "<p>Stationery supply</p>"),
    ]
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents", lambda *_a, **_kw: list(listing)
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **_kw: r)
    calls = []

    def handler(request):
        calls.append(request.url.path)
        if "Stationery" in request.content.decode():
            return response(
                decision_payload(
                    decision="exclude",
                    evidence=["Stationery supply"],
                    extracted_fields=[],
                    title_quote="",
                )
            )
        return response(decision_payload())

    # Each stage opens and closes its own client, as create_client does in production.
    monkeypatch.setattr(service, "create_client", lambda _settings: mock_client(handler))
    import shutil
    import subprocess

    from support import REPO_ROOT

    def export_diff(sequence):
        # Use the real exporter and its D1 schema in a local SQLite fixture. Includes marker writes.
        process = subprocess.run(
            [
                shutil.which("node"),
                str(REPO_ROOT / "tests/helpers/worker-export-diff.mjs"),
                str(settings.resolve_path(settings.db)),
                str(settings.root),
                str(sequence),
            ],
            cwd=REPO_ROOT,
            capture_output=True,
            text=True,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            check=True,
        )
        return int(process.stdout)

    first = ingest_source(settings, source_id="city")
    assert export_diff(1) > 0
    calls_after_first = len(calls)
    original = listing[:]
    listing[:] = [
        original[1],
        CollectedSourceDocument(
            original[0].source_url,
            NOTICE + '<input name="csrf" value="rotated"><script>timestamp=2</script>',
        ),
        original[1],
    ]
    second = ingest_source(settings, source_id="city")
    from arch_competition_ops.storage.connection import connect

    with connect(settings.resolve_path(settings.db)) as db:
        assert db.execute("SELECT count(*) FROM items").fetchone()[0] == 2
    assert export_diff(2) == 0
    listing[:] = original
    calls_after_second = len(calls)
    # A corrigendum changes the listed content, so that notice alone is screened again.
    listing[0] = CollectedSourceDocument(
        "https://city.example/n/1", NOTICE.replace("EUR 50,000", "EUR 60,000")
    )
    third = ingest_source(settings, source_id="city")

    assert calls_after_first == 2  # one decision per notice
    assert len(first.ingested_ids) == 1 and first.filtered_out == 1 and not first.failures
    # Neither the kept notice nor the excluded notice needs a second assessment.
    assert calls_after_second == calls_after_first
    assert second.already_screened >= 2
    assert third.already_screened == 1
    assert calls[calls_after_second:] == ["/v1/responses"]

    export_diff(3)  # Publish the amendment before comparing a new judgment of the same notice.
    settings.ai_reasoning_effort = "medium"
    before = len(calls)
    ingest_source(settings, source_id="city")
    assert len(calls) == before + 2
    assert export_diff(4) == 0

    from arch_competition_ops.screening.models import ScreeningAnswer

    # An output contract change invalidates both the queue judgment and the paid-request cache.
    monkeypatch.setattr(ScreeningAnswer, "schema_version", ScreeningAnswer.schema_version + 1)
    for index in (1, 2):
        ingest_source(settings, source_id="city", limit=1)
        assert len(calls) == before + 2 + index
    assert export_diff(5) == 0
