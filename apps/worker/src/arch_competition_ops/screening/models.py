from __future__ import annotations

import html
import json
import re
from typing import ClassVar, Literal

from pydantic import BaseModel, ConfigDict, Field

from arch_competition_ops.screening.field_contract import FIELDS, FactName

_HTML_ENTITY = re.compile(r"&(?:#\d+|#x[0-9a-fA-F]+|[A-Za-z][A-Za-z0-9]+);")
_TYPOGRAPHY_MAP = str.maketrans(
    {
        "\u2018": "'",
        "\u2019": "'",
        "\u201a": "'",
        "\u201b": "'",
        "\u2032": "'",
        "\u02bc": "'",
        "\u201c": '"',
        "\u201d": '"',
        "\u201e": '"',
        "\u201f": '"',
        "\u2013": "-",
        "\u2014": "-",
        "\u2015": "-",
        "\u2212": "-",
        "\u2010": "-",
        "\u2011": "-",
        "\u00a0": " ",
        "\u2002": " ",
        "\u2003": " ",
        "\u2009": " ",
        "\u202f": " ",
        "\u3000": " ",
        "\uff1a": ":",
        "\uff0c": ",",
        "\uff1b": ";",
        "\uff08": "(",
        "\uff09": ")",
        "\uff01": "!",
        "\uff1f": "?",
        "\uff05": "%",
        "\u3010": "[",
        "\u3011": "]",
    }
)
_ZERO_WIDTH = frozenset("\u200b\u200c\u200d\ufeff")
_CLARIFICATION_TITLE = re.compile(
    r"澄清|更正|变更公告|答疑|补遗|勘误|corrigendum|clarification|addendum|amendment",
    re.IGNORECASE,
)
_SCOPE_MISSING = re.compile(
    r"范围|原招标|原公告|scope|design work|original notice|missing notice",
    re.IGNORECASE,
)


def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    return (
        0x4E00 <= code <= 0x9FFF
        or 0x3400 <= code <= 0x4DBF
        or 0x3000 <= code <= 0x303F
        or 0xFF00 <= code <= 0xFFEF
    )


class _StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


DetailCategory = Literal["timeline", "commercial", "eligibility", "scope", "submission"]


class TextFact(_StrictModel):
    field: Literal[
        *[name for name, spec in FIELDS.items() if spec.kind == "text" and name != "title"]
    ]
    quote: str


class NormalizedFact(_StrictModel):
    field: Literal[*[name for name, spec in FIELDS.items() if spec.kind != "text"]]
    value: str
    quote: str


class QuotedDetail(_StrictModel):
    category: DetailCategory
    quote: str


class _Judgment(_StrictModel):
    decision: Literal["recommend", "exclude", "needs_review"]
    relevance_score: int = Field(
        ge=0,
        le=100,
        description=(
            "Integer score from 0 to 100: 0-20 for excluded/non-design or closed notices, "
            "30-65 for needs_review/uncertain scope, 75-100 for recommended open spatial "
            "design commissions."
        ),
    )
    summary_zh: str
    summary_en: str
    reasons_zh: list[str]
    reasons_en: list[str]
    missing_information: list[str]


class ScreeningAnswer(_Judgment):
    schema_version: ClassVar[int] = 7
    title_quote: str = Field(description=FIELDS["title"].description)
    evidence: list[str]
    extracted_fields: list[TextFact | NormalizedFact]
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


def classify_review_reasons(
    *,
    decision: str,
    model_decision: str,
    evidence: list[Evidence],
    warnings: list[str],
    limitations: tuple[str, ...] | list[str],
    missing_information: list[str],
    evidence_fields: dict[str, str],
) -> list[str]:
    """Classify why a notice landed in needs_review for diagnostics and reporting."""
    if decision != "needs_review":
        return []
    reasons: list[str] = []
    if not evidence or (model_decision == "recommend" and warnings):
        reasons.append("unsupported_quote")
    if any(
        "Detail unavailable" in item
        or "No source notice text" in item
        or "could not be fetched" in item
        or "PDF content was not read" in item
        or "truncated" in item
        for item in limitations
    ):
        reasons.append("missing_notice_text")
    title_and_text = (
        evidence_fields.get("notice_title", "")
        + "\n"
        + evidence_fields.get("notice_text", "")[:400]
    )
    missing_text = " ".join(missing_information)
    if _CLARIFICATION_TITLE.search(title_and_text) and _SCOPE_MISSING.search(missing_text):
        reasons.append("unlinked_clarification")
    if model_decision == "needs_review" and not reasons:
        reasons.append("model_uncertain")
    return reasons


