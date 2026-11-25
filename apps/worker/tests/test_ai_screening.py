from __future__ import annotations

import json
from datetime import date

import httpx
import pytest
from openai import OpenAI
from support import REPO_ROOT, build_source, write_minimal_config

from arch_competition_ops import clock
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.screening.extraction import extract_record
from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.models import ScreeningAnswer, validate_evidence
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
        "evidence": ["Open to registered architects."],
        "notice_details": [],
        "extracted_fields": [
            {
                "field": "title",
                "quote": "Civic School Design Competition",
            },
            {
                "field": "location_label",
                "quote": "Via Roma 10, Milano",
            },
            {
                "field": "prize_summary",
                "quote": "Prize fund: EUR 50,000.",
            },
            {
                "field": "estimated_contract_value_eur",
                "value": "350000",
                "quote": "Contract value: EUR 350,000.",
            },
            {
                "field": "official_url",
                "value": "https://city.example/competition",
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
    settings = Settings(
        root=tmp_path,
        _env_file=None,
        ai_provider="openai",
        ai_model="gpt-6-luna",
        openai_api_key="test-secret",
    )
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
        assert body["reasoning"] == {"effort": "low"}
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
    decision = ScreeningAnswer.model_validate(
        decision_payload(
            evidence=["Registered architects"],
        )
    )
    decision = validate_evidence(decision, {"notice_text": "For registered architects only"})
    assert decision.evidence[0].quote == "registered architects"


def test_ai_classifications_use_existing_labels_and_reject_unknown_ones(ai_workspace):
    settings, source = ai_workspace
    output = decision_payload()
    output["extracted_fields"].extend(
        [
            {
                "field": "building_categories",
                "value": '["education"]',
                "quote": "Civic School Design Competition",
            },
            {
                "field": "project_types",
                "value": '["invented_category"]',
                "quote": "Civic School Design Competition",
            },
        ]
    )
    fields = {"notice_text": "Civic School Design Competition", "notice_links": ""}
    record, warnings = extract_record(
        validate_evidence(ScreeningAnswer.model_validate(output), fields),
        fields,
        source=source,
        source_url=source.base_url,
        settings=settings,
    )
    assert record.building_categories == ["education"]
    assert record.project_types == []
    assert warnings


def test_bad_decision_quote_does_not_discard_valid_source_fields_or_hide_the_record(ai_workspace):
    settings, source = ai_workspace
    payload = decision_payload(evidence=["Invented evidence"])
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


def test_unchanged_notice_is_not_paid_again_on_a_later_day(ai_workspace):
    settings, source = ai_workspace
    sent = []

    def handler(request):
        sent.append(json.loads(json.loads(request.content)["input"]))
        return response(decision_payload())

    try:
        with mock_client(handler) as client:
            for day in (date(2026, 11, 2), date(2026, 11, 3)):
                clock.set_today_provider(lambda d=day: d)
                assessment = assess_document(
                    settings,
                    source=source,
                    source_url="https://city.example/n/1",
                    payload=NOTICE,
                    client=client,
                )
    finally:
        clock.set_today_provider(None)
    assert len(sent) == 1 and "date" not in sent[0]
    assert assessment.cached


def test_notice_text_is_kept_before_a_long_link_list(ai_workspace):
    settings, _source = ai_workspace
    links = "".join(f"<a href='https://x.example/{i}'>l</a>" for i in range(5000))
    _input, fields, _limits = prepare_input(
        {"source_url": "https://city.example/n/1"},
        settings,
        source_payload=f"<p>Civic School Design Competition</p>{links}",
    )
    assert fields["notice_text"].startswith("Civic School Design Competition")


def test_exclusion_keeps_its_decision_when_one_quote_is_unsupported(ai_workspace):
    settings, source = ai_workspace
    payload = decision_payload(
        decision="exclude",
        relevance_score=3,
        evidence=[
            "Open to registered architects.",
            "Paraphrased, not in the notice",
        ],
    )
    with mock_client(lambda _r: response(payload)) as client:
        assessment = assess_document(
            settings,
            source=source,
            source_url="https://city.example/n/1",
            payload=NOTICE,
            client=client,
        )
    assert assessment.decision.decision == "exclude"
    assert len(assessment.decision.evidence) == 1
    assert any(
        "Unsupported decision evidence" in m for m in assessment.decision.missing_information
    )


def test_exclusion_without_any_supported_quote_becomes_review_and_recommend_downgrades_on_one(
    ai_workspace,
):
    settings, source = ai_workspace
    unsupported = "Invented evidence"
    supported = "Open to registered architects."
    for decision, evidence, expected in [
        ("exclude", [unsupported], "needs_review"),
        ("recommend", [supported, unsupported], "needs_review"),
        ("recommend", [supported], "recommend"),
    ]:
        payload = decision_payload(decision=decision, evidence=evidence)
        with mock_client(lambda _r, p=payload: response(p)) as client:
            assessment = assess_document(
                settings,
                source=source,
                source_url="https://city.example/n/2",
                payload=NOTICE,
                client=client,
                force=True,
            )
        assert assessment.decision.decision == expected, (decision, evidence)


def test_truncated_input_retains_grounded_judgment_and_reports_limitation(ai_workspace):
    settings, source = ai_workspace
    with mock_client(lambda _r: response(decision_payload(decision="recommend"))) as client:
        assessment = assess_document(
            settings,
            source=source,
            source_url="https://city.example/n/1",
            payload=NOTICE + " Additional background." * settings.ai_max_input_chars,
            client=client,
        )
    assert assessment.decision.decision == "recommend"
    assert assessment.decision.evidence[0].quote == "Open to registered architects."
    assert "Input was truncated to the configured character limit" in (
        assessment.decision.missing_information
    )


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
    output = decision_payload(decision="recommend", evidence=["Civic School Design Competition"])
    output["extracted_fields"] = [
        output["extracted_fields"][0],
        {
            "field": field,
            "value": value,
            "quote": quote,
        },
    ]
    fields = {
        "notice_text": "Civic School Design Competition " + quote,
        "notice_links": "https://city.example/competition",
    }
    decision = validate_evidence(ScreeningAnswer.model_validate(output), fields)
    record, warnings = extract_record(
        decision,
        fields,
        source=source,
        source_url=source.base_url,
        settings=settings,
    )
    assert getattr(record, field) is None
    assert warnings
    assert decision.decision == "recommend"
    assert all(warning in decision.missing_information for warning in warnings)


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
        reserve_usd=4.6,
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
