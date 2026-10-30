import json

from arch_competition_ops.collectors.ted import TED_FIELDS, _build_notice_payload


def test_ted_preview_preserves_status_description_and_deadline_before_translations():
    notice = {
        "publication-number": "123-2026",
        "notice-title": {"eng": "School architecture", "deu": "Schulbau" * 1000},
        "notice-type": "can-standard",
        "description-proc": {"deu": "Tragwerksplanung ohne Objektplanung"},
        "deadline-receipt-tender-date-lot": ["2026-11-30Z"],
        "deadline-receipt-request-date-lot": ["2026-11-01Z"],
        "place-of-performance": ["DEU"],
    }
    _, text = _build_notice_payload(notice)
    preview = text.encode("utf-8")[:1200].decode("utf-8", errors="ignore")
    assert '"noticeType": "can-standard"' in preview
    assert "Tragwerksplanung ohne Objektplanung" in preview
    assert "2026-11-30Z" in preview
    assert "2026-11-01Z" in preview
    payload = json.loads(text)
    assert payload["rawNotice"] == notice
    assert payload["placeOfPerformance"] == ["DEU"]
    assert {
        "notice-type",
        "description-proc",
        "place-of-performance",
        "deadline-receipt-tender-date-lot",
        "deadline-receipt-request-date-lot",
    } <= set(TED_FIELDS)
