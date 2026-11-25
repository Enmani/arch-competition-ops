"""Tests for screening pipeline improvements: score scale, quotes, caching, lifecycle, scheduling."""

from __future__ import annotations

import json
from datetime import date, timedelta

import pytest
import yaml
from test_ai_screening import (  # noqa: F401
    NOTICE,
    ai_workspace,
    decision_payload,
    mock_client,
    response,
)

from arch_competition_ops import clock
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.ingest import ingest_source
from arch_competition_ops.screening import service
from arch_competition_ops.screening.catalog import get_model
from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.lifecycle import closed_lifecycle_reason
from arch_competition_ops.screening.models import (
    ScreeningAnswer,
    source_quote,
    validate_evidence,
)
from arch_competition_ops.screening.source_evidence import notice_text
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import backlog
from arch_competition_ops.storage.connection import connect


def test_anthropic_wire_schema_keeps_score_scale_description_and_cache_control(tmp_path):
    from support import REPO_ROOT

    skill = tmp_path / "skill.md"
    skill.write_text("Screen notices.", encoding="utf-8")
    settings = Settings(
        root=tmp_path,
        ai_preferences=skill,
        taxonomy_config=REPO_ROOT / "config/taxonomy.yml",
        ai_provider="anthropic",
        ai_model="claude-haiku-5-5",
        _env_file=None,
    )
    snapshot, _, _ = prepare_input(
        {"source_url": "https://city.example/n/1"},
        settings,
        source_payload="Design competition for a public library.",
    )
    req = json.loads(snapshot)["request"]
    score_schema = req["output_config"]["format"]["schema"]["properties"]["relevance_score"]
    assert "minimum" not in score_schema and "maximum" not in score_schema
    assert "0 to 100" in score_schema["description"]
    assert isinstance(req["system"], list) and len(req["system"]) == 1
    assert req["system"][0]["cache_control"] == {"type": "ephemeral"}
    assert "For exclude notices" in req["system"][0]["text"]


def test_reversible_source_quote_matches_entities_typography_and_cjk_without_fuzzy_false_positives():
    # HTML entities + dashes + curly quotes return exact original source characters
    raw_en = "Design &amp; build \u2014 \u201cCivic\u00a0School\u201d"
    assert source_quote('Design & build - "Civic School"', raw_en) == raw_en

    # CJK fullwidth punctuation + stray whitespace return exact original source span
    raw_zh = "项目名称： 新建 图书馆（一期），建筑面积 5000 平方米"
    assert source_quote("项目名称:新建图书馆(一期),建筑面积 5000 平方米", raw_zh) == raw_zh

    # Strictly rejects changed numbers, negation, extra letters or trailing punctuation
    assert source_quote("建筑面积 6000 平方米", raw_zh) is None
    assert source_quote("Design briefs", "Design brief") is None
    assert source_quote("Design brief.", "Design brief") is None
    assert source_quote("可参加", "联合体不可参加") == "可参加"
    assert source_quote("不可参加", "联合体可参加") is None


def test_validate_evidence_records_diagnostics_without_changing_public_json():
    fields = {
        "notice_title": "某医院工程澄清公告",
        "notice_text": "本次澄清仅修改投标截止时间，未提及原设计范围。",
    }
    answer = ScreeningAnswer(
        decision="needs_review",
        relevance_score=40,
        summary_zh="澄清公告缺范围。",
        summary_en="Clarification notice missing scope.",
        reasons_zh=["仅澄清时间"],
        reasons_en=["Only clarifies timeline"],
        missing_information=["原招标范围不明确"],
        evidence=["本次澄清仅修改投标截止时间", "fabricated quote"],
        title_quote="",
        extracted_fields=[],
        notice_details=[],
    )
    diag: dict[str, object] = {}
    decision = validate_evidence(
        answer,
        fields,
        diagnostics=diag,
        limitations=["Detail unavailable (HTTP 403); only listing evidence was read"],
    )
    assert decision.decision == "needs_review"
    assert diag["model_decision"] == "needs_review"
    assert diag["unmatched_quotes"] == ["fabricated quote"]
    assert "missing_notice_text" in diag["review_reasons"]
    assert "unlinked_clarification" in diag["review_reasons"]


def test_notice_text_deduplicates_identical_long_descriptions_losslessly():
    long_desc = (
        "Architectural design services for a municipal cultural center and public plaza. " * 3
    )
    payload = json.dumps(
        {
            "title": "Cultural Center",
            "rawNotice": {
                "listing": {"description": long_desc, "buyer": "City Council"},
                "detail": {"description": long_desc, "buyer": "City Council", "extra": "Phase 1-4"},
            },
        }
    )
    rendered = notice_text(payload, collected=True)
    assert rendered.count(long_desc.strip()) == 1
    assert "Phase 1-4" in rendered


def test_anthropic_cache_write_5m_and_1h_pricing():
    model = get_model("claude-haiku-5-5")
    # 1000 regular @ 0.10 + 2000 cache_read @ 0.01 + 1000 write_5m @ 0.125 + 500 write_1h @ 0.20 + 500 out @ 0.50
    expected = (1000 * 0.10 + 2000 * 0.01 + 1000 * 0.125 + 500 * 0.20 + 500 * 0.50) / 1_000_000
    assert model.cost(4500, 500, 2000, 1000, 500) == pytest.approx(expected)


