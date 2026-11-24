from __future__ import annotations

import json
import re
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


FactName = Literal[
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
DetailCategory = Literal["timeline", "commercial", "eligibility", "scope", "submission"]


class QuotedFact(_StrictModel):
    field: FactName
    value: str
    quote: str


class QuotedDetail(_StrictModel):
    category: DetailCategory
    quote: str


class _Judgment(_StrictModel):
    decision: Literal["recommend", "exclude", "needs_review"]
    relevance_score: int = Field(ge=0, le=100)
    summary_zh: str
    summary_en: str
    reasons_zh: list[str]
    reasons_en: list[str]
    missing_information: list[str]


class ScreeningAnswer(_Judgment):
    schema_version: ClassVar[int] = 2
    evidence: list[str]
    extracted_fields: list[QuotedFact]
    notice_details: list[QuotedDetail]


class Evidence(_StrictModel):
    field: str
    quote: str


class ExtractedField(_StrictModel):
    field: FactName
    value: str
    evidence_field: str
    quote: str


class NoticeDetail(_StrictModel):
    category: DetailCategory
    text: str
    evidence_field: str
    quote: str


class ScreeningDecision(_Judgment):
    evidence: list[Evidence]
    extracted_fields: list[ExtractedField]
    notice_details: list[NoticeDetail] = Field(default_factory=list)


def validate_evidence(
    answer: ScreeningAnswer, evidence_fields: dict[str, str]
) -> ScreeningDecision:
    """Resolve the wire answer into the public contract using only supplied source characters."""

    def locate(quote: str) -> Evidence | None:
        for field in ("notice_title", "notice_text", "notice_url", "notice_links"):
            if (original := source_quote(quote, evidence_fields.get(field, ""))) is not None:
                return Evidence(field=field, quote=original)
        return None

    evidence = [match for quote in answer.evidence if (match := locate(quote)) is not None]
    warnings = []
    if len(evidence) < len(answer.evidence):
        warnings.append("Unsupported decision evidence")
    if not evidence:
        warnings.append("No source-grounded decision evidence")
    decision = answer.decision
    if not evidence or (warnings and decision == "recommend"):
        decision = "needs_review"

    facts = []
    for fact in answer.extracted_fields:
        if match := locate(fact.quote):
            facts.append(
                ExtractedField(
                    field=fact.field,
                    value=fact.value,
                    quote=match.quote,
                    evidence_field=match.field,
                )
            )
        else:
            warnings.append(f"{fact.field}: unsupported source quote")

    details = []
    for detail in answer.notice_details:
        match = locate(detail.quote)
        if match is None:
            warnings.append(f"Unsupported participation excerpt: {detail.category}")
            continue
        existing = [item.text for item in details if item.category == detail.category]
        if len(existing) < 2 and match.quote not in existing:
            details.append(
                NoticeDetail(
                    category=detail.category,
                    text=match.quote,
                    quote=match.quote,
                    evidence_field=match.field,
                )
            )
    return ScreeningDecision(
        **answer.model_dump(
            include={"relevance_score", "summary_en", "summary_zh", "reasons_en", "reasons_zh"}
        ),
        decision=decision,
        missing_information=[*answer.missing_information, *warnings],
        evidence=evidence,
        extracted_fields=facts,
        notice_details=details,
    )


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
