from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: str
    quote: str


class ExtractedField(BaseModel):
    model_config = ConfigDict(extra="forbid")

    field: Literal[
        "title",
        "organizer",
        "authority_name",
        "official_url",
        "location_label",
        "location_city",
        "location_region",
        "deadline_at",
        "registration_fee_eur",
        "submission_fee_eur",
        "estimated_contract_value_eur",
        "estimated_contract_value_text",
        "prize_summary",
        "eligibility_summary",
        "brief_pdf_url",
        "documents_portal_url",
        "opportunity_type",
        "procedure_type",
        "implementation_path",
        "licensed_architect_required",
        "local_partner_required",
        "competition_types",
        "project_types",
        "building_categories",
        "design_scopes",
        "project_modes",
        "audience",
        "jurisdiction",
        "languages",
        "official_notice_id",
    ]
    value: str
    evidence_field: str
    quote: str


class NoticeDetail(BaseModel):
    model_config = ConfigDict(extra="forbid")

    category: Literal["timeline", "commercial", "eligibility", "scope", "submission"]
    text: str
    evidence_field: str
    quote: str


class ScreeningDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["recommend", "exclude", "needs_review"]
    relevance_score: int = Field(ge=0, le=100)
    summary_zh: str
    summary_en: str
    reasons_zh: list[str]
    reasons_en: list[str]
    missing_information: list[str]
    evidence: list[Evidence]
    extracted_fields: list[ExtractedField]
    notice_details: list[NoticeDetail] = Field(default_factory=list)


_NOTICE_FIELDS = ("notice_title", "notice_url", "notice_text", "notice_links")


def _locate_quote(
    field: str, quote: str, evidence_fields: dict[str, str]
) -> tuple[str, str] | None:
    # A valid attribution must stand on its own. Only an unknown label triggers a search.
    candidates = (field,) if field in _NOTICE_FIELDS else _NOTICE_FIELDS
    for candidate in candidates:
        original = source_quote(quote, evidence_fields.get(candidate, ""))
        if original is not None:
            return candidate, original
    return None


def grounded_extracted_fields(
    claims: list[ExtractedField], evidence_fields: dict[str, str], warnings: list[str]
) -> list[ExtractedField]:
    supported = []
    for claim in claims:
        match = _locate_quote(claim.evidence_field, claim.quote, evidence_fields)
        if match is None:
            warnings.append(f"{claim.field}: unsupported source quote")
            continue
        claim.evidence_field, claim.quote = match
        supported.append(claim)
    return supported


def validate_evidence(decision: ScreeningDecision, evidence_fields: dict[str, str]) -> list[str]:
    warnings: list[str] = []
    supported: list[Evidence] = []
    for evidence in decision.evidence:
        match = _locate_quote(evidence.field, evidence.quote, evidence_fields)
        if match is None:
            warnings.append(f"Unsupported decision evidence: {evidence.field}")
        else:
            evidence.field, evidence.quote = match
            supported.append(evidence)
    decision.evidence = supported
    if not supported:
        warnings.append("No source-grounded decision evidence")
    # An exclusion that keeps at least one verified quote stays hidden: a single paraphrased
    # quote must not turn a clear "not a design commission" into a visible review item.
    # A recommendation is shown to the reader, so any unsupported claim still downgrades it.
    if not supported or (warnings and decision.decision == "recommend"):
        decision.decision = "needs_review"
    decision.extracted_fields = grounded_extracted_fields(
        decision.extracted_fields, evidence_fields, warnings
    )
    details: list[NoticeDetail] = []
    for detail in decision.notice_details:
        match = _locate_quote(detail.evidence_field, detail.quote, evidence_fields)
        if match is None or (text := source_quote(detail.text, match[1])) is None:
            warnings.append(f"Unsupported participation excerpt: {detail.category}")
            continue
        detail.evidence_field, detail.quote = match
        detail.text = text
        if sum(d.category == detail.category for d in details) < 2 and not any(
            d.category == detail.category and d.text == detail.text for d in details
        ):
            details.append(detail)
    decision.notice_details = details
    if warnings:
        decision.missing_information.extend(warnings)
    return warnings


def source_quote(quote: str, text: str) -> str | None:
    """Return the source characters, preserving its spelling, punctuation and whitespace."""
    if not text or not quote.strip():
        return None
    if quote in text:
        return quote
    pattern = r"\s+".join(re.escape(word) for word in quote.split())
    match = re.search(pattern, text, flags=re.IGNORECASE)
    return match.group(0) if match else None


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