@pytest.mark.parametrize(
    ("payload", "expected_prefix"),
    [
        ({"noticeType": "can-standard", "rawNotice": {"notice-type": "can-standard"}}, "ted:can-"),
        ({"noticeType": "can-desg", "rawNotice": {"notice-type": "can-desg"}}, "ted:can-desg"),
        ({"noticeType": "veat", "rawNotice": {"notice-type": "veat"}}, "ted:veat"),
        ({"rawNotice": {"ocid": "ocds-1", "tag": ["award"]}}, "ocds:tag:award"),
        (
            {"rawNotice": {"ocds": {"ocid": "ocds-2", "tag": ["tenderCancellation"]}}},
            "ocds:tag:tenderCancellation",
        ),
        (
            {"rawNotice": {"ocid": "ocds-3", "tag": ["tender"], "tender": {"status": "cancelled"}}},
            "ocds:tender_status:cancelled",
        ),
        ({"rawNotice": {"idAvviso": "1", "codiceScheda": "AD3"}}, "anac:ad3"),
        ({"rawNotice": {"idAvviso": "2", "codiceScheda": "A1_29"}}, "anac:a1_29"),
        ({"rawNotice": {"idAvviso": "3", "tipo": "esito"}}, "anac:esito"),
        (
            {
                "rawNotice": (
                    "<entry><cbc-place-ext:ContractFolderStatusCode>RES"
                    "</cbc-place-ext:ContractFolderStatusCode></entry>"
                )
            },
            "pcsp:res",
        ),
        (
            {"rawNotice": {"listing": {"type": "ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT"}}},
            "doffin:announcement_of_conclusion_of_contract",
        ),
        (
            {"rawNotice": {"listing": {"heading": "X", "status": "CANCELLED"}}},
            "doffin:status:cancelled",
        ),
        ({"rawNotice": {"listing": {"pubType": "award"}}}, "simap:award"),
        ({"rawNotice": {"listing": {"pubType": "direct_award"}}}, "simap:direct_award"),
        ({"rawNotice": {"listing": {"typePublicatie": {"code": "AGO"}}}}, "tenderned:ago"),
        (
            {
                "rawNotice": {
                    "listing": {
                        "typePublicatie": {"code": "REC"},
                        "publicatiecode": {"code": "EF29"},
                    }
                }
            },
            "tenderned:ef29",
        ),
        (
            {"noticeType": "Contract Award", "rawNotice": {"notice_type": "Contract Award"}},
            "world_bank:",
        ),
        ({"rawNotice": {"idweb": "26-1", "nature": "ATTRIBUTION"}}, "boamp:attribution"),
    ],
)
def test_closed_lifecycle_codes_are_detected(payload, expected_prefix):
    hit = closed_lifecycle_reason(json.dumps(payload))
    assert hit is not None and hit[0].startswith(expected_prefix)


@pytest.mark.parametrize(
    "payload",
    [
        {"noticeType": "cn-standard", "rawNotice": {"notice-type": "cn-standard"}},
        {"noticeType": "cn-desg", "rawNotice": {"notice-type": "cn-desg"}},
        {"noticeType": "pin-only", "rawNotice": {"notice-type": "pin-only"}},
        {"rawNotice": {"ocid": "ocds-1", "tag": ["tender"], "tender": {"status": "active"}}},
        {
            "rawNotice": {
                "ocid": "ocds-2",
                "tag": ["tender", "award"],
                "tender": {"status": "active"},
            }
        },
        {"rawNotice": {"idAvviso": "1", "codiceScheda": "P1_16", "tipo": "avviso"}},
        {
            "rawNotice": (
                "<entry><cbc-place-ext:ContractFolderStatusCode>PUB"
                "</cbc-place-ext:ContractFolderStatusCode></entry>"
            )
        },
        {
            "rawNotice": (
                "<entry><cbc-place-ext:ContractFolderStatusCode>EV"
                "</cbc-place-ext:ContractFolderStatusCode></entry>"
            )
        },
        {"rawNotice": {"listing": {"type": "PRE_ANNOUNCEMENT", "status": None}}},
        {"rawNotice": {"listing": {"pubType": "competition"}}},
        {"rawNotice": {"listing": {"typePublicatie": {"code": "AAO"}}}},
        {"rawNotice": {"listing": {}}},
        {"noticeType": "Request for Expression of Interest"},
        {"rawNotice": {"idweb": "26-2", "nature": "APPEL_OFFRE"}},
    ],
)
def test_open_or_unknown_lifecycle_notices_stay_open(payload):
    assert closed_lifecycle_reason(json.dumps(payload)) is None


