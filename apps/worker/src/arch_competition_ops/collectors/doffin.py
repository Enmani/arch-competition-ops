"""Norway's national notice database, Doffin (doffin.no), via its public search and detail APIs."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from datetime import timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import (
    fetch_json_get,
    fetch_json_post,
)
from arch_competition_ops.collectors.pagination import (
    numbered_pages,
    page_items,
    page_limit,
    unfinished_page,
)
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.money import format_money_text

logger = logging.getLogger(__name__)

DETAIL_URL = "https://api.doffin.no/webclient/api/v2/notices-api/notices/{notice_id}"
PAGE_SIZE = 100
# Ten pages of 100 reach every hit the API serves for one query (``numHitsAccessible`` = 1,000).
MAX_PAGES = 10
AI_DEFAULT_LOOKBACK_DAYS = 7


FetchSearch = Callable[[str, dict[str, Any]], dict[str, Any]]


def _default_fetch_search_json(url: str, body: dict) -> dict:
    return fetch_json_post(url, body, headers={"Accept": "application/json"})


def _default_fetch_detail_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _build_search_body(
    page: int,
    *,
    window_from: str | None,
) -> dict:
    scope = {
        "cpvCodesId": {"checkedItems": []},
        "type": {"checkedItems": []},
        # Status is checked per hit: prior-information notices have no status at all.
        "status": {"checkedItems": []},
        "contractNature": {"checkedItems": []},
    }
    return {
        "numHitsPerPage": PAGE_SIZE,
        "page": page,
        "searchString": "",
        "sortBy": "PUBLICATION_DATE_DESC",
        "facets": {
            "cpvCodesLabel": {"checkedItems": []},
            **scope,
            "procurementStrategicLabels": {"checkedItems": []},
            "publicationDate": {"from": window_from, "to": None},
            "location": {"checkedItems": []},
            "buyer": {"checkedItems": []},
            "winner": {"checkedItems": []},
        },
    }


def _search_hits(
    fetch: FetchSearch,
    url: str,
    *,
    window_from: str | None,
) -> Iterator[dict[str, Any]]:
    """Hits newest first, page by page, until the window, the results or the page cap end."""
    for page in numbered_pages(range(1, page_limit(MAX_PAGES) + 1)):
        body = _build_search_body(
            page,
            window_from=window_from,
        )
        response = fetch(url, body)
        hits = response.get("hits") if isinstance(response, dict) else None
        if not isinstance(hits, list) or not hits:
            return
        if page == 1:
            total, accessible = response.get("numHitsTotal"), response.get("numHitsAccessible")
            if isinstance(total, int) and isinstance(accessible, int) and total > accessible:
                unfinished_page()
                logger.warning(
                    "Doffin search matched %d notices but serves only %d; later ones are not read",
                    total,
                    accessible,
                )
        for hit in page_items(hits):
            if not isinstance(hit, dict):
                continue
            published = parse_date_string(str(hit.get("publicationDate") or ""))
            if window_from and published and published < window_from:
                return
            yield hit
        if len(hits) < PAGE_SIZE:
            return
    unfinished_page()
    logger.warning("Doffin paging stopped after %d pages; later notices were not read", MAX_PAGES)


def _pick_buyer_name(payload: dict, fallback: dict) -> str | None:
    for candidate in (payload.get("buyer"), fallback.get("buyer")):
        if not isinstance(candidate, list) or not candidate:
            continue
        first = candidate[0]
        if isinstance(first, dict):
            name = str(first.get("name") or "").strip()
            if name:
                return name
    return None


def _pick_estimated_value(detail_payload: dict) -> tuple[float | None, str | None]:
    core = detail_payload.get("core")
    if not isinstance(core, dict):
        return None, None

    estimated_value = core.get("estimatedValue")
    if not isinstance(estimated_value, dict):
        return None, None

    amount = estimated_value.get("amount")
    currency = str(estimated_value.get("code") or "").strip().upper() or None
    value_text = format_money_text(
        amount=amount,
        currency=currency,
        raw_text=estimated_value.get("fullLocalizedText"),
    )
    if currency == "EUR" and amount is not None:
        return float(amount), value_text
    return None, value_text


def collect_doffin_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_search_json: FetchSearch | None = None,
    fetch_detail_json: Callable[[str], dict[str, Any]] | None = None,
) -> list[CollectedSourceDocument]:
    window_from = publication_date_from or (
        (clock.today() - timedelta(days=AI_DEFAULT_LOOKBACK_DAYS)).isoformat()
    )
    fetch_detail = fetch_detail_json or _default_fetch_detail_json
    documents: list[CollectedSourceDocument] = []

    fetch_search = fetch_search_json or _default_fetch_search_json
    hits = _search_hits(fetch_search, source.base_url, window_from=window_from)
    for hit in hits:
        notice_id = str(hit.get("id") or "").strip()
        if not notice_id:
            continue

        detail_url = DETAIL_URL.format(notice_id=notice_id)
        try:
            detail_payload = fetch_detail(detail_url)
        except HttpError as exc:
            documents.append(deferred_detail(exc, detail_url, hit))
            if len(documents) >= limit:
                break
            continue
        title = str(detail_payload.get("heading") or hit.get("heading") or "").strip()
        description = str(detail_payload.get("description") or hit.get("description") or "").strip()
        publication_date = parse_date_string(
            str(detail_payload.get("publicationDate") or hit.get("publicationDate") or "")
        )
        cpv_codes = [
            str(code).strip() for code in detail_payload.get("allCpvCodes", []) if str(code).strip()
        ]

        page_url = f"https://www.doffin.no/notices/{notice_id}"
        estimated_value_eur, estimated_value_text = _pick_estimated_value(detail_payload)
        payload = json.dumps(
            {
                "title": title,
                "rawNotice": {"listing": hit, "detail": detail_payload},
                "buyer": _pick_buyer_name(detail_payload, hit),
                "noticeId": notice_id,
                "deadline": parse_date_string(
                    str(detail_payload.get("deadline") or hit.get("deadline") or "")
                ),
                "estimatedValueEur": estimated_value_eur,
                "estimatedValueText": estimated_value_text,
                "summary": description,
                "officialUrl": page_url,
                "cpv": cpv_codes,
                "opportunityType": "public_design_services_procurement",
                "procedureType": detail_payload.get("noticeType") or hit.get("type"),
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official Doffin search and notice-detail API record.",
                "publishedAt": publication_date,
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
        if len(documents) >= limit:
            break

    return documents
