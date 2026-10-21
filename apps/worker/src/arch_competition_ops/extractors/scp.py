from __future__ import annotations

from arch_competition_ops.extractors.common import (
    build_base_record,
    is_distinct_notice_url,
    parse_money_amount,
    parse_source_date,
    pick_first_value,
    pick_list_value,
    try_load_json,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition


def parse_procurement_hub_notice(
    payload: str,
    source: SourceDefinition,
    source_url: str,
) -> CompetitionRecord:
    data = try_load_json(payload)
    if not data:
        raise ValueError("SCP parser expects JSON collector payloads")

    title = pick_first_value(data, ["title", "description", "summary"])
    if not title:
        raise ValueError("SCP parser could not determine a title from the payload")
    value_raw = pick_first_value(
        data, ["estimatedValueEur", "estimatedValue", "estimatedValueText"]
    )

    return build_base_record(
        source,
        source_url,
        title=title,
        authority_name=pick_first_value(data, ["buyer", "authority"]),
        opportunity_type="public_design_services_procurement",
        procedure_type=pick_first_value(data, ["procedureType", "noticeType"]),
        official_notice_id=pick_first_value(data, ["officialNoticeId", "noticeId", "id"]),
        deadline_at=parse_source_date(pick_first_value(data, ["deadline", "scadenza"]), source),
        estimated_contract_value_eur=parse_money_amount(value_raw),
        description=pick_first_value(data, ["summary", "description"]),
        cpv_codes=pick_list_value(data, ["cpv", "cpvCodes"]),
        evidence_note=(
            "Parsed from the official Servizio Contratti Pubblici open-data feed. "
            "Confirm the notice page before acting."
        ),
        official_url=pick_first_value(data, ["officialUrl"]),
        # url_avviso on the national SCP platform is the notice page; the landing page is not.
        source_url_is_notice_page=is_distinct_notice_url(source, source_url),
        estimated_contract_value_text=pick_first_value(data, ["estimatedValueText"]) or value_raw,
        location_label=pick_first_value(data, ["location", "place", "city", "municipality"]),
    )
