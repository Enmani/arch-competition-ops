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


def parse_boamp_notice(payload: str, source: SourceDefinition, source_url: str) -> CompetitionRecord:
    data = try_load_json(payload)

    if data:
        title = pick_first_value(data, ["title", "noticeTitle", "summary"])
        authority_name = pick_first_value(data, ["buyer", "authority"])
        official_notice_id = pick_first_value(data, ["officialNoticeId", "noticeId", "id"])
        deadline_raw = pick_first_value(data, ["deadline", "submissionDeadline"])
        value_raw = pick_first_value(data, ["estimatedValueEur", "estimatedValue"])
        eligibility_summary = pick_first_value(data, ["eligibility", "summary", "description"])
        cpv_codes = pick_list_value(data, ["cpv", "cpvCodes"])
        procedure_type = pick_first_value(data, ["procedureType", "noticeType"])
        location_label = pick_first_value(data, ["location", "place", "city", "municipality"])
    else:
        title = pick_regex(
            payload,
            [
                r"<h1[^>]*>\s*(?:Avis de concours\s*[-:]\s*)?([^<]+)</h1>",
                r"Titre[^:]*:\s*([^<\n]+)",
            ],
        )
        authority_name = pick_regex(
            payload,
            [
                r"P(?:ouvoir|ouvoir adjudicateur)\s+adjudicateur[^:]*:\s*([^<\n]+)",
                r"Acheteur[^:]*:\s*([^<\n]+)",
            ],
        )
        official_notice_id = pick_regex(
            payload,
            [r"Identifiant officiel[^:]*:\s*([^<\n]+)", r"Référence[^:]*:\s*([^<\n]+)"],
        )
        deadline_raw = pick_regex(
            payload,
            [r"Date limite[^:]*:\s*([^<\n]+)", r"Date de remise[^:]*:\s*([^<\n]+)"],
        )
        value_raw = pick_regex(
            payload,
            [r"Valeur estimée[^:]*:\s*([^<\n]+)", r"Montant estimé[^:]*:\s*([^<\n]+)"],
        )
        eligibility_summary = pick_regex(
            payload,
            [r"Exigences[^:]*:\s*([^<\n]+)", r"Conditions de participation[^:]*:\s*([^<\n]+)"],
        )
        cpv_raw = pick_regex(payload, [r"CPV(?: principal)?[^:]*:\s*([^<\n]+)"])
        cpv_codes = [code.strip() for code in (cpv_raw or "").split(",") if code.strip()]
        procedure_type = pick_regex(
            payload,
            [r"Type de procédure[^:]*:\s*([^<\n]+)", r"Procédure[^:]*:\s*([^<\n]+)"],
        )
        location_label = None

    if not title:
        raise ValueError("BOAMP parser could not determine a title from the payload")

    return build_base_record(
        source,
        source_url,
        title=title,
        authority_name=authority_name,
        opportunity_type="public_design_services_procurement",
        procedure_type=procedure_type or "maitrise_d_oeuvre_procurement",
        official_notice_id=official_notice_id,
        deadline_at=parse_iso_date(deadline_raw),
        estimated_contract_value_eur=parse_money_amount(value_raw),
        eligibility_summary=eligibility_summary,
        implementation_path="service_contract_award_after_competitive_selection",
        cpv_codes=cpv_codes,
        evidence_note="Parsed from BOAMP notice payload. Verify full procurement dossier before publishing.",
        estimated_contract_value_text=value_raw,
        location_label=location_label,
    )
