from __future__ import annotations

import json
from datetime import timedelta

import httpx
import pytest
from openai import OpenAI
from support import REPO_ROOT, build_source, write_minimal_config

from arch_competition_ops import clock
from arch_competition_ops.cli import main
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.screening.extraction import extract_record
from arch_competition_ops.screening.models import ScreeningDecision, validate_evidence
from arch_competition_ops.screening.service import assess_document
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import delete_competitions, upsert_competition
from arch_competition_ops.storage.connection import connect
from arch_competition_ops.storage.screening import (
    ScreeningBudgetExceeded,
    list_screenings,
    reserve_screening,
)

NOTICE = """<html><h1>Civic School Design Competition</h1>
<p>Project site: Via Roma 10, Milano. Buyer office: Torino.</p>
<p>Prize fund: EUR 50,000. Contract value: EUR 350,000.</p>
<p>Open to registered architects. An appointment for detailed design follows the contest.</p>
<a href='/competition'>Official competition website</a></html>"""


def decision_payload(**overrides):
    result = {
        "decision": "needs_review",
        "relevance_score": 80,
        "summary_zh": "学校设计项目，费用待核实。",
        "summary_en": "School design; fees unknown.",
        "reasons_zh": ["面向注册建筑师"],
        "reasons_en": ["For registered architects"],
        "missing_information": ["registration_fee"],
        "evidence": [{"field": "notice_text", "quote": "Open to registered architects."}],
        "extracted_fields": [
            {
                "field": "title",
                "value": "Civic School Design Competition",
                "evidence_field": "notice_text",
                "quote": "Civic School Design Competition",
            },
            {
                "field": "location_label",
                "value": "Via Roma 10, Milano",
                "evidence_field": "notice_text",
                "quote": "Project site: Via Roma 10, Milano.",
            },
            {
                "field": "prize_summary",
                "value": "Prize fund: EUR 50,000.",
                "evidence_field": "notice_text",
                "quote": "Prize fund: EUR 50,000.",
            },
            {
                "field": "estimated_contract_value_eur",
                "value": "350000",
                "evidence_field": "notice_text",
                "quote": "Contract value: EUR 350,000.",
            },
            {
                "field": "official_url",
                "value": "https://city.example/competition",
                "evidence_field": "notice_links",
                "quote": "https://city.example/competition",
            },
        ],
    }
    result.update(overrides)
    return result


