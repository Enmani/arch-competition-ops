from __future__ import annotations

from arch_competition_ops.extractors.common import (
    build_base_record,
    parse_iso_date,
    parse_money_amount,
    pick_first_value,
    pick_list_value,
    try_load_json,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition


def parse_generic_listing_notice(
    payload: str,
    source: SourceDefinition,
    source_url: str,
) -> CompetitionRecord:
    data = try_load_json(payload)
    if not data:
        raise ValueError("Generic listing parser expects JSON collector payloads")

    title = pick_first_value(data, ["title", "headline"])
    if not title:
        raise ValueError("Generic listing parser could not determine a title from the payload")

    value_raw = pick_first_value(data, ["estimatedValueEur", "estimatedValue"])
    record = build_base_record(
        source,
        source_url,
        title=title,
        authority_name=pick_first_value(data, ["buyer", "authority", "organizer"]),
        opportunity_type=pick_first_value(data, ["opportunityType"]),
        procedure_type=pick_first_value(data, ["procedureType"]),
        official_notice_id=pick_first_value(data, ["officialNoticeId", "noticeId", "id"]),
        deadline_at=parse_iso_date(pick_first_value(data, ["deadline", "deadlineAt"])),
        estimated_contract_value_eur=parse_money_amount(value_raw),
        eligibility_summary=pick_first_value(data, ["summary", "description"]),
        implementation_path=pick_first_value(data, ["implementationPath"]),
        cpv_codes=pick_list_value(data, ["cpv", "cpvCodes"]),
        evidence_note=pick_first_value(data, ["evidenceNote"]) or (
            "Secondary discovery listing. Verify against the linked official notice before taking action."
        ),
        evidence_level=pick_first_value(data, ["evidenceLevel"]),
        official_url=pick_first_value(data, ["officialUrl"]),
        brief_pdf_url=pick_first_value(data, ["briefPdfUrl"]),
        estimated_contract_value_text=pick_first_value(
            data,
            ["estimatedValueText", "estimatedValueDisplay"],
        )
        or value_raw,
        location_label=pick_first_value(data, ["location", "place", "city", "municipality"]),
    )
    record.prize_summary = pick_first_value(data, ["prizeSummary", "compensationSummary"])
    return record
