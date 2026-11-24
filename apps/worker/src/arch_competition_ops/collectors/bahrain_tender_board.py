"""Bahrain: the Tender Board published tenders (``www.tenderboard.gov.bh``)."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from datetime import date
from html import unescape
from typing import Any
from urllib import parse

from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import DEFAULT_HEADERS
from arch_competition_ops.collectors.mideast_common import (
    build_paced_client,
    clean_text,
    page_text,
    window_start,
)
from arch_competition_ops.collectors.pagination import page_limit, unfinished_page
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition

logger = logging.getLogger(__name__)

SITE = "https://www.tenderboard.gov.bh"
SERVICE_URL = SITE + "/Templates/TenderBoardWebService.aspx/"
MAX_PAGES = 60
DESCRIPTION_CHARS = 3000
EVIDENCE_NOTE = "Official Bahraini tender from the Tender Board published tenders list."

_MONTHS = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"),
        start=1,
    )
}
_ROW_START = re.compile(r"<div data-type='[^']*'[^>]*class=\"rows\">")
_CPV = re.compile(r"(?<!\d)(\d{8})-\d\b")

_client = None


def _http():
    global _client
    if _client is None:
        _client = build_paced_client()
    return _client


def _default_post_json(method: str, payload: dict[str, str]) -> Any:
    response = _http().post(
        SERVICE_URL + method,
        json=payload,
        headers={**DEFAULT_HEADERS, "X-Requested-With": "XMLHttpRequest"},
    )
    return response.json()


def _default_fetch_text(url: str) -> str:
    return _http().get(url, headers={**DEFAULT_HEADERS, "Accept": "text/html,*/*"}).text


def _query(page: int) -> dict[str, str]:
    """The filters the page's own script sends with nothing selected (public tenders, auctions)."""
    return {
        "tenderNumber": "",
        "ministry": "0",
        "category": "0",
        "tendertype": "0",
        "closingDate_filter": "",
        "publicTenderOnly": "true",
        "prequalificationOnly": "false",
        "auctionOnly": "true",
        "sortingType": "0",
        "listPage": "mainList",
        "Page": str(page),
        "smeTendersOnly": "false",
        "sectionName": "",
    }


def _parse_date(value: str | None) -> date | None:
    """``15, Nov,2026`` and ``27 Dec,2026`` as dates."""
    match = re.search(r"(\d{1,2})[ ,]+([A-Za-z]{3,})[ ,]+(\d{4})", value or "")
    if not match or match.group(2)[:3].lower() not in _MONTHS:
        return None
    try:
        return date(int(match.group(3)), _MONTHS[match.group(2)[:3].lower()], int(match.group(1)))
    except ValueError:
        return None


def _cell(block: str, label: str) -> str:
    match = re.search(rf'data-label="{re.escape(label)}">(.*?)</div>', block, flags=re.S)
    return clean_text(match.group(1)) if match else ""


def _parse_rows(fragment: str) -> list[dict[str, Any]]:
    rows = []
    for block in _ROW_START.split(fragment)[1:]:
        link = re.search(r'href="(/TenderDetails/\?id=[^"]+)"', block)
        head = re.search(r'<a href="/TenderDetails/\?id=[^"]+">(.*?)</a>', block, flags=re.S)
        if not link or not head:
            continue
        number = re.search(r"<span>(?:<img[^>]*>)*([^<]*)</span>", head.group(1))
        subject = clean_text(re.sub(r"<span>.*?</span>", " ", head.group(1), flags=re.S))
        path = unescape(link.group(1))
        tender_id = parse.parse_qs(parse.urlsplit(path).query)["id"][0]
        rows.append(
            {
                "listingText": block,
                "tenderId": tender_id,
                # The page's own address, as the list writes it (``%2f`` slashes, ``+`` spaces).
                "url": SITE + path,
                "tenderNumber": unescape(number.group(1)).strip() if number else None,
                "title": subject,
                "prequalification": "pre-qualification.png" in block,
                "issuedBy": _cell(block, "Tender Type") or None,
                "authority": _cell(block, "Purchasing Authority") or None,
                "published": _parse_date(_cell(block, "Publish Date")),
                "closing": _parse_date(_cell(block, "Closing Date")),
            }
        )
    return rows


