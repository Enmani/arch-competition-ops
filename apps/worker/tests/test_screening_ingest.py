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
        lambda *_a, **_kw: [CollectedSourceDocument(source.base_url, NOTICE)],
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **_kw: r)
    with mock_client(lambda _r: response(decision_payload(decision="exclude"))) as client:
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
                    evidence=[{"field": "notice_text", "quote": "Stationery supply"}],
                    extracted_fields=[
                        {
                            "field": "title",
                            "value": "Stationery supply",
                            "evidence_field": "notice_text",
                            "quote": "Stationery supply",
                        }
                    ],
                )
            )
        return response(decision_payload())

    # Each stage opens and closes its own client, as create_client does in production.
    monkeypatch.setattr(service, "create_client", lambda _settings: mock_client(handler))
    first = ingest_source(settings, source_id="city")
    calls_after_first = len(calls)
    second = ingest_source(settings, source_id="city")
    calls_after_second = len(calls)
    # A corrigendum changes the listed content, so that notice alone is screened again.
    listing[0] = CollectedSourceDocument(
        "https://city.example/n/1", NOTICE.replace("EUR 50,000", "EUR 60,000")
    )
    third = ingest_source(settings, source_id="city")

    assert calls_after_first == 2  # one triage batch, one assessment
    assert len(first.ingested_ids) == 2
    # Unchanged notices are neither triaged nor assessed again, the excluded one included.
    assert calls_after_second == calls_after_first
    assert second.already_screened == 2
    assert third.already_screened == 1
    assert calls[calls_after_second:] == ["/v1/responses"]
