import pytest

from arch_competition_ops.screening.models import ScreeningDecision, validate_evidence


def decision_for(field, quote):
    return ScreeningDecision(
        decision="exclude",
        relevance_score=5,
        summary_en="",
        summary_zh="",
        reasons_en=[],
        reasons_zh=[],
        missing_information=[],
        evidence=[{"field": field, "quote": quote}],
        extracted_fields=[
            {"field": "title", "value": quote, "quote": quote, "evidence_field": field}
        ],
        notice_details=[
            {"category": "scope", "text": quote, "quote": quote, "evidence_field": field}
        ],
    )


@pytest.mark.parametrize(
    ("cited", "quote", "expected"),
    [
        ("description", "supply of hospital beds", "notice_text"),
        ("lot_description", "supply of  hospital\nbeds", "notice_text"),
        ("notice_title", "Hospital", "notice_title"),
        ("notice_text", "Hospital", "notice_text"),
        ("title", "Hospital", "notice_title"),
        ("url", "https://city.example/notice", "notice_url"),
        ("official_url", "https://city.example/brief", "notice_links"),
        ("summary", "definitely not in the notice", None),
        ("rawNotice", "supply of hospital desks", None),
        ("title", "supply of hospital beds.", None),
        ("internal", "private material", None),
        ("notice_url", "supply of hospital beds", None),
    ],
)
def test_citation_attribution_for_all_three_outputs(cited, quote, expected):
    decision = decision_for(cited, quote)
    fields = {
        "notice_title": "Hospital",
        "notice_url": "https://city.example/notice",
        "notice_text": "Hospital tender for supply of hospital beds",
        "notice_links": "https://city.example/brief",
        "internal": "private material",
    }
    warnings = validate_evidence(decision, fields)
    if expected is None:
        assert warnings and decision.decision == "needs_review"
        assert (
            not decision.evidence and not decision.extracted_fields and not decision.notice_details
        )
        return
    assert not warnings and decision.decision == "exclude"
    evidence, fact, detail = (
        decision.evidence[0],
        decision.extracted_fields[0],
        decision.notice_details[0],
    )
    assert (evidence.field, fact.evidence_field, detail.evidence_field) == (expected,) * 3
    original = " ".join(quote.split())
    assert evidence.quote == fact.quote == detail.quote == detail.text == original
    assert original in fields[expected]
