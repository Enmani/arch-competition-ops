import json

import pytest
from pydantic import ValidationError
from test_ai_screening import ai_workspace, decision_payload  # noqa: F401

from arch_competition_ops.screening.extraction import extract_record
from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.models import ScreeningAnswer, validate_evidence


def answer(**kwargs):
    return decision_payload(extracted_fields=[], **kwargs)


def test_json_text_and_quote_have_identical_source_characters(ai_workspace):  # noqa: F811
    settings, _ = ai_workspace
    raw = r'{"title":"Concurso \"Red\/Sur\" \u2013 dise\u00f1o","lots":[{"value":123456789012345678901234567890},{"value":123456789.000000000000000001}]}'
    title = 'Concurso "Red/Sur" – diseño'
    expected = (
        "lots.value: 123456789012345678901234567890\n"
        "lots.value: 123456789.000000000000000001\n"
        f"title: {title}"
    )
    for payload in (json.dumps({"rawNotice": raw}), '{"rawNotice":' + raw + "}"):
        wire, fields, _ = prepare_input(
            {"source_url": "https://buyer.example/n"}, settings, source_payload=payload
        )
        assert fields["notice_text"] == expected
        content = json.loads(wire)["request"]["input"]
        assert content.endswith("notice_text:\n" + expected)
        assert title in content and raw not in content
        data = ScreeningAnswer.model_validate(answer(title_quote=title, evidence=[title]))
        result = validate_evidence(data, fields)
        assert result.extracted_fields[0].value == result.evidence[0].quote == title


def test_required_title_outside_optional_facts_and_collector_priority(ai_workspace):  # noqa: F811
    settings, source = ai_workspace
    url = "https://buyer.example/n"
    _, fields, _ = prepare_input(
        {"source_url": url},
        settings,
        source_payload=json.dumps(
            {
                "title": "Original listing title",
                "rawNotice": {"description": "Design for the library"},
            }
        ),
    )
    assert fields["notice_title"] == "Original listing title"
    missing = answer()
    missing.pop("title_quote", None)
    with pytest.raises(ValidationError, match="title_quote"):
        ScreeningAnswer.model_validate(missing)
    for quote in ("", "Design for the library"):
        decision = validate_evidence(
            ScreeningAnswer.model_validate(
                answer(title_quote=quote, evidence=["Design for the library"])
            ),
            fields,
        )
        record, warnings = extract_record(
            decision, fields, source=source, source_url=url, settings=settings
        )
        assert record.title == fields["notice_title"] and not warnings


def test_excluded_notice_without_a_title_or_facts_needs_no_record(ai_workspace):  # noqa: F811
    settings, source = ai_workspace
    fields = {"notice_text": "Supply only."}
    reply = ScreeningAnswer.model_validate(
        answer(decision="exclude", title_quote="", evidence=["Supply only."])
    )
    decision = validate_evidence(reply, fields)
    assert extract_record(
        decision, fields, source=source, source_url=source.base_url, settings=settings
    ) == (None, [])


def test_top_level_title_and_unstructured_html_preserve_source_text(ai_workspace):  # noqa: F811
    settings, _ = ai_workspace
    row = {"source_url": "https://buyer.example/n"}
    _, fields, _ = prepare_input(row, settings, source_payload='{"title":"Biblioteca pública"}')
    assert fields["notice_title"] == "Biblioteca pública"
    html = "<h1>Civic hall</h1><script>hidden</script><p>Entry conditions</p>"
    payload = json.dumps({"rawNoticeHtml": html}) + "\nSource notice detail:\n<p>No fee.</p>"
    _, fields, _ = prepare_input(row, settings, source_payload=payload)
    assert fields["notice_text"] == "Civic hall Entry conditions No fee."
