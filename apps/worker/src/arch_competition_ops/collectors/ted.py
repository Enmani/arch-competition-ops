from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import date
from typing import Any

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import fetch_json_post
from arch_competition_ops.collectors.pagination import page_limit, unfinished_page
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.money import format_money_text

logger = logging.getLogger(__name__)

TED_SEARCH_URL = "https://api.ted.europa.eu/v3/notices/search"
TED_PAGE_SIZE = 250  # The search API's largest page.
TED_MAX_PAGES = 40  # 10,000 notices: far above any week of the AI scope (~1,200).
TED_FIELDS = [
    "notice-title",
    "notice-type",
    "description-proc",
    "place-of-performance",
    "notice-identifier",
    "publication-date",
    "deadline-receipt-expressions-date-lot",
    "deadline-receipt-request-date-lot",
    "deadline-receipt-tender-date-lot",
    "classification-cpv",
    "organisation-name-buyer",
    "procedure-type",
    "estimated-value-lot",
    "estimated-value-cur-lot",
]


def _default_fetch_json(url: str, body: dict[str, Any]) -> dict[str, Any]:
    return fetch_json_post(url, body, headers={"Accept": "application/json"})


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
    """First usable scalar as text; TED returns numbers (values) as well as strings."""
    if isinstance(payload, bool):
        return None
    if isinstance(payload, int | float):
        return str(payload)
    if isinstance(payload, str):
        return payload.strip() or None
    if isinstance(payload, list):
        for item in payload:
            picked = _pick_first_string(item)
            if picked:
                return picked
    return None


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


def _estimated_value(notice: dict[str, Any]) -> tuple[str | None, str | None]:
    """``(euro amount, display text)`` for the lot value.

    ``estimated-value-cur-lot`` (BT-27-Lot-Currency) is listed in the official TED field list
    (https://docs.ted.europa.eu/ODS/latest/reuse/field-list.html). Without currency evidence the
    amount is never called euros: the euro field stays empty and only display text, marked as
    currency-less, is kept. Only an explicit ``EUR`` fills the euro field.
    """
    amount = _pick_first_string(notice.get("estimated-value-lot"))
    if amount is None:
        return None, None
    currency = (_pick_first_string(notice.get("estimated-value-cur-lot")) or "").upper() or None
    text = format_money_text(amount=amount, currency=currency)
    if currency is None and text:
        text = f"{text} (currency not stated)"
    return (amount if currency == "EUR" else None), text


def _build_notice_payload(notice: dict[str, Any]) -> tuple[str, str]:
    title = _pick_localized_value(notice.get("notice-title")) or "Untitled TED notice"
    notice_id = _pick_first_string(notice.get("publication-number")) or _pick_first_string(
        notice.get("notice-identifier")
    )
    value_eur, value_text = _estimated_value(notice)

    links = notice.get("links", {})
    html_direct = links.get("htmlDirect", {}) if isinstance(links, dict) else {}
    html_links = links.get("html", {}) if isinstance(links, dict) else {}
    notice_page_url = (
        html_direct.get("ENG")
        or html_direct.get("eng")
        or html_links.get("ENG")
        or html_links.get("eng")
    )
    # source_url must always exist; the API endpoint is a valid fallback for it, but only a real
    # notice page is an official URL.
    detail_url = (
        notice_page_url
        or (links.get("xml", {}).get("MUL") if isinstance(links, dict) else None)
        or TED_SEARCH_URL
    )

    payload = json.dumps(
        {
            "noticeId": notice_id,
            "title": title,
            # Put decision-bearing source facts before the repeated multilingual metadata.
            # Both list previews and detailed inputs have finite text budgets.
            "noticeType": _pick_first_string(notice.get("notice-type")),
            "tenderDeadline": notice.get("deadline-receipt-tender-date-lot"),
            "participationDeadline": notice.get("deadline-receipt-request-date-lot"),
            "description": _pick_localized_value(notice.get("description-proc")),
            "placeOfPerformance": notice.get("place-of-performance"),
            "buyer": _pick_localized_value(notice.get("organisation-name-buyer")),
            "procedureType": _pick_first_string(notice.get("procedure-type")),
            "deadline": _pick_first_string(notice.get("deadline-receipt-expressions-date-lot")),
            "estimatedValueEur": value_eur,
            "estimatedValueText": value_text,
            "cpv": _extract_cpv_codes(notice),
            "publicationDate": _pick_first_string(notice.get("publication-date")),
            "officialUrl": notice_page_url,
            "rawNotice": notice,
        },
        ensure_ascii=False,
    )
    return detail_url, payload


def _search(
    fetch: Callable[[str, dict[str, Any]], dict[str, Any]],
    query: str,
    *,
    page_size: int,
) -> list[dict[str, Any]]:
    """Every notice of one query that ``keep`` accepts, in no particular order.

    Iteration paging, unsorted: checked live on 2026-11-15 over one week of the AI scope, it
    returned all 1,188 notices exactly once. Page-number paging under ``SORT BY publication-date``
    repeated some same-day notices across pages and so skipped others, and iteration combined
    with a sort stopped early (750, or 500 at page size 100). Callers sort locally.
    """
    kept: list[dict[str, Any]] = []
    token: str | None = None
    tokens = set()
    for _page in range(page_limit(TED_MAX_PAGES)):
        body: dict[str, Any] = {
            "query": query,
            "fields": TED_FIELDS,
            "limit": page_size,
            "paginationMode": "ITERATION",
        }
        if token:
            body["iterationNextToken"] = token
        response = fetch(TED_SEARCH_URL, body)
        notices = response.get("notices", []) if isinstance(response, dict) else []
        kept.extend(notice for notice in notices if isinstance(notice, dict))
        token = response.get("iterationNextToken") if isinstance(response, dict) else None
        if token and token in tokens:
            unfinished_page()
            break
        tokens.add(token)
        if not notices or not token:
            break
    else:
        unfinished_page()
        logger.warning(
            "TED paging stopped after %d pages; later notices were not read", TED_MAX_PAGES
        )
    return kept


def _notice_key(notice: dict[str, Any]) -> str | None:
    return _pick_first_string(notice.get("publication-number")) or _pick_first_string(
        notice.get("notice-identifier")
    )


def _merge_newest_first(*searches: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One list per notice (first occurrence wins), newest publication first, stable."""
    merged: dict[str, dict[str, Any]] = {}
    unkeyed: list[dict[str, Any]] = []
    for notices in searches:
        for notice in notices:
            key = _notice_key(notice)
            if key is None:
                unkeyed.append(notice)
            else:
                merged.setdefault(key, notice)
    ordered = [*merged.values(), *unkeyed]
    ordered.sort(
        key=lambda notice: (_pick_first_string(notice.get("publication-date")) or "")[:10],
        reverse=True,
    )
    return ordered


def collect_ted_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
) -> list[CollectedSourceDocument]:
    """Read the publication window and deduplicate repeated listings."""
    query_date = _normalize_publication_date(publication_date_from)
    query = f"publication-date >= {query_date}"
    fetch = fetch_json or _default_fetch_json
    notices = _merge_newest_first(_search(fetch, query, page_size=TED_PAGE_SIZE))
    documents: list[CollectedSourceDocument] = []
    for notice in notices[:limit]:
        source_url, payload = _build_notice_payload(notice)
        documents.append(CollectedSourceDocument(source_url=source_url, payload=payload))
    return documents
