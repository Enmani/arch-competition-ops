from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any

from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.competition import (
    UNKNOWN_OPPORTUNITY_TYPE,
    compute_qualification_score as compute_normalized_qualification_score,
    infer_licensed_architect_required as infer_normalized_licensed_architect_required,
    infer_local_partner_required,
    normalize_evidence_level,
    normalize_implementation_path,
    normalize_official_notice_id,
    normalize_opportunity_type,
    normalize_procedure_type,
)
from arch_competition_ops.normalizers.money import parse_money_number


def normalize_whitespace(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = re.sub(r"\s+", " ", value)
    return collapsed.strip() or None


def try_load_json(payload: str) -> dict[str, Any] | None:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return None

    if isinstance(data, dict):
        return data
    return None


def get_nested_value(payload: dict[str, Any], path: str) -> Any:
    current: Any = payload
    for segment in path.split("."):
        if not isinstance(current, dict) or segment not in current:
            return None
        current = current[segment]
    return current


def pick_first_value(payload: dict[str, Any], paths: list[str]) -> str | None:
    for path in paths:
        value = get_nested_value(payload, path)
        if isinstance(value, str) and normalize_whitespace(value):
            return normalize_whitespace(value)
        if isinstance(value, (int, float)):
            return str(value)
    return None


def pick_list_value(payload: dict[str, Any], paths: list[str]) -> list[str]:
    for path in paths:
        value = get_nested_value(payload, path)
        if isinstance(value, list):
            normalized_values = [normalize_whitespace(str(item)) for item in value if str(item).strip()]
            return [item for item in normalized_values if item]
        if isinstance(value, str) and normalize_whitespace(value):
            return [normalize_whitespace(value)]  # type: ignore[list-item]
    return []


def pick_regex(payload: str, patterns: list[str]) -> str | None:
    for pattern in patterns:
        match = re.search(pattern, payload, flags=re.IGNORECASE | re.DOTALL)
        if match:
            return normalize_whitespace(match.group(1))
    return None


def parse_iso_date(raw_value: str | None) -> date | None:
    if not raw_value:
        return None

    cleaned = re.sub(r"\s+", " ", raw_value.strip())
    for candidate in (cleaned, cleaned.replace("/", "-"), cleaned.split("T")[0], cleaned.split(" ")[0]):
        try:
            return date.fromisoformat(candidate)
        except ValueError:
            continue

    for fmt in ("%B %d, %Y", "%b %d, %Y", "%d.%m.%Y"):
        try:
            return datetime.strptime(cleaned, fmt).date()
        except ValueError:
            continue

    dotted_match = re.search(r"\b(\d{2}\.\d{2}\.\d{4})\b", cleaned)
    if dotted_match:
        try:
            return datetime.strptime(dotted_match.group(1), "%d.%m.%Y").date()
        except ValueError:
            return None

    month_name_match = re.search(r"\b([A-Za-z]{3,9} \d{1,2}, \d{4})\b", cleaned)
    if month_name_match:
        for fmt in ("%B %d, %Y", "%b %d, %Y"):
            try:
                return datetime.strptime(month_name_match.group(1), fmt).date()
            except ValueError:
                continue
    return None


def parse_money_amount(raw_value: str | None) -> float | None:
    return parse_money_number(raw_value)


def infer_competition_types(*chunks: str | None) -> list[str]:
    haystack = " ".join(chunk for chunk in chunks if chunk).lower()
    inferred: list[str] = []
    keyword_map = {
        "public_building": ["library", "civic", "public building"],
        "urban_design": ["square", "urban", "public space", "masterplan"],
        "healthcare": ["hospital", "healthcare", "clinic"],
        "education": ["school", "campus", "education"],
        "adaptive_reuse": ["adaptive reuse", "reuse", "conversion"],
        "masterplan": ["masterplan", "planning"],
        "architecture": ["design", "architecture", "architect"],
    }

    for category, keywords in keyword_map.items():
        if any(keyword in haystack for keyword in keywords):
            inferred.append(category)

    return inferred or ["architecture"]


def infer_licensed_architect_required(*chunks: str | None) -> bool | None:
    return infer_normalized_licensed_architect_required(*chunks)


def compute_qualification_score(record: CompetitionRecord) -> float:
    return compute_normalized_qualification_score(record)


def build_base_record(
    source: SourceDefinition,
    source_url: str,
    *,
    title: str,
    authority_name: str | None,
    opportunity_type: str | None,
    procedure_type: str | None,
    official_notice_id: str | None,
    deadline_at: date | None,
    estimated_contract_value_eur: float | None,
    eligibility_summary: str | None,
    implementation_path: str | None,
    cpv_codes: list[str],
    evidence_note: str | None,
    jurisdiction: str | None = None,
    evidence_level: str | None = None,
    official_url: str | None = None,
    brief_pdf_url: str | None = None,
    documents_portal_url: str | None = None,
    estimated_contract_value_text: str | None = None,
    location_label: str | None = None,
) -> CompetitionRecord:
    normalized_title = normalize_whitespace(title) or title
    normalized_opportunity_type = (
        normalize_opportunity_type(opportunity_type)
        or normalize_whitespace(opportunity_type)
        or UNKNOWN_OPPORTUNITY_TYPE
    )
    normalized_procedure_type = normalize_procedure_type(procedure_type)
    normalized_implementation_path = normalize_implementation_path(
        implementation_path,
        opportunity_type=normalized_opportunity_type,
    )
    record = CompetitionRecord(
        title=normalized_title,
        organizer=source.name,
        authority_name=normalize_whitespace(authority_name),
        official_url=official_url or source_url,
        source_url=source_url,
        status="discovered",
        opportunity_type=normalized_opportunity_type,
        jurisdiction=jurisdiction or source.jurisdiction,
        procedure_type=normalized_procedure_type,
        official_notice_id=normalize_official_notice_id(official_notice_id),
        regions=source.regions,
        languages=source.languages,
        competition_types=infer_competition_types(
            normalized_title,
            eligibility_summary,
            normalized_implementation_path,
            normalized_procedure_type,
        ),
        audience=["professionals", "multidisciplinary"],
        cpv_codes=cpv_codes,
        implementation_path=normalized_implementation_path,
        licensed_architect_required=infer_licensed_architect_required(
            eligibility_summary,
            normalized_title,
            normalized_procedure_type,
        ),
        local_partner_required=infer_local_partner_required(eligibility_summary),
        registration_fee_eur=0.0,
        submission_fee_eur=0.0,
        estimated_contract_value_eur=estimated_contract_value_eur,
        estimated_contract_value_text=normalize_whitespace(estimated_contract_value_text),
        location_label=normalize_whitespace(location_label),
        deadline_at=deadline_at,
        eligibility_summary=normalize_whitespace(eligibility_summary),
        brief_pdf_url=brief_pdf_url,
        documents_portal_url=documents_portal_url,
        extraction_confidence=0.78,
        evidence_level=normalize_evidence_level(evidence_level, source_tier=source.source_tier),
        evidence_note=normalize_whitespace(evidence_note),
    )
    record.qualification_score = compute_qualification_score(record)
    return record