def validate_evidence(
    answer: ScreeningAnswer,
    evidence_fields: dict[str, str],
    mapped=(),
    *,
    diagnostics: dict[str, object] | None = None,
    limitations: tuple[str, ...] | list[str] = (),
) -> ScreeningDecision:
    """Resolve the wire answer into the public contract using only supplied source characters."""

    def locate(quote: str) -> Evidence | None:
        for field in ("notice_title", "notice_text", "notice_url", "notice_links"):
            if (original := source_quote(quote, evidence_fields.get(field, ""))) is not None:
                return Evidence(field=field, quote=original)
        return None

    unmatched: list[str] = []

    def record_unmatched(quote: str) -> None:
        cleaned = " ".join(quote.split())[:180]
        if cleaned and cleaned not in unmatched and len(unmatched) < 8:
            unmatched.append(cleaned)

    evidence: list[Evidence] = []
    for quote in answer.evidence:
        if (match := locate(quote)) is not None:
            evidence.append(match)
        else:
            record_unmatched(quote)
    warnings = []
    if len(evidence) < len(answer.evidence):
        warnings.append("Unsupported decision evidence")
    if not evidence:
        warnings.append("No source-grounded decision evidence")
    decision = answer.decision
    if not evidence or (warnings and decision == "recommend"):
        decision = "needs_review"

    facts = [ExtractedField.model_validate(fact) for fact in mapped]
    known = {fact.field for fact in facts}
    original_title = evidence_fields.get("notice_title", "")
    title = original_title or source_quote(
        answer.title_quote, evidence_fields.get("notice_text", "")
    )
    if title and "title" not in known:
        facts.append(
            ExtractedField(
                field="title",
                value=title,
                quote=title,
                evidence_field="notice_title" if original_title else "notice_text",
            )
        )
    elif answer.title_quote:
        warnings.append("title: unsupported source quote")
        record_unmatched(answer.title_quote)
    for fact in answer.extracted_fields:
        if fact.field in known:
            continue
        if match := locate(fact.quote):
            facts.append(
                ExtractedField(
                    field=fact.field,
                    value=match.quote if isinstance(fact, TextFact) else fact.value,
                    quote=match.quote,
                    evidence_field=match.field,
                )
            )
        else:
            warnings.append(f"{fact.field}: unsupported source quote")
            record_unmatched(fact.quote)

    details = []
    for detail in answer.notice_details:
        match = locate(detail.quote)
        if match is None:
            warnings.append(f"Unsupported participation excerpt: {detail.category}")
            record_unmatched(detail.quote)
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
    combined_missing = [*answer.missing_information, *warnings]
    if diagnostics is not None:
        diagnostics["model_decision"] = answer.decision
        diagnostics["unmatched_quotes"] = unmatched
        diagnostics["review_reasons"] = classify_review_reasons(
            decision=decision,
            model_decision=answer.decision,
            evidence=evidence,
            warnings=warnings,
            limitations=limitations,
            missing_information=combined_missing,
            evidence_fields=evidence_fields,
        )
    return ScreeningDecision(
        **answer.model_dump(
            include={"relevance_score", "summary_en", "summary_zh", "reasons_en", "reasons_zh"}
        ),
        decision=decision,
        missing_information=combined_missing,
        evidence=evidence,
        extracted_fields=facts,
        notice_details=details,
    )


def _normalize_with_spans(raw: str) -> tuple[str, list[int], list[int]]:
    """Reversibly normalize HTML entities, typography and whitespace while preserving raw spans."""
    chars: list[str] = []
    starts: list[int] = []
    ends: list[int] = []
    idx = 0
    length = len(raw)
    while idx < length:
        if raw[idx] == "&" and (entity := _HTML_ENTITY.match(raw, idx)):
            decoded = html.unescape(entity.group(0))
            span_start, span_end = entity.start(), entity.end()
            idx = span_end
        else:
            decoded = raw[idx]
            span_start, span_end = idx, idx + 1
            idx += 1
        translated = decoded.translate(_TYPOGRAPHY_MAP)
        for ch in translated:
            if ch in _ZERO_WIDTH:
                continue
            if ch.isspace():
                if chars and chars[-1] != " ":
                    chars.append(" ")
                    starts.append(span_start)
                    ends.append(span_end)
                elif chars:
                    ends[-1] = span_end
            else:
                chars.append(ch.lower())
                starts.append(span_start)
                ends.append(span_end)
    if chars and chars[-1] == " ":
        chars.pop()
        starts.pop()
        ends.pop()
    return "".join(chars), starts, ends


def _reversible_quote_pattern(norm_quote: str) -> str:
    parts: list[str] = []
    prev_char = ""
    for ch in norm_quote:
        if ch == " ":
            parts.append(r"\s+")
            prev_char = " "
            continue
        if prev_char and prev_char != " " and (_is_cjk(prev_char) or _is_cjk(ch)):
            parts.append(r"\s*")
        parts.append(re.escape(ch))
        prev_char = ch
    return "".join(parts)


def source_quote(quote: str, text: str) -> str | None:
    """Return the source characters, preserving its spelling, punctuation and whitespace."""
    if not text or not quote.strip():
        return None
    if quote in text:
        return quote
    pattern = r"\s+".join(re.escape(word) for word in quote.split())
    match = re.search(pattern, text, flags=re.IGNORECASE)
    if match is not None:
        return match.group(0)
    norm_quote, _, _ = _normalize_with_spans(quote)
    if not norm_quote:
        return None
    norm_text, starts, ends = _normalize_with_spans(text)
    if not norm_text:
        return None
    rev_match = re.search(_reversible_quote_pattern(norm_quote), norm_text)
    if rev_match is None or rev_match.start() >= rev_match.end():
        return None
    return text[starts[rev_match.start()] : ends[rev_match.end() - 1]]


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
