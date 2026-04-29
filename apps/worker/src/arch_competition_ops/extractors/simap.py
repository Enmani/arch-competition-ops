from __future__ import annotations

from arch_competition_ops.extractors.common import (
    build_base_record,
    parse_iso_date,
    parse_money_amount,
    pick_first_value,
    pick_list_value,
    pick_regex,
    try_load_json,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition


def parse_simap_notice(payload: str, source: SourceDefinition, source_url: str) -> CompetitionRecord:
    data = try_load_json(payload)
    official_url = None
    prize_summary = None
    documents_portal_url = None

    if data:
        title = pick_first_value(data, ["title", "noticeTitle", "summary"])
        authority_name = pick_first_value(data, ["buyer", "authority"])
        official_notice_id = pick_first_value(data, ["officialNoticeId", "noticeId", "id"])
        deadline_raw = pick_first_value(data, ["deadline", "submissionDeadline"])
        value_raw = pick_first_value(data, ["estimatedValueEur", "estimatedValue"])
        value_text = pick_first_value(data, ["estimatedValueText"])
        eligibility_summary = pick_first_value(data, ["eligibility", "summary", "description"])
        procedure_type = pick_first_value(data, ["procedureType", "processType"])
        cpv_codes = pick_list_value(data, ["cpv", "cpvCodes"])
        official_url = pick_first_value(data, ["officialUrl"])
        documents_portal_url = pick_first_value(data, ["documentsPortalUrl"])
        prize_summary = pick_first_value(data, ["prizeSummary", "compensationSummary"])
    else:
        title = pick_regex(payload, [r"<h1[^>]*>\s*([^<]+)</h1>", r"Titel[^:]*:\s*([^<\n]+)"])
        authority_name = pick_regex(
            payload,
            [r"Vergabestelle[^:]*:\s*([^<\n]+)", r"Autorité adjudicatrice[^:]*:\s*([^<\n]+)"],
        )
        official_notice_id = pick_regex(
            payload,
            [r"Meldungsnummer[^:]*:\s*([^<\n]+)", r"Num[eé]ro d'avis[^:]*:\s*([^<\n]+)"],
        )
        deadline_raw = pick_regex(
            payload,
            [r"Abgabetermin[^:]*:\s*([^<\n]+)", r"Délai de remise[^:]*:\s*([^<\n]+)"],
        )
        value_raw = pick_regex(
            payload,
            [r"Gesch[aä]tzter Auftragswert[^:]*:\s*([^<\n]+)", r"Valeur estimée[^:]*:\s*([^<\n]+)"],
        )
        value_text = None
        eligibility_summary = pick_regex(
            payload,
            [r"Teilnahmebedingungen[^:]*:\s*([^<\n]+)", r"Conditions de participation[^:]*:\s*([^<\n]+)"],
        )
        procedure_type = pick_regex(
            payload,
            [r"Verfahrensart[^:]*:\s*([^<\n]+)", r"Procédure[^:]*:\s*([^<\n]+)"],
        )
        cpv_raw = pick_regex(payload, [r"CPV[^:]*:\s*([^<\n]+)"])
        cpv_codes = [code.strip() for code in (cpv_raw or "").split(",") if code.strip()]

    if not title:
        raise ValueError("simap parser could not determine a title from the payload")

    evidence_note = "Parsed from simap notice payload. Non-EUR value may need manual currency normalization."
    if value_raw and "CHF" in value_raw.upper():
        estimated_value = None
    else:
        estimated_value = parse_money_amount(value_raw)

    record = build_base_record(
        source,
        source_url,
        title=title,
        authority_name=authority_name,
        opportunity_type="public_design_contest",
        procedure_type=procedure_type or "planning_competition",
        official_notice_id=official_notice_id,
        deadline_at=parse_iso_date(deadline_raw),
        estimated_contract_value_eur=estimated_value,
        eligibility_summary=eligibility_summary,
        implementation_path="service_contract_award_after_competitive_selection",
        cpv_codes=cpv_codes,
        evidence_note=evidence_note,
        official_url=official_url,
        documents_portal_url=documents_portal_url,
        estimated_contract_value_text=value_text or value_raw,
    )
    record.prize_summary = prize_summary
    return record
