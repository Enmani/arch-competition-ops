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


def validate_evidence(decision: ScreeningDecision, evidence_fields: dict[str, str]) -> list[str]:
    warnings: list[str] = []
    supported: list[Evidence] = []
    for evidence in decision.evidence:
        original = source_quote(evidence.quote, evidence_fields.get(evidence.field, ""))
        if original is None:
            warnings.append(f"Unsupported decision evidence: {evidence.field}")
        else:
            evidence.quote = original
            supported.append(evidence)
    decision.evidence = supported
    if not supported:
        warnings.append("No source-grounded decision evidence")
    # An exclusion that keeps at least one verified quote stays hidden: a single paraphrased
    # quote must not turn a clear "not a design commission" into a visible review item.
    # A recommendation is shown to the reader, so any unsupported claim still downgrades it.
    if not supported or (warnings and decision.decision == "recommend"):
        decision.decision = "needs_review"
    details: list[NoticeDetail] = []
    for detail in decision.notice_details:
        original = source_quote(detail.quote, evidence_fields.get(detail.evidence_field, ""))
        text = source_quote(detail.text, original or "")
        if not detail.evidence_field.startswith("notice_") or not original or not text:
            warnings.append(f"Unsupported participation excerpt: {detail.category}")
            continue
        detail.quote, detail.text = original, text
        if sum(d.category == detail.category for d in details) < 2 and not any(
            d.category == detail.category and d.text == detail.text for d in details
        ):
            details.append(detail)
    decision.notice_details = details
    if warnings:
        decision.missing_information.extend(warnings)
    return warnings


def source_quote(quote: str, text: str) -> str | None:
    """Return source characters; tolerate casing only, never changed words or punctuation."""
    if not quote.strip():
        return None
    if quote in text:
        return quote
    match = re.search(re.escape(quote), text, flags=re.IGNORECASE)
    return match.group(0) if match else None


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
