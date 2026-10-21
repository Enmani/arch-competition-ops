from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

from arch_competition_ops.extractors.classification import (
    infer_building_categories,
    infer_competition_types,
    infer_project_types,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.competition import (
    UNKNOWN_OPPORTUNITY_TYPE,
    compute_extraction_confidence,
    compute_qualification_score,
    infer_licensed_architect_required,
    infer_local_partner_required,
    normalize_evidence_level,
    normalize_implementation_path,
    normalize_official_notice_id,
    normalize_opportunity_type,
    normalize_procedure_type,
)
from arch_competition_ops.normalizers.dates import parse_date, slash_order_for_jurisdiction
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
        if isinstance(value, int | float):
            return str(value)
    return None


def pick_list_value(payload: dict[str, Any], paths: list[str]) -> list[str]:
    for path in paths:
        value = get_nested_value(payload, path)
        if isinstance(value, list):
            normalized_values = [
                normalize_whitespace(str(item)) for item in value if str(item).strip()
            ]
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


def parse_source_date(raw_value: str | None, source: SourceDefinition) -> date | None:
    """Parse a date from ``source``; slash-date order follows the source jurisdiction."""
    return parse_date(raw_value, slash_order=slash_order_for_jurisdiction(source.jurisdiction))


def is_distinct_notice_url(source: SourceDefinition, source_url: str) -> bool:
    """True when ``source_url`` points somewhere more specific than the source's landing page.

    Used to avoid treating a placeholder ``base_url`` (what callers fall back to when they have no
    notice URL) as the official notice page.
    """
    return source_url.rstrip("/") != source.base_url.rstrip("/")


def parse_money_amount(raw_value: str | None) -> float | None:
    return parse_money_number(raw_value)


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
    cpv_codes: list[str],
    evidence_note: str | None,
    eligibility_summary: str | None = None,
    description: str | None = None,
    implementation_path: str | None = None,
    jurisdiction: str | None = None,
    evidence_level: str | None = None,
    official_url: str | None = None,
    source_url_is_notice_page: bool = False,
    brief_pdf_url: str | None = None,
    documents_portal_url: str | None = None,
    estimated_contract_value_text: str | None = None,
    location_label: str | None = None,
    project_types: list[str] | None = None,
    building_categories: list[str] | None = None,
    official_sectors: list[str] | None = None,
    built_asset_types: list[str] | None = None,
    design_scopes: list[str] | None = None,
    project_modes: list[str] | None = None,
    status: str = "discovered",
) -> CompetitionRecord:
    """Build a record from extracted evidence only (AGENTS.md truth rules).

    Nothing here is defaulted to a plausible value: fees, audience, implementation path, and
    official URL stay empty unless the notice said so.

    * ``organizer`` is the buyer named in the notice (``authority_name``) or ``''``; the publishing
      platform goes to ``source_id``/``source_name``.
    * ``official_url`` is the explicit official link. The only inferred case is
      ``source_url_is_notice_page=True`` on a ``primary``-tier source: the caller asserts that
      ``source_url`` *is* the authority's own notice page (not a search API endpoint, listing, or
      aggregator page), so it is the official link. Anything else leaves it empty.
    * ``eligibility_summary`` is the notice's own qualification clause, verbatim, or ``None``.
      Licence/local-partner requirements are inferred from it and from nothing else.
      Project prose goes to ``description``, which only feeds classification and keyword
      filtering and is never persisted.
    * fees are always ``None`` here: no extractor reads a fee from a notice yet, and only an
      explicit "free" statement may be recorded as 0.
    """
    normalized_title = normalize_whitespace(title) or title
    normalized_opportunity_type = (
        normalize_opportunity_type(opportunity_type)
        or normalize_whitespace(opportunity_type)
        or UNKNOWN_OPPORTUNITY_TYPE
    )
    normalized_procedure_type = normalize_procedure_type(procedure_type)
    normalized_implementation_path = normalize_implementation_path(implementation_path)
    normalized_authority = normalize_whitespace(authority_name)
    normalized_eligibility = normalize_whitespace(eligibility_summary)
    normalized_description = normalize_whitespace(description)
    inferred_competition_types = infer_competition_types(
        normalized_title,
        normalized_eligibility,
        normalized_description,
        normalized_procedure_type,
    )
    resolved_official_url = official_url
    if not resolved_official_url and source_url_is_notice_page and source.source_tier == "primary":
        resolved_official_url = source_url
    clause_text = normalized_eligibility

    record = CompetitionRecord(
        title=normalized_title,
        organizer=normalized_authority or "",
        source_id=source.source_id,
        source_name=source.name,
        authority_name=normalized_authority,
        official_url=resolved_official_url,
        source_url=source_url,
        status=status,
        opportunity_type=normalized_opportunity_type,
        jurisdiction=jurisdiction or source.jurisdiction,
        procedure_type=normalized_procedure_type,
        official_notice_id=normalize_official_notice_id(official_notice_id),
        regions=source.regions,
        languages=source.languages,
        competition_types=inferred_competition_types,
        project_types=infer_project_types(
            inferred_competition_types,
            project_types=project_types,
        ),
        building_categories=infer_building_categories(
            inferred_competition_types,
            building_categories=building_categories,
            text=(
                f"{normalized_title} {normalized_eligibility or ''} "
                f"{normalized_description or ''} {normalized_authority or ''}"
            ),
        ),
        official_sectors=official_sectors or [],
        built_asset_types=built_asset_types or [],
        design_scopes=design_scopes or [],
        project_modes=project_modes or [],
        audience=[],
        cpv_codes=cpv_codes,
        implementation_path=normalized_implementation_path,
        licensed_architect_required=infer_licensed_architect_required(clause_text),
        local_partner_required=infer_local_partner_required(clause_text),
        registration_fee_eur=None,
        submission_fee_eur=None,
        estimated_contract_value_eur=estimated_contract_value_eur,
        estimated_contract_value_text=normalize_whitespace(estimated_contract_value_text),
        location_label=normalize_whitespace(location_label),
        deadline_at=deadline_at,
        eligibility_summary=normalized_eligibility,
        description=normalized_description,
        brief_pdf_url=brief_pdf_url,
        documents_portal_url=documents_portal_url,
        evidence_level=normalize_evidence_level(evidence_level, source_tier=source.source_tier),
        evidence_note=normalize_whitespace(evidence_note),
    )
    record.extraction_confidence = compute_extraction_confidence(record)
    record.qualification_score = compute_qualification_score(record)
    return record
