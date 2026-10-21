"""Network side of the GGZY collector: listing search, detail pages, original-site probes."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable
from datetime import date, timedelta
from http.client import IncompleteRead
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

from arch_competition_ops.collectors.common import fetch_text_get, fetch_text_post
from arch_competition_ops.collectors.ggzy.html_text import (
    extract_original_category_text,
    normalize_space,
)
from arch_competition_ops.collectors.ggzy.markers import SEARCH_STRATEGIES
from arch_competition_ops.collectors.ggzy.relevance import is_allowed_listing, title_score
from arch_competition_ops.http import HttpError, HttpStatusError, HttpTransportError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string

logger = logging.getLogger(__name__)

LIST_API_URL = "https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList"
BASE_URL = "https://www.ggzy.gov.cn"
LIST_FETCH_ATTEMPTS = 3
DEFAULT_LOOKBACK_DAYS = 45
LISTING_PAGE_SIZE = 20

ListFetcher = Callable[[str, dict[str, Any]], str]
PageFetcher = Callable[[str], str]

# The listing search is a POST, which the shared client never retries on its own (a POST may not
# be idempotent). This endpoint is a read-only search, so retrying it here is safe.
_RETRYABLE_LIST_ERRORS = (TimeoutError, IncompleteRead, HttpTransportError, HttpStatusError)
# Detail/original pages are GETs: the shared client already retried them, so one failure here is
# final and simply degrades the record to listing-level evidence.
_PAGE_FETCH_ERRORS = (HttpError, TimeoutError, OSError)


def default_fetch_list(url: str, data: dict[str, Any]) -> str:
    return fetch_text_post(url, data)


def make_page_fetcher(archive_dir: Path | None) -> PageFetcher:
    """GET fetcher that keeps every raw response under ``archive_dir`` (sha1-named) as evidence."""

    def fetch(url: str) -> str:
        return fetch_text_get(url, archive_dir=archive_dir)

    return fetch


def fetch_list_with_retries(
    url: str,
    data: dict[str, Any],
    *,
    fetch_list: ListFetcher,
    attempts: int = LIST_FETCH_ATTEMPTS,
) -> str:
    for attempt in range(1, attempts + 1):
        try:
            return fetch_list(url, data)
        except _RETRYABLE_LIST_ERRORS as exc:
            if attempt == attempts:
                raise
            logger.warning("GGZY list fetch attempt %d/%d failed: %s", attempt, attempts, exc)
    raise AssertionError("unreachable")  # pragma: no cover


def fetch_page_or_none(url: str, *, fetch_page: PageFetcher) -> str | None:
    try:
        return fetch_page(url)
    except _PAGE_FETCH_ERRORS as exc:
        logger.warning("GGZY page %s could not be fetched: %s", url, exc)
        return None


def fetch_original_category_text(
    official_url: str | None, *, fetch_page: PageFetcher
) -> str | None:
    normalized_url = normalize_space(official_url)
    if not normalized_url:
        return None
    original_html = fetch_page_or_none(normalized_url, fetch_page=fetch_page)
    return extract_original_category_text(original_html) if original_html else None


def detail_url_from_listing(source: SourceDefinition, raw_url: str | None) -> str:
    relative_url = (raw_url or "").strip()
    if not relative_url:
        return source.base_url
    return urljoin(BASE_URL, relative_url.replace("/html/a/", "/html/b/"))


def iter_candidate_rows(
    *,
    publication_date_from: str | None,
    today: date,
    fetch_list: ListFetcher,
) -> list[dict[str, Any]]:
    """Listing rows from every search strategy, de-duplicated and best-title-first."""
    start_date = (
        publication_date_from or (today - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()
    )
    end_date = today.isoformat()
    seen_ids: set[str] = set()
    candidates: list[dict[str, Any]] = []

    for term, page_limit in SEARCH_STRATEGIES:
        for page_number in range(1, page_limit + 1):
            response_text = fetch_list_with_retries(
                LIST_API_URL,
                {
                    "SOURCE_TYPE": "1",
                    "DEAL_TIME": "02",
                    "TIMEBEGIN": start_date,
                    "TIMEEND": end_date,
                    "FINDTXT": term,
                    "PAGENUMBER": str(page_number),
                },
                fetch_list=fetch_list,
            )
            payload = json.loads(response_text)
            records = payload.get("data", {}).get("records", [])
            if not isinstance(records, list):
                break

            for record in records:
                if not isinstance(record, dict):
                    continue
                notice_id = str(record.get("id") or "").strip()
                if not notice_id or notice_id in seen_ids:
                    continue
                if publication_date_from:
                    published_at = parse_date_string(
                        normalize_space(str(record.get("publishTime") or ""))
                    )
                    if published_at and published_at < publication_date_from:
                        continue
                if not is_allowed_listing(record):
                    continue
                seen_ids.add(notice_id)
                candidates.append(record)

            if len(records) < LISTING_PAGE_SIZE:
                break

    candidates.sort(
        key=lambda record: (
            title_score(str(record.get("title") or "")),
            normalize_space(str(record.get("publishTime") or "")) or "",
        ),
        reverse=True,
    )
    return candidates
