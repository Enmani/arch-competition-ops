import json

import pytest

from arch_competition_ops.screening.models import (
    ScreeningAnswer,
    ScreeningDecision,
    validate_evidence,
)


@pytest.mark.parametrize(
    ("quote", "expected"),
    [
        ("Civic school", "notice_title"),
        ("Design  brief", "notice_text"),
        ("https://city.example/1", "notice_url"),
        ("https://city.example/2", "notice_links"),
        ("private material", None),
        ("Design briefs", None),
        ("Design brief.", None),
    ],
)
def test_program_assigns_each_quote_in_fixed_source_order(quote, expected):
    fields = {
        "notice_links": "Civic school Design brief https://city.example/1 https://city.example/2",
        "notice_url": "https://city.example/1",
        "notice_text": "Civic school Design brief",
        "notice_title": "Civic school",
        "internal": "private material",
    }
    answer = ScreeningAnswer(
        decision="exclude",
        relevance_score=2,
        summary_en="",
        summary_zh="",
        reasons_en=[],
        reasons_zh=[],
        missing_information=[],
        evidence=[quote],
        extracted_fields=[{"field": "title", "value": quote, "quote": quote}],
        notice_details=[{"category": "scope", "quote": quote}],
    )
    stored = validate_evidence(answer, fields)
    if expected is None:
        assert stored.decision == "needs_review" and stored.missing_information
        assert not stored.evidence and not stored.extracted_fields and not stored.notice_details
        return
    assert stored.decision == "exclude" and not stored.missing_information
    ev, fact, detail = stored.evidence[0], stored.extracted_fields[0], stored.notice_details[0]
    assert (ev.field, fact.evidence_field, detail.evidence_field) == (expected,) * 3
    assert ev.quote == fact.quote == detail.text == detail.quote == " ".join(quote.split())


def test_round_trip_preserves_existing_public_json_bytes():
    # The D1 export compares the serialized result. A schema upgrade alone must not rewrite it.
    published = {
        "decision": "recommend",
        "relevance_score": 85,
        "summary_zh": "",
        "summary_en": "",
        "reasons_zh": [],
        "reasons_en": [],
        "missing_information": [],
        "evidence": [{"field": "notice_text", "quote": "Library design"}],
        "extracted_fields": [
            {
                "field": "title",
                "value": "Library design",
                "evidence_field": "notice_text",
                "quote": "Library design",
            }
        ],
        "notice_details": [
            {
                "category": "scope",
                "text": "Library design",
                "evidence_field": "notice_text",
                "quote": "Library design",
            }
        ],
    }
    old_json = json.dumps(published, separators=(",", ":"))
    assert ScreeningDecision.model_validate_json(old_json).model_dump_json() == old_json
