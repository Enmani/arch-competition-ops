import json
from datetime import date
from pathlib import Path
from typing import get_args

import pytest
from test_ai_screening import ai_workspace  # noqa: F401

from arch_competition_ops.config_loader import load_taxonomy
from arch_competition_ops.screening.extraction import extract_record
from arch_competition_ops.screening.fingerprints import notice_content_hash, screening_criteria_hash
from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.models import FactName, ScreeningAnswer, validate_evidence


@pytest.fixture
def replay():
    return json.loads(
        (Path(__file__).parent / "fixtures/library-renovation-answer.json").read_text(
            encoding="utf8"
        )
    )


def test_saved_answer_accepts_claims_without_row_title(ai_workspace, replay):  # noqa: F811
    settings, source = ai_workspace
    row = {"source_url": replay["source_url"]}
    _, fields, _ = prepare_input(row, settings, source_payload=replay["notice"])
    decision = validate_evidence(ScreeningAnswer.model_validate(replay["answer"]), fields)
    record, rejected = extract_record(
        decision, fields, source=source, source_url=row["source_url"], settings=settings
    )
    assert len(decision.extracted_fields) == len(replay["answer"]["extracted_fields"]) == 19
    assert not rejected
    assert record.title == replay["notice"].splitlines()[0]
    assert record.deadline_at == date(2026, 12, 15)
    assert record.estimated_contract_value_eur == 125000
    assert record.official_url == row["source_url"]
    assert record.procedure_type == "open" and record.languages == ["fr"]
    assert record.design_scopes == ["architectural_design"] and record.jurisdiction == "france"
    assert record.audience == ["professionals"] and record.project_modes == ["renovation"]
    assert record.licensed_architect_required and record.eligibility_summary


@pytest.mark.parametrize(
    ("value", "day"),
    [
        ("2026-11-09 09:30", date(2026, 11, 9)),
        ("2026-11-09T23:30:00-05:00", date(2026, 11, 9)),
        ("2026-11-10T09:30:00+01:00", None),
    ],
)
def test_timestamp_requires_the_quoted_local_date(ai_workspace, replay, value, day):  # noqa: F811
    settings, source = ai_workspace
    quote = "Submission closes on 9 November 2026 at 09:30."
    answer = replay["answer"]
    answer["extracted_fields"] = [
        answer["extracted_fields"][0],
        {"field": "deadline_at", "value": value, "quote": quote},
    ]
    fields = {"notice_text": replay["notice"] + quote}
    decision = validate_evidence(ScreeningAnswer.model_validate(answer), fields)
    record, rejected = extract_record(
        decision, fields, source=source, source_url=replay["source_url"], settings=settings
    )
    assert record.deadline_at == day
    assert bool(rejected) == (day is None)


def test_collector_title_available_even_if_absent_from_raw_body(ai_workspace, replay):  # noqa: F811
    settings, source = ai_workspace
    raw = {"title": "Original listing title", "rawNotice": {"description": "Design commission."}}
    row = {"source_url": replay["source_url"]}
    _, fields, _ = prepare_input(row, settings, source_payload=json.dumps(raw))
    assert fields["notice_title"] == raw["title"]
    raw["rawNotice"]["description"] = "Original listing title. Amended listing title."
    assert notice_content_hash(json.dumps(raw), row["source_url"]) != notice_content_hash(
        json.dumps({**raw, "title": "Amended listing title"}), row["source_url"]
    )
    answer = ScreeningAnswer.model_validate({**replay["answer"], "extracted_fields": []})
    record, _ = extract_record(
        validate_evidence(answer, fields),
        fields,
        source=source,
        source_url=row["source_url"],
        settings=settings,
    )
    assert record.title == raw["title"] and raw["title"] in record.evidence_note


def test_all_fact_names_share_the_validator_and_wire_contract(ai_workspace, replay):  # noqa: F811
    from arch_competition_ops.screening.field_contract import FIELDS, KIND_FORMAT, render_contract

    settings, _ = ai_workspace
    taxonomy = load_taxonomy(settings)
    assert set(get_args(FactName)) == set(FIELDS)
    assert {spec.kind for spec in FIELDS.values()} == set(KIND_FORMAT)
    # The accepted replay above exercises the real validation path for every declared kind.
    assert {FIELDS[claim["field"]].kind for claim in replay["answer"]["extracted_fields"]} == set(
        KIND_FORMAT
    )
    contract = render_contract(taxonomy)
    snapshot, fields, _ = prepare_input(
        {"source_url": "https://city.example/n"}, settings, source_payload="Notice"
    )
    request = json.loads(snapshot)["request"]
    assert contract in request["instructions"]
    assert (
        contract
        in request["text"]["format"]["schema"]["properties"]["extracted_fields"]["description"]
    )
    assert "source_tiers" not in contract and "official_procurement" not in contract
    assert contract not in fields["notice_text"]
    for name, spec in FIELDS.items():
        assert name in contract and spec.description in contract
        assert bool(spec.taxonomy) == (spec.kind in {"label", "label-list"})
        if spec.taxonomy:
            assert getattr(taxonomy, spec.taxonomy)
            assert all(label in contract for label in getattr(taxonomy, spec.taxonomy))

    before = screening_criteria_hash(settings)
    path = settings.resolve_path(settings.taxonomy_config)
    path.write_text(
        path.read_text(encoding="utf8").replace(
            "  - public_design_contest", "  - changed_test_label"
        ),
        encoding="utf8",
    )
    assert screening_criteria_hash(settings) != before


def test_decimal_amount_is_read_in_contract_format(ai_workspace, replay):  # noqa: F811
    settings, source = ai_workspace
    answer = replay["answer"]
    money = next(
        f for f in answer["extracted_fields"] if f["field"] == "estimated_contract_value_eur"
    )
    money["value"] = "125000.000"
    fields = {"notice_text": replay["notice"], "notice_links": replay["source_url"]}
    decision = validate_evidence(ScreeningAnswer.model_validate(answer), fields)
    record, rejected = extract_record(
        decision, fields, source=source, source_url=replay["source_url"], settings=settings
    )
    assert record.estimated_contract_value_eur == 125000 and not rejected


@pytest.mark.parametrize(
    ("value", "expected"),
    [('[" ARCHITECTURAL   DESIGN "]', ["architectural_design"]), ('["architecture-ish"]', [])],
)
def test_closed_labels_normalize_only_case_and_spacing(ai_workspace, replay, value, expected):  # noqa: F811
    settings, source = ai_workspace
    claim = next(f for f in replay["answer"]["extracted_fields"] if f["field"] == "design_scopes")
    claim["value"] = value
    fields = {"notice_text": replay["notice"], "notice_links": replay["source_url"]}
    decision = validate_evidence(ScreeningAnswer.model_validate(replay["answer"]), fields)
    record, rejected = extract_record(
        decision, fields, source=source, source_url=replay["source_url"], settings=settings
    )
    assert record.design_scopes == expected
    assert bool(rejected) == (not expected)
