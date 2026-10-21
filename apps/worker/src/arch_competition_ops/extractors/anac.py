from __future__ import annotations

from collections.abc import Mapping

from arch_competition_ops.extractors.common import (
    build_base_record,
    parse_money_amount,
    parse_source_date,
    pick_first_value,
    pick_list_value,
    try_load_json,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition

_ARCHIVED_SOURCE_KINDS = {"aggiudicazione", "esito", "archived", "completed"}


def resolve_anac_record_status(data: Mapping[str, object]) -> str:
    """Single ANAC status rule, shared by extraction and the stored-record normalizer.

    ``archived`` means the notice is an award/result (esito) rather than an open call. The inputs
    are the collector payload keys; ``postprocess.anac`` maps the live ANAC API detail onto the
    same keys so both paths agree.
    """

    def text(*keys: str) -> str:
        for key in keys:
            value = str(data.get(key) or "").strip().lower()
            if value:
                return value
        return ""

    procedure_type = text("procedureType", "codiceScheda")
    prose = f"{text('title')} {text('summary', 'description')}"

    if procedure_type.startswith("ad"):
        return "archived"
    if text("tipo") == "esito":
        return "archived"
    if text("sourceKind", "noticeKind") in _ARCHIVED_SOURCE_KINDS:
        return "archived"
    if "/esiti/" in text("sourcePublicUrl"):
        return "archived"
    if "aggiudicazione" in prose or "affidamento diretto" in prose:
        return "archived"
    return "discovered"


def parse_bdncp_notice(
    payload: str, source: SourceDefinition, source_url: str
) -> CompetitionRecord:
    data = try_load_json(payload)
    if not data:
        raise ValueError("ANAC BDNCP parser expects JSON collector payloads")

    title = pick_first_value(data, ["title", "description", "summary"])
    if not title:
        raise ValueError("ANAC BDNCP parser could not determine a title from the payload")
    value_raw = pick_first_value(
        data, ["estimatedValueEur", "estimatedValue", "estimatedValueText"]
    )

    return build_base_record(
        source,
        source_url,
        title=title,
        authority_name=pick_first_value(data, ["buyer", "authority"]),
        opportunity_type="public_design_services_procurement",
        procedure_type=pick_first_value(data, ["procedureType", "codiceScheda"]),
        official_notice_id=pick_first_value(data, ["officialNoticeId", "noticeId", "id"]),
        deadline_at=parse_source_date(pick_first_value(data, ["deadline", "scadenza"]), source),
        estimated_contract_value_eur=parse_money_amount(value_raw),
        description=pick_first_value(data, ["summary", "description"]),
        cpv_codes=pick_list_value(data, ["cpv", "cpvCodes"]),
        evidence_note=(
            "Parsed from the public ANAC legal-publicity API. "
            "Use the linked procurement documents as the canonical dossier."
        ),
        official_url=pick_first_value(data, ["officialUrl", "sourcePublicUrl"]),
        estimated_contract_value_text=pick_first_value(data, ["estimatedValueText"]) or value_raw,
        location_label=pick_first_value(data, ["location", "place", "city", "municipality"]),
        status=resolve_anac_record_status(data),
    )