def _parse_detail(page: str) -> dict[str, Any]:
    text = page_text(page)
    start = text.find("Tender Description")
    end = text.find("Issued by", start)
    description = text[start + len("Tender Description") : end].strip() if 0 <= start < end else ""
    cpv_start = text.find("Classification/CPV Codes")
    cpv_end = text.find("Initial Bond", cpv_start)
    cpv_text = text[cpv_start:cpv_end] if cpv_start >= 0 and cpv_end > cpv_start else ""
    return {
        "description": description[:DESCRIPTION_CHARS],
        "cpv": list(dict.fromkeys(_CPV.findall(cpv_text))),
        "cpvText": cpv_text.replace("Classification/CPV Codes", "").replace("-->", "").strip(),
    }


def _build_document(row: dict[str, Any], detail: dict[str, Any] | None) -> CollectedSourceDocument:
    url = row["url"]
    payload = {
        "title": row["title"],
        "buyer": row["authority"],
        "noticeId": row["tenderId"],
        "tenderNumber": row["tenderNumber"],
        "deadline": row["closing"].isoformat() if row["closing"] else None,
        "summary": (detail or {}).get("description") or None,
        "officialUrl": url,
        "cpv": (detail or {}).get("cpv") or [],
        "publishedAt": row["published"].isoformat(),
        "procedureType": "Pre-qualification" if row["prequalification"] else None,
        "country": "Bahrain",
        "location": "Bahrain",
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        # The detail page is read here and the list row is kept as the raw notice.
        "rawNotice": row["listingText"],
        "rawNoticeHtml": "\n".join(
            filter(None, [(detail or {}).get("description"), (detail or {}).get("cpvText")])
        ),
    }
    return CollectedSourceDocument(source_url=url, payload=json.dumps(payload, ensure_ascii=False))


def collect_bahrain_tender_board_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    post_json: Callable[[str, dict[str, str]], Any] | None = None,
    fetch_text: Callable[[str], str] | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    start = window_start(publication_date_from)
    post = post_json or _default_post_json
    get = fetch_text or _default_fetch_text
    pages = post("GetCurrentPublicTenderPageCount", _query(-1)).get("d") or 0
    if pages > page_limit(MAX_PAGES):
        unfinished_page()
        logger.warning(
            "Bahrain Tender Board lists %s pages; only the first %s are read", pages, MAX_PAGES
        )
    documents: list[CollectedSourceDocument] = []
    seen: set[str] = set()
    for page in range(1, min(int(pages), page_limit(MAX_PAGES)) + 1):
        if len(documents) >= limit:
            break
        rows = _parse_rows(post("GetCurrentPublicTenderByPage", _query(page)).get("d") or "")
        fresh = [row for row in rows if row["tenderId"] not in seen]
        if not fresh:
            if rows:
                unfinished_page()
            break
        seen.update(row["tenderId"] for row in fresh)
        for row in fresh:
            published = row["published"]
            if published is None or published < start:
                continue
            detail = None
            try:
                detail = _parse_detail(get(row["url"]))
            except HttpError as exc:
                if exc.status_code in {403, 429}:
                    documents.append(deferred_detail(exc, row["url"], row["listingText"]))
                    if len(documents) >= limit:
                        return documents
                    continue
                logger.warning("Bahrain tender %s detail not read: %s", row["tenderId"], exc)
            documents.append(_build_document(row, detail))
            if len(documents) >= limit:
                break
        dated = [row["published"] for row in fresh if row["published"]]
        if dated and max(dated) < start:
            break
    return documents