def test_closed_lifecycle_retires_without_paid_call_and_updates_published_record(
    ai_workspace,  # noqa: F811
    monkeypatch,
):
    settings, source = ai_workspace
    settings.ai_enabled = True
    (settings.root / "config" / "sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}), encoding="utf-8"
    )
    open_notice = json.dumps(
        {
            "officialNoticeId": "OCID-100",
            "title": "Civic School Design Competition",
            "rawNotice": {
                "ocid": "OCID-100",
                "tag": ["tender"],
                "tender": {"status": "active", "description": "Open to registered architects."},
            },
        }
    )
    award_notice = json.dumps(
        {
            "officialNoticeId": "OCID-100",
            "title": "Civic School Design Competition",
            "rawNotice": {
                "ocid": "OCID-100",
                "tag": ["award"],
                "tender": {"status": "complete"},
            },
        }
    )
    listing = [CollectedSourceDocument("https://city.example/n/open", open_notice)]
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents", lambda *a, **kw: list(listing)
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **kw: r)
    calls = []

    def handler(req):
        calls.append(req)
        return response(
            decision_payload(
                decision="recommend",
                evidence=["Open to registered architects."],
                title_quote="",
                extracted_fields=[],
            )
        )

    monkeypatch.setattr(service, "create_client", lambda _: mock_client(handler))
    first = ingest_source(settings, source_id=source.source_id)
    assert len(first.ingested_ids) == 1 and len(calls) == 1

    # Now an official award release arrives for the same notice: zero paid calls, record excluded!
    listing[:] = [CollectedSourceDocument("https://city.example/n/award", award_notice)]
    second = ingest_source(settings, source_id=source.source_id)
    assert len(calls) == 1
    assert any("retired_closed=1" in note for note in second.notes)
    with connect(settings.resolve_path(settings.db)) as cx:
        advice = cx.execute(
            "SELECT model, decision, relevance_score FROM ai_screening_results"
        ).fetchone()
        item_status = cx.execute(
            "SELECT status FROM items WHERE source_url='https://city.example/n/award'"
        ).fetchone()[0]
    assert tuple(advice) == ("structured_lifecycle", "exclude", 0)
    assert item_status == "closed_lifecycle"


def test_deadline_aware_queue_and_shared_remainder_allocation(tmp_path):
    today = date(2026, 6, 1)
    clock.set_today_provider(lambda: today)
    db = initialize_database(Settings(root=tmp_path, _env_file=None))

    # Source A: 6 notices (3 urgent, 2 far future, 3 undated)
    docs_a = [
        CollectedSourceDocument(
            f"https://a.example/undated-{i}",
            json.dumps({"title": f"Undated {i}", "summary": "Text"}),
        )
        for i in range(3)
    ] + [
        CollectedSourceDocument(
            "https://a.example/far",
            json.dumps({"title": "Far", "deadline": (today + timedelta(days=40)).isoformat()}),
        ),
        CollectedSourceDocument(
            "https://a.example/urgent-2",
            json.dumps({"title": "Urgent 2", "deadline": (today + timedelta(days=5)).isoformat()}),
        ),
        CollectedSourceDocument(
            "https://a.example/urgent-1",
            json.dumps({"title": "Urgent 1", "deadline": (today + timedelta(days=2)).isoformat()}),
        ),
    ]
    # Source B: only 1 notice
    docs_b = [CollectedSourceDocument("https://b.example/only", json.dumps({"title": "Only B"}))]
    backlog.enqueue(db, "src_a", docs_a, "v1", unfinished=0, cap=20)
    backlog.enqueue(db, "src_b", docs_b, "v1", unfinished=0, cap=20)

    # Single-source limit=5: urgent deadlines first (urgent-1, urgent-2), far next, plus 20% (1) undated reserved
    picked_a = [item.document.source_url for item in backlog.queued(db, "src_a", 5)]
    assert picked_a[:2] == ["https://a.example/urgent-1", "https://a.example/urgent-2"]
    assert "https://a.example/undated-0" in picked_a

    # Batch floor=3 across 2 sources (total 6 slots): src_b uses 1, src_a gets floor 3 + 2 shared remainder = 5
    allocations = dict(backlog.select_batch_queue(db, ["src_a", "src_b"], per_source_floor=3))
    assert len(allocations["src_b"]) == 1
    assert len(allocations["src_a"]) == 5


def test_ingest_records_stage_timings_and_screening_meta(ai_workspace, monkeypatch):  # noqa: F811
    settings, source = ai_workspace
    settings.ai_enabled = True
    (settings.root / "config" / "sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}), encoding="utf-8"
    )
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda *a, **kw: [CollectedSourceDocument("https://city.example/n/1", NOTICE)],
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **kw: r)
    monkeypatch.setattr(
        service, "create_client", lambda _: mock_client(lambda _: response(decision_payload()))
    )
    res = ingest_source(settings, source_id=source.source_id)
    assert any(note.startswith("stage_timings ") for note in res.notes)
    assert any(
        "cache_read=" in note and "review_reasons=model_uncertain=1" in note for note in res.notes
    )
    with connect(settings.resolve_path(settings.db)) as cx:
        meta = json.loads(cx.execute("SELECT screening_meta FROM items").fetchone()[0])
    assert meta["model_decision"] == "needs_review"
    assert meta["review_reasons"] == ["model_uncertain"]
    assert meta["tokens"]["input"] == 2000 and meta["tokens"]["output"] == 1000
