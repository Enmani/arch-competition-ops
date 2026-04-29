from __future__ import annotations

import json
import unicodedata
from datetime import date
from typing import Any
from urllib import request

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.models import SourceDefinition


TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search"
TED_FIELDS = [
    "notice-title",
    "notice-identifier",
    "publication-date",
    "deadline-receipt-expressions-date-lot",
    "classification-cpv",
    "organisation-name-buyer",
    "procedure-type",
    "estimated-value-lot",
]

STRONG_POSITIVE_TITLE_MARKERS = (
    "architectural and related services",
    "architectural engineering and planning services",
    "architectural services",
    "design contest",
    "planning competition",
    "maitrise d oeuvre",
)

POSITIVE_TITLE_MARKERS = (
    "architect ",
    " architect",
    "architecture",
    "architectural",
    "design services",
    "design consultancy",
    "architekt",
    "landscape",
    "masterplan",
    "urban design",
    "public space",
    "planning consultancy",
)

NEGATIVE_TITLE_MARKERS = (
    "supervision of building work",
    "construction work",
    "surveying services",
    "inspection services",
    "feasibility study advisory service analysis",
    "technical testing analysis and consultancy services",
    "civil engineering consultancy services",
    "civil engineering led",
    "consultant for",
    "water potable",
    "wastewater",
    "assainissement",
)

FALLBACK_RELEVANT_CPV_CODES = {
    "71200000",
    "71210000",
    "71220000",
    "71221000",
    "71222000",
    "71223000",
    "71230000",
    "71420000",
}


def _default_fetch_json(url: str, body: dict[str, Any]) -> dict[str, Any]:
    payload = json.dumps(body).encode("utf-8")
    http_request = request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(http_request, timeout=30) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8"))


def _normalize_publication_date(raw_value: str | None) -> str:
    if not raw_value:
        return "today(-365)"
    try:
        parsed = date.fromisoformat(raw_value)
    except ValueError:
        return "today(-365)"
    return parsed.strftime("%Y%m%d")


def _pick_localized_value(payload: Any, preferred_language: str = "eng") -> str | None:
    if isinstance(payload, str):
        return payload
    if isinstance(payload, list):
        first = next((item for item in payload if isinstance(item, str) and item.strip()), None)
        return first.strip() if first else None
    if isinstance(payload, dict):
        preferred = payload.get(preferred_language) or payload.get(preferred_language.upper())
        if preferred:
            return _pick_localized_value(preferred, preferred_language=preferred_language)
        first_value = next(iter(payload.values()), None)
        return _pick_localized_value(first_value, preferred_language=preferred_language)
    return None


def _pick_first_string(payload: Any) -> str | None:
    if isinstance(payload, str):
        return payload.strip() or None
    if isinstance(payload, list):
        for item in payload:
            if isinstance(item, str) and item.strip():
                return item.strip()
    return None


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    alphanumeric_only = "".join(char if char.isalnum() else " " for char in ascii_only.lower())
    collapsed = " ".join(alphanumeric_only.split())
    return collapsed


def _dedupe_preserving_order(values: list[str]) -> list[str]:
    seen: set[str] = set()
    ordered: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        ordered.append(value)
    return ordered


def _extract_cpv_codes(notice: dict[str, Any]) -> list[str]:
    raw_codes = [
        str(item).strip()
        for item in notice.get("classification-cpv", [])
        if isinstance(item, str) and item.strip()
    ]
    return _dedupe_preserving_order(raw_codes)


def _is_relevant_design_notice(title: str, cpv_codes: list[str]) -> bool:
    normalized_title = _normalize_text(title)

    if any(marker in normalized_title for marker in NEGATIVE_TITLE_MARKERS):
        return False

    if any(marker in normalized_title for marker in STRONG_POSITIVE_TITLE_MARKERS):
        return True

    if any(marker in normalized_title for marker in POSITIVE_TITLE_MARKERS):
        return True

    return any(code in FALLBACK_RELEVANT_CPV_CODES for code in cpv_codes)


def _build_notice_payload(notice: dict[str, Any]) -> tuple[str, str]:
    title = _pick_localized_value(notice.get("notice-title")) or "Untitled TED notice"
    buyer = _pick_localized_value(notice.get("organisation-name-buyer")) or "Unknown authority"
    notice_id = _pick_first_string(notice.get("publication-number")) or _pick_first_string(
        notice.get("notice-identifier")
    )
    deadline = _pick_first_string(notice.get("deadline-receipt-expressions-date-lot"))
    estimated_value = _pick_first_string(notice.get("estimated-value-lot"))
    procedure_type = _pick_first_string(notice.get("procedure-type")) or "open"
    cpv_codes = _extract_cpv_codes(notice)

    links = notice.get("links", {})
    html_direct = links.get("htmlDirect", {}) if isinstance(links, dict) else {}
    html_links = links.get("html", {}) if isinstance(links, dict) else {}
    detail_url = (
        html_direct.get("ENG")
        or html_direct.get("eng")
        or html_links.get("ENG")
        or html_links.get("eng")
        or links.get("xml", {}).get("MUL")
        or TED_SEARCH_URL
    )

    payload = json.dumps(
        {
            "noticeId": notice_id,
            "title": title,
            "buyer": buyer,
            "procedureType": procedure_type,
            "deadline": deadline,
            "estimatedValueEur": estimated_value,
            "cpv": cpv_codes,
            "publicationDate": _pick_first_string(notice.get("publication-date")),
        },
        ensure_ascii=False,
    )
    return detail_url, payload


def collect_ted_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    query_date = _normalize_publication_date(publication_date_from)
    body = {
        "query": (
            "classification-cpv = 712* "
            f"AND publication-date >= {query_date} "
            "SORT BY publication-date DESC"
        ),
        "fields": TED_FIELDS,
        "limit": limit,
        "page": 1,
        "paginationMode": "PAGE_NUMBER",
    }
    response = (fetch_json or _default_fetch_json)(TED_SEARCH_URL, body)
    notices = response.get("notices", []) if isinstance(response, dict) else []

    documents: list[CollectedSourceDocument] = []
    for notice in notices:
        if not isinstance(notice, dict):
            continue
        title = _pick_localized_value(notice.get("notice-title")) or ""
        cpv_codes = _extract_cpv_codes(notice)
        if not title or not _is_relevant_design_notice(title, cpv_codes):
            continue
        source_url, payload = _build_notice_payload(notice)
        documents.append(CollectedSourceDocument(source_url=source_url, payload=payload))

    return documents
