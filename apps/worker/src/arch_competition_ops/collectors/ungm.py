"""UN Global Marketplace public procurement notices (``www.ungm.org/Public/Notice``)."""

from __future__ import annotations

import json
import logging
import re
import time
from collections.abc import Callable
from datetime import date, timedelta
from html.parser import HTMLParser
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import DEFAULT_HEADERS, fetch_text_get
from arch_competition_ops.collectors.pagination import (
    numbered_pages,
    page_items,
    page_limit,
    unfinished_page,
)
from arch_competition_ops.http import HttpStatusError, get_default_client
from arch_competition_ops.models import SourceDefinition

logger = logging.getLogger(__name__)

UNGM_NOTICE_LIST_URL = "https://www.ungm.org/Public/Notice"
UNGM_SEARCH_URL = "https://www.ungm.org/Public/Notice/Search"
UNGM_NOTICE_PAGE_URL = "https://www.ungm.org/Public/Notice/{notice_id}"
PAGE_SIZE = 15  # The only size the service accepts.
# 600 rows: far above the design scope of a week (~40) and of a 10-day unscoped read.
MAX_PAGES = 40
DEFAULT_LOOKBACK_DAYS = 7
PAGE_PAUSE_SECONDS = 1.0
# Waits before the second and third attempt at a throttled (HTTP 429) page.
THROTTLE_WAITS_SECONDS = (20.0, 60.0)


_MONTHS = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"),
        start=1,
    )
}
_MONTH_NAMES = tuple(name.capitalize() for name in _MONTHS)
_DATE = re.compile(r"(\d{1,2})-([A-Za-z]{3})-(\d{4})")
_TOKEN = re.compile(
    r'name="__RequestVerificationToken"[^>]*?value="([^"]+)"|'
    r'value="([^"]+)"[^>]*?name="__RequestVerificationToken"'
)

FetchSearch = Callable[[dict[str, Any]], str]


