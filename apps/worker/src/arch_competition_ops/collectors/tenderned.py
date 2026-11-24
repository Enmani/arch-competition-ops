"""The Dutch national procurement platform TenderNed, via its public publications API (papi)."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from datetime import timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
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

logger = logging.getLogger(__name__)

PAGE_SIZE = 100
# 5,000 rows per query: far above any window read here (a week has about 575 publications in all)
# and inside the API's 10,000-row reach.
MAX_PAGES = 50
AI_DEFAULT_LOOKBACK_DAYS = 7


FetchJson = Callable[[str], dict[str, Any]]


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _list_rows(
    fetch: FetchJson, base_url: str, filters: dict[str, Any], window_from: str
) -> Iterator[dict[str, Any]]:
    """Rows newest first, page by page, until the window, the results or the page cap end."""
    for page in numbered_pages(range(page_limit(MAX_PAGES))):
        list_payload = fetch(
            build_url(
                base_url,
                {"page": page, "size": PAGE_SIZE, "publicatieDatumVanaf": window_from, **filters},
            )
        )
        rows = list_payload.get("content") if isinstance(list_payload, dict) else None
        if not isinstance(rows, list) or not rows:
            return
        for row in page_items(rows):
            if not isinstance(row, dict):
                continue
            published = parse_date_string(str(row.get("publicatieDatum") or ""))
            if published and published < window_from:
                return
            yield row
        if bool(list_payload.get("last")) or len(rows) < PAGE_SIZE:
            return
    unfinished_page()
    logger.warning(
        "TenderNed paging stopped after %d pages; later publications were not read", MAX_PAGES
    )


def _resolve_site_url(publicatie_id: str, raw_url: str | None) -> str:
    if raw_url and raw_url.strip():
        return raw_url.strip()
    return f"https://www.tenderned.nl/aankondigingen/overzicht/{publicatie_id}"


def _resolve_href(href: str | None) -> str | None:
    if not href:
        return None
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return f"https://www.tenderned.nl{href}"


def collect_tenderned_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: FetchJson | None = None,
) -> list[CollectedSourceDocument]:
    lookback_days = AI_DEFAULT_LOOKBACK_DAYS
    window_from = (
        publication_date_from or (clock.today() - timedelta(days=lookback_days)).isoformat()
    )
    documents: list[CollectedSourceDocument] = []
    fetcher = fetch_json or _default_fetch_json
    rows = _list_rows(fetcher, source.base_url, {}, window_from)

    for row in rows:
        if row.get("publicatiestatus", {}).get("code") != "PUB":
            continue

        title = str(row.get("aanbestedingNaam") or "").strip()
        description = str(row.get("opdrachtBeschrijving") or "").strip()
        publication_date = parse_date_string(str(row.get("publicatieDatum") or ""))
        if not title:
            continue

        publicatie_id = str(row.get("publicatieId") or "").strip()
        if not publicatie_id:
            continue

        detail_url = f"{source.base_url}/{publicatie_id}"
        try:
            detail_payload = fetcher(detail_url)
        except HttpError as exc:
            documents.append(deferred_detail(exc, detail_url, row))
            if len(documents) >= limit:
                break
            continue
        cpv_codes = [
            str(code.get("code") or "").split("-")[0].strip()
            for code in detail_payload.get("cpvCodes", [])
            if isinstance(code, dict) and str(code.get("code") or "").strip()
        ]
        title = str(detail_payload.get("aanbestedingNaam") or title).strip()
        description = str(detail_payload.get("opdrachtBeschrijving") or description).strip()

        link_payload = row.get("link") if isinstance(row.get("link"), dict) else {}
        official_url = _resolve_site_url(publicatie_id, link_payload.get("href"))
        links_payload = (
            detail_payload.get("links") if isinstance(detail_payload.get("links"), dict) else {}
        )
        pdf_url = None
        if isinstance(links_payload.get("pdf"), dict):
            pdf_url = _resolve_href(links_payload.get("pdf", {}).get("href"))

        payload = json.dumps(
            {
                "title": title,
                "rawNotice": {"listing": row, "detail": detail_payload},
                "buyer": str(
                    detail_payload.get("opdrachtgeverNaam") or row.get("opdrachtgeverNaam") or ""
                ).strip()
                or None,
                "noticeId": publicatie_id,
                "deadline": parse_date_string(
                    str(detail_payload.get("sluitingsDatum") or row.get("sluitingsDatum") or "")
                ),
                "summary": description,
                "officialUrl": official_url,
                "briefPdfUrl": pdf_url,
                "cpv": cpv_codes,
                "opportunityType": "public_design_services_procurement",
                "procedureType": (
                    detail_payload.get("procedureCode", {}).get("omschrijving")
                    if isinstance(detail_payload.get("procedureCode"), dict)
                    else None
                )
                or (
                    row.get("procedure", {}).get("omschrijving")
                    if isinstance(row.get("procedure"), dict)
                    else None
                ),
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official TenderNed publication and detail API record.",
                "publishedAt": publication_date,
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
        if len(documents) >= limit:
            break

    return documents
