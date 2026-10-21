"""AGENTS.md truth rules: with no evidence, a field stays empty (never a plausible default)."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path

import pytest
from support import build_source

from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.extractors.common import build_base_record
from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers.competition import (
    compute_extraction_confidence,
    compute_qualification_score,
    infer_licensed_architect_required,
    infer_local_partner_required,
)
from arch_competition_ops.review_queue import LOW_CONFIDENCE_THRESHOLD

SRC = Path(__file__).resolve().parents[1] / "src" / "arch_competition_ops"


def _source(tier: str = "primary", **overrides):
    values = {
        "name": "Example Platform",
        "jurisdiction": "italy",
        "base_url": "https://platform.example/",
        "scan_method": "api",
        "extractor": "generic_listing_html",
        "collector": "generic_rss_feed",
        "source_tier": tier,
    }
    values.update(overrides)
    return build_source("example_platform", **values)


def _bare_record(source=None, **overrides):
    values = {
        "title": "Servizi di progettazione",
        "authority_name": None,
        "opportunity_type": None,
        "procedure_type": None,
        "official_notice_id": None,
        "deadline_at": None,
        "estimated_contract_value_eur": None,
        "eligibility_summary": None,
        "cpv_codes": [],
        "evidence_note": None,
    }
    values.update(overrides)
    return build_base_record(source or _source(), "https://platform.example/n/1", **values)


def test_a_record_built_from_a_title_alone_contains_no_invented_facts() -> None:
    record = _bare_record()

    assert record.registration_fee_eur is None
    assert record.submission_fee_eur is None
    assert record.audience == []
    assert record.implementation_path is None
    assert record.official_url is None
    assert record.organizer == ""
    assert record.authority_name is None
    assert record.licensed_architect_required is None
    assert record.local_partner_required is None
    assert record.procedure_type is None
    assert record.deadline_at is None
    assert record.estimated_contract_value_eur is None
    # provenance is kept: the platform is recorded as such, not as the buyer
    assert (record.source_id, record.source_name) == ("example_platform", "Example Platform")
    assert record.source_url == "https://platform.example/n/1"


def test_the_platform_name_is_never_used_as_the_organizer() -> None:
    assert _bare_record().organizer != "Example Platform"
    assert _bare_record(authority_name="Comune di Parma").organizer == "Comune di Parma"


def test_official_url_is_only_written_when_the_notice_provides_one() -> None:
    assert _bare_record().official_url is None
    assert _bare_record(official_url="https://parma.example/gara").official_url == (
        "https://parma.example/gara"
    )


def test_source_url_counts_as_official_only_for_a_primary_source_that_asserts_it() -> None:
    primary = _source("primary")
    secondary = _source("secondary")
    notice_page = "https://platform.example/n/1"

    assert _bare_record(primary, source_url_is_notice_page=True).official_url == notice_page
    assert _bare_record(primary, source_url_is_notice_page=False).official_url is None
    assert _bare_record(secondary, source_url_is_notice_page=True).official_url is None


def test_licence_and_partner_requirements_need_an_explicit_clause() -> None:
    description = "Servizi di architettura e ingegneria per il nuovo polo civico"
    clause = "Il capogruppo deve essere architetto iscritto all'albo."

    from_description = _bare_record(description=description)
    from_clause = _bare_record(eligibility_summary=clause)

    assert from_description.licensed_architect_required is None
    assert from_description.eligibility_summary is None  # prose is never stored as eligibility
    assert from_clause.licensed_architect_required is True
    assert from_clause.eligibility_summary == clause
    # The title alone never counts either.
    assert _bare_record(title="Concorso per architetti").licensed_architect_required is None


def test_description_feeds_classification_but_is_not_persisted_or_dumped() -> None:
    record = _bare_record(description="Neubau Schule mit Sporthalle")

    assert record.building_categories == ["education", "sport_leisure"]
    assert "description" not in record.model_dump()


def test_inference_helpers_ignore_missing_and_generic_text() -> None:
    assert infer_licensed_architect_required(None) is None
    assert infer_licensed_architect_required("") is None
    assert infer_licensed_architect_required("Design services for a school") is None
    assert (
        infer_licensed_architect_required("Lead consultant must hold architect registration")
        is True
    )
    assert infer_licensed_architect_required("投标人须具有一级注册建筑师资格") is True
    assert infer_local_partner_required("Consortia are welcome") is None
    assert infer_local_partner_required("A joint venture is permitted") is None
    assert infer_local_partner_required("A local partner is required for permitting") is True


def test_confidence_is_computed_from_evidence_not_a_constant() -> None:
    thin = _bare_record()
    full = _bare_record(
        authority_name="Comune di Parma",
        official_notice_id="N-1",
        deadline_at=date(2026, 9, 1),
        procedure_type="open",
        cpv_codes=["71200000"],
        estimated_contract_value_eur=100000.0,
        official_url="https://parma.example/gara",
        location_label="Parma",
        brief_pdf_url="https://parma.example/brief.pdf",
    )

    assert thin.extraction_confidence == 0.2  # nothing but a title
    assert full.extraction_confidence == 1.0  # all nine evidence fields
    # formula: 0.2 + 0.8 * present / 9
    four = _bare_record(
        authority_name="A",
        official_notice_id="N",
        deadline_at=date(2026, 9, 1),
        procedure_type="open",
    )
    assert four.extraction_confidence == pytest.approx(0.2 + 0.8 * 4 / 9, abs=0.005)


def test_the_low_confidence_threshold_separates_thin_from_documented_records() -> None:
    thin = _bare_record(authority_name="A", official_notice_id="N", deadline_at=date(2026, 9, 1))
    documented = _bare_record(
        authority_name="A",
        official_notice_id="N",
        deadline_at=date(2026, 9, 1),
        procedure_type="open",
    )

    assert thin.extraction_confidence < LOW_CONFIDENCE_THRESHOLD <= documented.extraction_confidence


def test_a_typical_extracted_notice_is_not_low_confidence() -> None:
    source = _source(extractor="ted_notice_parser", collector="ted_search_api", jurisdiction="eu")
    payload = json.dumps(
        {
            "noticeId": "123-2026",
            "title": "France – Architectural services",
            "buyer": "Ville de Lyon",
            "procedureType": "open",
            "deadline": "2026-09-01",
            "cpv": ["71200000"],
        }
    )

    record = parse_source_payload(source, payload)

    assert record.extraction_confidence >= LOW_CONFIDENCE_THRESHOLD


def test_zero_fee_bonus_requires_an_explicit_zero_on_both_fees() -> None:
    base = _bare_record()
    score_unknown = compute_qualification_score(base)

    free = base.model_copy(update={"registration_fee_eur": 0.0, "submission_fee_eur": 0.0})
    half = base.model_copy(update={"registration_fee_eur": 0.0})
    paid = base.model_copy(update={"registration_fee_eur": 40.0, "submission_fee_eur": 0.0})

    assert compute_qualification_score(free) == pytest.approx(score_unknown + 0.1)
    assert compute_qualification_score(half) == score_unknown
    assert compute_qualification_score(paid) == score_unknown


def test_ted_payload_without_buyer_or_procedure_stays_empty() -> None:
    source = _source(extractor="ted_notice_parser", collector="ted_search_api", jurisdiction="eu")
    payload = json.dumps({"noticeId": "9-2026", "title": "Some TED notice"})

    record = parse_source_payload(source, payload)

    assert record.authority_name is None
    assert record.organizer == ""
    assert record.procedure_type is None  # no "open" default
    assert record.implementation_path is None


def test_ted_amount_is_euro_only_when_the_currency_says_so() -> None:
    source = _source(extractor="ted_notice_parser", collector="ted_search_api", jurisdiction="eu")

    eur = parse_source_payload(
        source,
        json.dumps(
            {"title": "t", "estimatedValueEur": "1500000", "estimatedValueText": "EUR 1,500,000"}
        ),
    )
    other = parse_source_payload(
        source,
        json.dumps({"title": "t", "estimatedValueText": "PLN 1,500,000"}),
    )

    assert eur.estimated_contract_value_eur == 1_500_000.0
    assert other.estimated_contract_value_eur is None
    assert other.estimated_contract_value_text == "PLN 1,500,000"


def test_generic_listing_without_eligibility_or_path_has_neither() -> None:
    record = parse_source_payload(
        _source(),
        json.dumps({"title": "Open call", "summary": "Architects wanted for a library"}),
    )

    assert record.licensed_architect_required is None
    assert record.implementation_path is None
    assert record.eligibility_summary is None  # a summary is not an eligibility clause
    assert record.description == "Architects wanted for a library"


def test_generic_listing_eligibility_field_is_a_clause() -> None:
    record = parse_source_payload(
        _source(),
        json.dumps({"title": "Open call", "eligibility": "Registered architects only."}),
    )

    assert record.licensed_architect_required is True


def test_no_extractor_or_collector_hardcodes_an_implementation_path_or_audience() -> None:
    offenders = []
    for path in SRC.rglob("*.py"):
        text = path.read_text(encoding="utf-8")
        if path.name == "competition.py" and path.parent.name == "normalizers":
            continue  # defines the allowed vocabulary
        for needle in (
            "service_contract_award_after_competitive_selection",
            "winner_or_winners_progress_to_negotiated_service_award",
            'audience=["professionals"',
            "Unknown authority",
        ):
            # The legacy-data migration must still recognise the retired placeholder to clear it.
            if needle == "Unknown authority" and path.parent.name == "storage":
                continue
            if needle in text:
                offenders.append(f"{path.relative_to(SRC)}: {needle}")

    assert offenders == []


def test_record_model_defaults_are_empty_not_plausible() -> None:
    record = CompetitionRecord(title="t", source_url="https://example.com")

    assert record.organizer == ""
    assert record.audience == []
    assert record.registration_fee_eur is None
    assert record.source_id is None


def test_confidence_helper_is_monotonic_in_evidence() -> None:
    record = CompetitionRecord(title="t", source_url="https://example.com")
    scores = [compute_extraction_confidence(record)]
    for update in (
        {"official_notice_id": "N"},
        {"deadline_at": date(2026, 9, 1)},
        {"authority_name": "A"},
        {"procedure_type": "open"},
    ):
        record = record.model_copy(update=update)
        scores.append(compute_extraction_confidence(record))

    assert scores == sorted(scores) and len(set(scores)) == len(scores)
