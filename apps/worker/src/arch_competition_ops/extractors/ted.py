from __future__ import annotations

import re
import unicodedata

from arch_competition_ops.extractors.common import (
    build_base_record,
    parse_iso_date,
    parse_money_amount,
    pick_first_value,
    pick_regex,
    try_load_json,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition


def _normalize_ted_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return " ".join(ascii_only.lower().split())


def _infer_ted_opportunity_type(title: str | None) -> str:
    normalized_title = _normalize_ted_text(title)
    contest_markers = ("design contest", "competition", "concours", "wettbewerb")
    if any(marker in normalized_title for marker in contest_markers):
        return "public_design_contest"
    return "public_design_services_procurement"


def _infer_ted_implementation_path(opportunity_type: str) -> str:
    if opportunity_type == "public_design_contest":
        return "winner_or_winners_progress_to_negotiated_service_award"
    return "service_contract_award_after_competitive_selection"


def _infer_ted_jurisdiction(title: str | None) -> str | None:
    if not title:
        return None

    match = re.match(r"^([^–-]+?)\s+[–-]\s+", title)
    if not match:
        return None

    country = match.group(1).strip().lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", _normalize_ted_text(country)).strip("_")
    return normalized or None


def parse_ted_notice(payload: str, source: SourceDefinition, source_url: str) -> CompetitionRecord:
    data = try_load_json(payload)

    title = None
    authority_name = None
    location_label = None
    official_notice_id = None
    procedure_type = None
    eligibility_summary = None
    implementation_path = None
    deadline_raw = None
    value_raw = None
    cpv_codes: list[str] = []

    if data:
        title = pick_first_value(data, ["title", "noticeTitle", "notice.title"])
        authority_name = pick_first_value(data, ["buyer", "authority", "contractingAuthority"])
        location_label = pick_first_value(data, ["location", "place", "city", "municipality"])
        official_notice_id = pick_first_value(data, ["noticeId", "notice-id", "id"])
        procedure_type = pick_first_value(data, ["procedureType", "procedure-type"])
        eligibility_summary = pick_first_value(data, ["eligibility", "requirements"])
        implementation_path = pick_first_value(data, ["implementationPath", "implementation-path"])
        deadline_raw = pick_first_value(data, ["deadline", "submissionDeadline"])
        value_raw = pick_first_value(data, ["estimatedValueEur", "estimated-contract-value-eur"])
        cpv_value = data.get("cpv") or data.get("cpvCodes") or []
        if isinstance(cpv_value, list):
            cpv_codes = [str(item) for item in cpv_value if isinstance(item, (str, int))]

    title = title or pick_regex(payload, [r'"title"\s*:\s*"([^"]+)"', r"<title>([^<]+)</title>"])
    authority_name = authority_name or pick_regex(
        payload,
        [r'"buyer"\s*:\s*"([^"]+)"', r"Contracting authority[^:]*:\s*([^<\n]+)"],
    )
    official_notice_id = official_notice_id or pick_regex(
        payload,
        [r'"noticeId"\s*:\s*"([^"]+)"', r"Notice ID[^:]*:\s*([^<\n]+)"],
    )
    procedure_type = procedure_type or pick_regex(
        payload,
        [r'"procedureType"\s*:\s*"([^"]+)"', r"Procedure type[^:]*:\s*([^<\n]+)"],
    )
    deadline_raw = deadline_raw or pick_regex(
        payload,
        [r'"deadline"\s*:\s*"([^"]+)"', r"Deadline[^:]*:\s*([^<\n]+)"],
    )
    value_raw = value_raw or pick_regex(
        payload,
        [r'"estimatedValueEur"\s*:\s*"([^"]+)"', r"Estimated value[^:]*:\s*([^<\n]+)"],
    )
    eligibility_summary = eligibility_summary or pick_regex(
        payload,
        [r'"eligibility"\s*:\s*"([^"]+)"', r"Eligibility[^:]*:\s*([^<\n]+)"],
    )
    implementation_path = implementation_path or pick_regex(
        payload,
        [r'"implementationPath"\s*:\s*"([^"]+)"', r"Implementation path[^:]*:\s*([^<\n]+)"],
    )

    if not title:
        raise ValueError("TED parser could not determine a title from the payload")

    opportunity_type = _infer_ted_opportunity_type(title)

    return build_base_record(
        source,
        source_url,
        title=title,
        authority_name=authority_name,
        opportunity_type=opportunity_type,
        procedure_type=procedure_type
        or ("design_contest" if opportunity_type == "public_design_contest" else "public_design_services_tender"),
        official_notice_id=official_notice_id,
        deadline_at=parse_iso_date(deadline_raw),
        estimated_contract_value_eur=parse_money_amount(value_raw),
        eligibility_summary=eligibility_summary,
        implementation_path=implementation_path or _infer_ted_implementation_path(opportunity_type),
        cpv_codes=cpv_codes,
        evidence_note="Parsed from the TED Search API payload after architecture-focused filtering. Verify dossier attachments before publishing.",
        jurisdiction=_infer_ted_jurisdiction(title),
        estimated_contract_value_text=value_raw,
        location_label=location_label,
    )
