"""Abu Dhabi Government Procurement Gate (ADGPG) public tender list.

The public "Tenders" page of the gate (``supplier.adgpg.gov.ae/pages/tender-list.html``) is a
script page over three JSON endpoints that need no login, no cookie and no token. Shape verified
live on 2026-11-15:

* ``POST https://www.adgpg.gov.ae/SCAPI/ADGEs/AlMaqtaa/Tender/List`` takes a form body
  (``status``, ``offset``, ``limit``, ``Category``, ``Entity``, ``Sorting``, ``DueDate``,
  ``Name``) and answers ``{"TenderList": [...], "TenderCount": n}``. ``limit`` up to 100 is
  honoured (the page itself asks for 10); ``status=OPEN`` lists only tenders that still accept
  bids, ``Sorting=LAST_CREATED`` is newest first. A list row has ``TenderID``, ``TenderName``
  (``RFQ-`` or ``RFI-`` plus the title), ``TenderNumber``, ``EntityName``, ``DueDate`` and the
  start of ``TenderDetails``. It carries no category and no opening date.
* ``GET .../Tender/Details/<TenderID>`` adds ``BiddingOpenDate``, ``EventType``, the UNSPSC
  ``categoryId`` / ``CategoryDescriptionEn`` and ``Attachments`` (always empty for public
  tenders; documents sit behind the supplier login).
* The ``Category`` filter drops tenders without a category (about one in six) and the category
  is often a loose fit (a conservation survey filed under travel and food services), so this
  collector reads the whole open list (about 100 tenders) and judges the category itself.

Each tender has its own public page, ``/pages/tender-detail.html?tenderid=<TenderID>`` on the
supplier site, a script shell that loads the same detail endpoint; the collector therefore sets
``rawNoticeHtml`` to ``""`` in AI mode so enrichment does not fetch the empty shell.

``www.adgpg.gov.ae/robots.txt`` disallows only ``/sitecore``. The Terms of Use bar excessive
downloads that harm the service and reuse of the gate's logo and content without consent, so the
default detail fetcher pauses between requests and the facts are stored with a link back.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import fetch_json_get, fetch_text_post
from arch_competition_ops.collectors.design_scope import is_design_and_build
from arch_competition_ops.collectors.relevance import is_design_relevant
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import strip_html

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

# UNSPSC segments below 70 are products (food, machinery, IT hardware, furniture, medical
# supplies...); 70 and above are services, works and land. Segment 72 is building construction
# and maintenance, the works category.
FIRST_SERVICE_SEGMENT = 70
WORKS_SEGMENT = 72

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


def _segments(detail: dict[str, Any] | None) -> list[int]:
    """UNSPSC segment numbers (first two digits) of the tender's categories."""
    segments: list[int] = []
    for raw in (detail or {}).get("categoryId") or []:
        digits = str(raw).strip()
        if len(digits) >= 2 and digits[:2].isdigit() and int(digits[:2]) not in segments:
            segments.append(int(digits[:2]))
    return segments


def _in_category_scope(
    segments: list[int], title: str, summary: str | None, *, include_unclassified: bool
) -> bool:
    """Design scope on the structured category.

    No category is unknown, not out of scope. Products are out. A works-only category (building
    construction and maintenance) is in only for an integrated design-and-build contract; any
    other service category is in. Without AI mode the free-text design gate decides on top.
    """
    if segments:
        if all(segment < FIRST_SERVICE_SEGMENT for segment in segments):
            return False
        if all(segment == WORKS_SEGMENT for segment in segments) and not is_design_and_build(
            title, summary
        ):
            return False
    if include_unclassified:
        return True
    return is_design_relevant(title, summary) or is_design_and_build(title, summary)


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
    include_unclassified: bool,
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
        **(
            {"rawNotice": {"list": row, "detail": detail}, "rawNoticeHtml": ""}
            if include_unclassified
            else {}
        ),
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
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Open ADGPG tenders opened since ``publication_date_from``, newest first, at most ``limit``.

    Pages the open list (``MAX_LIST_PAGES`` pages at most, warning when the cap cuts a longer
    list) and reads each tender's detail for its category and opening date. Tenders whose bid
    deadline has passed, whose category is a product, or (works-only) that are not design-and-
    build are dropped; a tender without a category or whose detail cannot be read is kept.
    """
    list_page = fetch_list or _default_fetch_list
    read_detail = fetch_detail or _default_fetch_detail
    window_start = _window_start(publication_date_from)
    today = clock.today()
    documents: list[CollectedSourceDocument] = []
    if limit <= 0:
        return documents
    seen: set[int] = set()
    older_streak = 0
    offset = 0

    for _ in range(MAX_LIST_PAGES):
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

        for row in rows:
            if not isinstance(row, dict):
                continue
            tender_id = row.get("TenderID")
            name = _text(row.get("TenderName"))
            if not isinstance(tender_id, int) or not name or tender_id in seen:
                continue
            seen.add(tender_id)
            due = _iso_date(row.get("DueDate"))
            if due is not None and due < today:
                continue

            try:
                detail_response = read_detail(tender_id)
            except HttpError as exc:
                logger.warning(
                    "ADGPG tender %s detail unreadable, kept from the list: %s", tender_id, exc
                )
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
            if not _in_category_scope(
                _segments(detail), title, summary, include_unclassified=include_unclassified
            ):
                continue
            documents.append(
                _build_document(
                    row,
                    detail,
                    tender_id=tender_id,
                    title=title,
                    request_type=request_type,
                    summary=summary,
                    include_unclassified=include_unclassified,
                )
            )
            if len(documents) >= limit:
                return documents

        offset += len(rows)
        total = response.get("TenderCount")
        if isinstance(total, int) and offset >= total:
            return documents
    logger.warning(
        "ADGPG open tender list not fully read: stopped at the %d-page cap (offset %d)",
        MAX_LIST_PAGES,
        offset,
    )
    return documents
