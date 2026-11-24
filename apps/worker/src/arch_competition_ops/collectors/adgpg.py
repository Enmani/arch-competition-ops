"""Abu Dhabi Government Procurement Gate (ADGPG) public tender list."""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import fetch_json_get, fetch_text_post
from arch_competition_ops.collectors.pagination import (
    bounded_pages,
    current_pages,
    next_page,
    page_items,
    page_limit,
    page_position,
    unfinished_page,
)
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.run_errors import error_class

logger = logging.getLogger(__name__)

API_BASE = "https://www.adgpg.gov.ae/SCAPI/ADGEs/AlMaqtaa/Tender"
LIST_URL = f"{API_BASE}/List"
DETAIL_URL = f"{API_BASE}/Details/{{tender_id}}?recommendedLimit=0"
NOTICE_PAGE_URL = "https://supplier.adgpg.gov.ae/pages/tender-detail.html?tenderid={tender_id}"
EVIDENCE_NOTE = (
    "Official Abu Dhabi Government Procurement Gate public tender list "
    "(adgpg.gov.ae); tender documents sit behind the supplier login."
)

LIST_PAGE_SIZE = 100
# The open list holds about 100 tenders; a hard cap stops a runaway or looping response.
MAX_LIST_PAGES = 10
DEFAULT_LOOKBACK_DAYS = 7
# The list is newest-created first, so once this many tenders in a row opened before the window
# the rest is older too; one stray old tender does not end the read.
OLDER_STREAK_TO_STOP = 3
# Pause before each detail request; tests inject their own fetchers and never wait.
REQUEST_PAUSE_SECONDS = 0.4


_REQUEST_TYPES = {"RFQ": "Request for Quotation", "RFI": "Request for Information"}

FetchList = Callable[[dict[str, Any]], Any]
FetchDetail = Callable[[int], Any]


def _default_fetch_list(form: dict[str, Any]) -> Any:
    return json.loads(fetch_text_post(LIST_URL, form, headers={"Accept": "application/json"}))


def _default_fetch_detail(tender_id: int) -> Any:
    time.sleep(REQUEST_PAUSE_SECONDS)
    return fetch_json_get(
        DETAIL_URL.format(tender_id=tender_id), headers={"Accept": "application/json"}
    )


def _text(value: Any) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    return None


def _iso_date(value: Any) -> date | None:
    """Date part of an ISO timestamp such as ``2026-11-26T00:00:00Z``."""
    text = _text(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from[:10])
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _split_name(tender_name: str) -> tuple[str | None, str]:
    """``("RFQ", title)`` from ``RFQ-<title>``; other names keep the whole text as the title."""
    prefix, separator, rest = tender_name.partition("-")
    if separator and prefix.strip().upper() in _REQUEST_TYPES and rest.strip():
        return prefix.strip().upper(), rest.strip()
    return None, tender_name


def _value_text(detail: dict[str, Any] | None) -> str | None:
    """The stated estimate, unless it is the ``AED 0 - 0`` placeholder."""
    text = _text((detail or {}).get("EstimatedValue"))
    if text and any(char in "123456789" for char in text):
        return text
    return None


def _build_document(
    row: dict[str, Any],
    detail: dict[str, Any] | None,
    *,
    tender_id: int,
    title: str,
    request_type: str | None,
    summary: str | None,
) -> CollectedSourceDocument:
    page_url = NOTICE_PAGE_URL.format(tender_id=tender_id)
    opened = _iso_date((detail or {}).get("BiddingOpenDate"))
    due = _iso_date(row.get("DueDate"))
    buyer = (_text(row.get("EntityName")) or "").rstrip("- ").strip() or None
    request_type = request_type or _text((detail or {}).get("EventType"))
    payload = {
        "title": title,
        "buyer": buyer,
        "noticeId": _text(row.get("TenderNumber")) or str(tender_id),
        "deadline": due.isoformat() if due else None,
        "summary": summary,
        "officialUrl": page_url,
        "category": _text((detail or {}).get("CategoryDescriptionEn")),
        "noticeType": request_type,
        "procedureType": _REQUEST_TYPES.get(request_type or "", request_type),
        "publishedAt": opened.isoformat() if opened else None,
        "country": "United Arab Emirates",
        "location": "Abu Dhabi",
        "estimatedValueText": _value_text(detail),
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        # The notice page is a script shell over the detail endpoint; the raw record is the
        # whole notice, so an empty rawNoticeHtml tells AI enrichment not to fetch the shell.
        "rawNotice": {"list": row, "detail": detail},
        "rawNoticeHtml": "",
    }
    return CollectedSourceDocument(
        source_url=page_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_adgpg_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_list: FetchList | None = None,
    fetch_detail: FetchDetail | None = None,
) -> list[CollectedSourceDocument]:
    """Read the unfiltered public tender list in publication order."""
    list_page = fetch_list or _default_fetch_list
    read_detail = fetch_detail or _default_fetch_detail
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []
    if limit <= 0:
        return documents
    seen: set[int] = set()
    older_streak = 0
    offset = page_position(0)

    for _ in bounded_pages(range(page_limit(MAX_LIST_PAGES))):
        response = list_page(
            {
                "status": "OPEN",
                "offset": offset,
                "limit": LIST_PAGE_SIZE,
                "Category": "",
                "Entity": "",
                "Sorting": "LAST_CREATED",
                "DueDate": "",
                "Name": "",
            }
        )
        rows = response.get("TenderList") if isinstance(response, dict) else None
        if not isinstance(rows, list) or not rows:
            return documents

        for row in page_items(rows):
            if not isinstance(row, dict):
                continue
            tender_id = row.get("TenderID")
            name = _text(row.get("TenderName"))
            if not isinstance(tender_id, int) or not name or tender_id in seen:
                continue
            seen.add(tender_id)

            try:
                detail_response = read_detail(tender_id)
            except HttpError as exc:
                if exc.status_code in {403, 429}:
                    documents.append(
                        deferred_detail(
                            exc,
                            NOTICE_PAGE_URL.format(tender_id=tender_id),
                            row,
                            detail_url=DETAIL_URL.format(tender_id=tender_id),
                        )
                    )
                    if len(documents) >= limit:
                        return documents
                    continue
                logger.warning("ADGPG detail unreadable, kept from the list: %s", error_class(exc))
                detail_response = None
            detail = (
                detail_response.get("TenderDetails") if isinstance(detail_response, dict) else None
            )
            detail = detail if isinstance(detail, dict) else None

            opened = _iso_date((detail or {}).get("BiddingOpenDate"))
            if opened is not None:
                if opened < window_start:
                    older_streak += 1
                    if older_streak >= OLDER_STREAK_TO_STOP:
                        return documents
                    continue
                older_streak = 0

            request_type, title = _split_name(name)
            summary = strip_html(
                _text((detail or {}).get("TenderDetails")) or _text(row.get("TenderDetails"))
            )
            documents.append(
                _build_document(
                    row,
                    detail,
                    tender_id=tender_id,
                    title=title,
                    request_type=request_type,
                    summary=summary,
                )
            )
            if len(documents) >= limit:
                return documents

        if current_pages() and current_pages().rows >= current_pages().items:
            unfinished_page()
            return documents
        offset += len(rows)
        next_page(offset)
        total = response.get("TenderCount")
        if isinstance(total, int) and offset >= total:
            return documents
    unfinished_page()
    logger.warning(
        "ADGPG open tender list not fully read: stopped at the %d-page cap (offset %d)",
        MAX_LIST_PAGES,
        offset,
    )
    return documents