class _NoticeRows(HTMLParser):
    """The ``role="row"`` blocks of a search fragment, each as the list of its cell texts."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[dict[str, Any]] = []
        self._row: dict[str, Any] | None = None
        self._depth = 0
        self._cell_depth = 0
        self._cell: list[str] | None = None
        self._title: list[str] | None = None
        self._ignored = 0  # inside <svg>/<script>/<style>, whose text is not content

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = dict(attrs)
        if tag in {"svg", "script", "style"}:
            self._ignored += 1
        elif tag == "div":
            if self._row is None:
                if values.get("role") == "row" and values.get("data-noticeid"):
                    self._row = {"noticeId": values["data-noticeid"], "cells": [], "title": ""}
                    self._depth = 1
                return
            self._depth += 1
            if values.get("role") == "cell":
                self._cell = []
                self._cell_depth = self._depth
        elif (
            tag == "span" and self._row is not None and "ungm-title" in (values.get("class") or "")
        ):
            self._title = []

    def handle_endtag(self, tag: str) -> None:
        if tag in {"svg", "script", "style"}:
            self._ignored = max(0, self._ignored - 1)
        elif tag == "span" and self._title is not None and self._row is not None:
            self._row["title"] = " ".join(" ".join(self._title).split())
            self._title = None
        elif tag == "div" and self._row is not None:
            if self._cell is not None and self._depth == self._cell_depth:
                self._row["cells"].append(" ".join(" ".join(self._cell).split()))
                self._cell = None
            self._depth -= 1
            if self._depth == 0:
                self.rows.append(self._row)
                self._row = None

    def handle_data(self, data: str) -> None:
        if self._ignored:
            return
        if self._cell is not None:
            self._cell.append(data)
        if self._title is not None:
            self._title.append(data)


def _parse_day(raw_value: str | None) -> date | None:
    """First ``14-Nov-2026`` in the text; the month map avoids locale-dependent ``%b``."""
    match = _DATE.search(raw_value or "")
    if not match or match.group(2).lower() not in _MONTHS:
        return None
    try:
        return date(int(match.group(3)), _MONTHS[match.group(2).lower()], int(match.group(1)))
    except ValueError:
        return None


def _format_day(day: date) -> str:
    return f"{day.day:02d}-{_MONTH_NAMES[day.month - 1]}-{day.year}"


def parse_notice_rows(fragment: str) -> tuple[int, list[dict[str, str | None]]]:
    """The row count of one search page and its notices; a row without eight columns is dropped."""
    parser = _NoticeRows()
    parser.feed(fragment)
    parser.close()
    notices: list[dict[str, str | None]] = []
    for row in parser.rows:
        cells = row["cells"]
        if len(cells) < 8 or not row["title"]:
            logger.warning("UNGM row %s has an unexpected shape; skipped", row["noticeId"])
            continue
        deadline = _parse_day(cells[2])
        published = _parse_day(cells[3])
        notices.append(
            {
                "listingText": "\n".join([row["title"], *cells]),
                "noticeId": row["noticeId"],
                "title": row["title"],
                "deadline": deadline.isoformat() if deadline else None,
                "deadlineText": cells[2] or None,
                "publishedAt": published.isoformat() if published else None,
                "agency": cells[4] or None,
                "noticeType": cells[5] or None,
                "reference": cells[6] or None,
                "country": cells[7] or None,
            }
        )
    return len(parser.rows), notices


def _search_body(page: int, window_start: date) -> dict[str, Any]:
    return {
        "PageIndex": page,
        "PageSize": PAGE_SIZE,
        "Title": "",
        "Description": "",
        "Reference": "",
        "PublishedFrom": _format_day(window_start),
        "PublishedTo": "",
        "DeadlineFrom": "",
        "DeadlineTo": "",
        "Countries": [],
        "Agencies": [],
        "UNSPSCs": [],
        "NoticeTypes": [],
        "SortField": "DatePublished",
        "SortAscending": False,
        "isPicker": False,
        "IsSustainable": False,
        "IsActive": False,
        "NoticeDisplayType": None,
        "NoticeSearchTotalLabelId": "noticeSearchTotal",
        "TypeOfCompetitions": [],
    }


def make_default_fetch_search(
    sleep: Callable[[float], None] = time.sleep,
) -> FetchSearch:
    """Search call that reads the anti-forgery token once, paces itself and waits out HTTP 429.

    The token is read on the first call, so a run that never fetches (an empty source list) makes
    no request. The shared client keeps the cookie that pairs with the token.
    """
    token: str | None = None
    first_call = True

    def fetch(body: dict[str, Any]) -> str:
        nonlocal token, first_call
        if token is None:
            page = fetch_text_get(UNGM_NOTICE_LIST_URL)
            matches = [first or second for first, second in _TOKEN.findall(page)]
            if not matches:
                raise ValueError("UNGM notice page carries no anti-forgery token")
            token = matches[-1]
        if not first_call:
            sleep(PAGE_PAUSE_SECONDS)
        first_call = False
        headers = {
            **DEFAULT_HEADERS,
            "Accept": "text/html, */*",
            "RequestVerificationToken": token,
            "X-Requested-With": "XMLHttpRequest",
        }
        waits = iter(THROTTLE_WAITS_SECONDS)
        while True:
            try:
                return get_default_client().post_text(UNGM_SEARCH_URL, json=body, headers=headers)
            except HttpStatusError as error:
                wait = next(waits, None)
                if error.status_code != 429 or wait is None:
                    raise
                delay = max(wait, float(error.retry_after or 0))
                logger.warning("UNGM throttled the search (HTTP 429); waiting %.0fs", delay)
                sleep(delay)

    return fetch


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from[:10])
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _build_document(notice: dict[str, str | None]) -> CollectedSourceDocument:
    page_url = UNGM_NOTICE_PAGE_URL.format(notice_id=notice["noticeId"])
    payload = {
        "title": notice["title"],
        "buyer": notice["agency"],
        "noticeId": notice["noticeId"],
        "deadline": notice["deadline"],
        "country": notice["country"],
        # The generic listing parser reads ``location``, not ``country``.
        "location": notice["country"],
        "officialUrl": page_url,
        "noticeType": notice["noticeType"],
        "reference": notice["reference"],
        "opportunityType": "public_design_services_procurement",
        "evidenceLevel": "official_notice",
        "evidenceNote": "Official UN Global Marketplace procurement notice (public notice list).",
        "publishedAt": notice["publishedAt"],
        # The notice page is server rendered with the description, so ``rawNoticeHtml`` is left
        # out and AI enrichment reads the page itself.
        "rawNotice": notice["listingText"],
    }
    return CollectedSourceDocument(
        source_url=page_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_ungm_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_search: FetchSearch | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    fetch = fetch_search or make_default_fetch_search()
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []
    seen: set[str] = set()

    for page in numbered_pages(range(page_limit(MAX_PAGES))):
        try:
            fragment = fetch(_search_body(page, window_start))
        except Exception:
            if page == 0:
                raise
            # An error after the first page keeps what was read: the next run covers the window.
            unfinished_page()
            logger.warning("UNGM paging stopped at page %d after an error", page, exc_info=True)
            return documents
        row_count, notices = parse_notice_rows(fragment)

        for notice in page_items(notices):
            published = notice["publishedAt"]
            if published is not None and date.fromisoformat(published) < window_start:
                return documents
            notice_id = str(notice["noticeId"])
            if notice_id in seen:  # new notices shift later pages while a run is paging
                continue
            seen.add(notice_id)
            documents.append(_build_document(notice))
            if len(documents) >= limit:
                return documents

        if row_count < PAGE_SIZE:
            return documents

    unfinished_page()
    logger.warning(
        "UNGM paging stopped after %d pages; notices published since %s may not have been read",
        MAX_PAGES,
        window_start.isoformat(),
    )
    return documents