@pytest.fixture
def ai_workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    write_minimal_config(tmp_path, "sources: []")
    (tmp_path / "config" / "taxonomy.yml").write_text(
        (REPO_ROOT / "config" / "taxonomy.yml").read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    settings = Settings(root=tmp_path, _env_file=None, openai_api_key="test-secret")
    source = build_source(
        "city",
        name="City",
        jurisdiction="italy",
        base_url="https://city.example/",
        scan_method="html",
        extractor="generic_listing_html",
        collector="generic_notice_pages",
    )
    return settings, source


def mock_client(handler):
    return OpenAI(
        api_key="test-secret",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def response(payload, *, status="completed"):
    return httpx.Response(
        200,
        json={
            "id": "resp-test",
            "object": "response",
            "created_at": 1,
            "model": "gpt-6-luna",
            "status": status,
            "output": [
                {
                    "type": "message",
                    "id": "msg-test",
                    "role": "assistant",
                    "status": "completed",
                    "content": [
                        {"type": "output_text", "text": json.dumps(payload), "annotations": []}
                    ],
                }
            ],
            "usage": {"input_tokens": 2000, "output_tokens": 1000, "total_tokens": 3000},
        },
    )


def test_ai_extracts_site_prize_and_contract_without_source_specific_parser(ai_workspace):
    settings, source = ai_workspace
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        assert body["model"] == "gpt-6-luna"
        assert body["reasoning"] == {"effort": "high"}
        assert body["store"] is False
        assert body["text"]["format"]["strict"] is True
        return response(decision_payload())

    with mock_client(handler) as client:
        first = assess_document(
            settings,
            source=source,
            source_url="https://city.example/n/1",
            payload=NOTICE,
            client=client,
        )
        second = assess_document(
            settings,
            source=source,
            source_url="https://city.example/n/1",
            payload=NOTICE,
            client=client,
        )
    assert len(calls) == 1
    assert second.cached
    assert first.record.location_label == "Via Roma 10, Milano"
    assert first.record.estimated_contract_value_eur == 350000
    assert first.record.prize_summary == "Prize fund: EUR 50,000."
    assert first.record.official_url == "https://city.example/competition"
    assert first.record.registration_fee_eur is None
    assert second.cost_usd == 0


def test_preference_change_invalidates_cached_assessment(ai_workspace):
    settings, source = ai_workspace
    calls = []
    with mock_client(lambda r: (calls.append(r) or response(decision_payload()))) as client:
        for preference in ("Prefer schools", "Prefer hospitals"):
            settings.resolve_path(settings.ai_preferences).write_text(preference, encoding="utf-8")
            assess_document(
                settings,
                source=source,
                source_url="https://city.example/n/1",
                payload=NOTICE,
                client=client,
            )
    assert len(calls) == 2


def test_casing_only_quote_is_restored_to_the_actual_source():
    decision = ScreeningDecision.model_validate(
        decision_payload(
            evidence=[{"field": "notice_text", "quote": "Registered architects"}],
        )
    )
    validate_evidence(decision, {"notice_text": "For registered architects only"})
    assert decision.evidence[0].quote == "registered architects"


def test_ai_classifications_use_existing_labels_and_reject_unknown_ones(ai_workspace):
    settings, source = ai_workspace
    output = decision_payload()
    output["extracted_fields"].extend(
        [
            {
                "field": "building_categories",
                "value": '["education"]',
                "evidence_field": "notice_text",
                "quote": "Civic School Design Competition",
            },
            {
                "field": "project_types",
                "value": '["invented_category"]',
                "evidence_field": "notice_text",
                "quote": "Civic School Design Competition",
            },
        ]
    )
    record, warnings = extract_record(
        ScreeningDecision.model_validate(output),
        {"notice_text": "Civic School Design Competition", "notice_links": ""},
        source=source,
        source_url=source.base_url,
        settings=settings,
    )
    assert record.building_categories == ["education"]
    assert record.project_types == []
    assert warnings


def test_bad_decision_quote_does_not_discard_valid_source_fields_or_hide_the_record(ai_workspace):
    settings, source = ai_workspace
    payload = decision_payload(evidence=[{"field": "notice_text", "quote": "Invented evidence"}])
    with mock_client(lambda _r: response(payload)) as client:
        assessment = assess_document(
            settings,
            source=source,
            source_url="https://city.example/n/1",
            payload=NOTICE,
            client=client,
        )
    assert assessment.record.title == "Civic School Design Competition"
    assert assessment.decision.decision == "needs_review"
    assert assessment.decision.evidence == []
    assert list_screenings(settings.resolve_path(settings.db)) == []
    with connect(settings.resolve_path(settings.db)) as connection:
        row = connection.execute("SELECT * FROM ai_screening_runs").fetchone()
    assert row["status"] == "completed"
    assert row["cost_usd"] > 0


@pytest.mark.parametrize(
    "field,value,quote",
    [
        ("estimated_contract_value_eur", "500000", "Contract value: EUR 350,000."),
        ("estimated_contract_value_eur", "350000", "Contract value: USD 350,000."),
        ("official_url", "https://invented.example/", "https://city.example/competition"),
        ("deadline_at", "2027-02-03", "Submission deadline: 2027-03-02"),
    ],
)
def test_unsupported_amount_currency_url_and_date_stay_unknown(ai_workspace, field, value, quote):
    settings, source = ai_workspace
    output = decision_payload()
    output["extracted_fields"] = [
        output["extracted_fields"][0],
        {
            "field": field,
            "value": value,
            "quote": quote,
            "evidence_field": "notice_links" if field == "official_url" else "notice_text",
        },
    ]
    fields = {
        "notice_text": "Civic School Design Competition " + quote,
        "notice_links": "https://city.example/competition",
    }
    record, warnings = extract_record(
        ScreeningDecision.model_validate(output),
        fields,
        source=source,
        source_url=source.base_url,
        settings=settings,
    )
    assert getattr(record, field) is None
    assert warnings


def test_daily_budget_reservation_is_durable_and_retains_deleted_record_usage(ai_workspace):
    settings, _source = ai_workspace
    db = settings.resolve_path(settings.db)
    comp_id = upsert_competition(
        db, CompetitionRecord(title="A", source_url="https://city.example/a")
    )
    reserve_screening(
        db,
        competition_id=comp_id,
        source_url="https://city.example/a",
        model="gpt-6-luna",
        input_json="{}",
        reserve_usd=0.6,
        budget_usd=31,
    )
    assert delete_competitions(db, competition_ids=[comp_id]) == 1
    with pytest.raises(ScreeningBudgetExceeded, match="daily budget"):
        reserve_screening(
            db,
            competition_id=None,
            source_url="https://city.example/b",
            model="gpt-6-luna",
            input_json="{}",
            reserve_usd=0.5,
            budget_usd=31,
        )


def test_notice_url_identity_survives_title_changes_without_merging_listing_rows(ai_workspace):
    settings, _source = ai_workspace
    db = settings.resolve_path(settings.db)
    first = upsert_competition(
        db,
        CompetitionRecord(
            title="Original notice title",
            source_id="single-pages",
            source_url="https://city.example/n/1",
            source_url_is_notice=True,
        ),
    )
    corrected = upsert_competition(
        db,
        CompetitionRecord(
            title="Corrected notice title",
            source_id="single-pages",
            source_url="https://city.example/n/1",
            source_url_is_notice=True,
        ),
    )
    assert first == corrected
    for title in ["Project A", "Project B"]:
        upsert_competition(
            db,
            CompetitionRecord(
                title=title,
                source_id="listing",
                source_url="https://city.example/",
            ),
        )
    with connect(db) as connection:
        assert connection.execute("SELECT COUNT(*) FROM competitions").fetchone()[0] == 3


def test_account_error_is_sanitized_and_not_retried(ai_workspace):
    settings, source = ai_workspace
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(
            401, json={"error": {"message": "test-secret", "type": "invalid_request_error"}}
        )

    from arch_competition_ops.screening.client import ScreeningError

    with mock_client(handler) as client:
        with pytest.raises(ScreeningError) as error:
            assess_document(
                settings,
                source=source,
                source_url="https://city.example/n/1",
                payload=NOTICE,
                client=client,
            )
    assert len(calls) == 1
    assert "test-secret" not in str(error.value)


def test_cli_dry_run_needs_no_key_and_skips_expired_and_human_discarded(ai_workspace, capsys):
    settings, _source = ai_workspace
    db = settings.resolve_path(settings.db)
    for title, status, days in [
        ("eligible", "discovered", 30),
        ("old", "discovered", -3),
        ("discarded", "discarded", 30),
    ]:
        upsert_competition(
            db,
            CompetitionRecord(
                title=title,
                status=status,
                source_url=f"https://city.example/{title}",
                deadline_at=clock.today() + timedelta(days=days),
            ),
        )
    assert main(["screen-competitions", "--dry-run", "--json"]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["planned"] == 1
    assert payload["results"][0]["title"] == "eligible"
    assert payload["cost_usd"] == 0


def test_raw_notice_ingestion_publishes_exclusion_without_changing_human_status(
    ai_workspace,
    monkeypatch,
):
    settings, source = ai_workspace
    import yaml

    from arch_competition_ops.collectors.base import CollectedSourceDocument
    from arch_competition_ops.ingest import ingest_source
    from arch_competition_ops.screening import service

    settings.ai_enabled = True
    settings.ai_triage_enabled = False
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
