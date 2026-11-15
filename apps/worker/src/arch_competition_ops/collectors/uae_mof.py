"""UAE federal tenders: the Ministry of Finance "Current Business Opportunities" list.

The Ministry of Finance (``mof.gov.ae``) publishes every open RFQ of the federal entities that
buy through the federal Digital Procurement Platform on one public WordPress page. No login is
needed and ``mof.gov.ae/robots.txt`` allows everything. Shape verified live on 2026-11-15:

* The page loads its table through ``POST /wp-admin/admin-ajax.php`` with the form fields
  ``action=mof_dpp_fetch``, ``language``, ``page``, ``search``, ``ministry``, ``order`` and
  ``order_by`` (``open-date``, ``close-date``, ``ministry`` or ``rfq``). The answer is an HTML
  fragment of nine tenders per page (about 60 open tenders, seven pages); a page past the end is
  empty.
* Each tender is a ``mof-dpp-list__item`` block: title, RFQ number, entity, an expandable
  description (the title again when there is none), ``Open Date`` and ``Close Date``
  (``dd/mm/yyyy h:mm:ss AM``) and a link to the tender's own page on the federal platform
  (``procurement.gov.ae/page.aspx/en/bpm/process_manage_extranet/<rfq>``).
* There is no category. Titles are in English or Arabic.

``procurement.gov.ae/robots.txt`` disallows everything and its pages are script-rendered behind a
browser check, so the collector never fetches them: the link is only the notice's address
(``rawNoticeHtml`` is ``""`` in AI mode so enrichment does not fetch it either).
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from datetime import date, timedelta
from html import unescape

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import fetch_text_post
from arch_competition_ops.collectors.design_scope import is_design_and_build
from arch_competition_ops.collectors.relevance import is_design_relevant
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import strip_html

logger = logging.getLogger(__name__)

AJAX_URL = "https://mof.gov.ae/wp-admin/admin-ajax.php"
EVIDENCE_NOTE = (
    "Official UAE Ministry of Finance federal tender list (mof.gov.ae, Current Business "
    "Opportunities); the notice itself sits on the federal Digital Procurement Platform."
)
DEFAULT_LOOKBACK_DAYS = 7
# About seven pages of nine tenders are open at any time; the cap only stops a looping response.
MAX_PAGES = 20

FetchPage = Callable[[int], str]

_ITEM_MARKER = '<div class="mof-dpp-list__item">'
_PAGINATION_MARKER = 'class="mof-dpp-pagination"'
_TITLE = re.compile(r'<p class="mof-dpp-list__item__title[^"]*">(.*?)</p>', re.S)
_RFQ_NUMBER = re.compile(r'<p class="">\s*(.*?)\s*</p>', re.S)
_ENTITY = re.compile(r'<span class="mof-button">(.*?)</span>', re.S)
_DESCRIPTION = re.compile(r"<ul[^>]*mof-dpp-list__item__expand\"[^>]*>\s*<li>(.*?)</li>", re.S)
_DATE_FIELD = r'expand__title">{label}</span>\s*<span>(.*?)</span>'
_OPEN_DATE = re.compile(_DATE_FIELD.format(label="Open Date"), re.S)
_CLOSE_DATE = re.compile(_DATE_FIELD.format(label="Close Date"), re.S)
_LINK = re.compile(r'<a [^>]*href="([^"]+)"', re.S)
_ENTITY_CODE_SUFFIX = re.compile(r"\s*-?\s*\(\d+(?:/\d+)+\)\s*$")
_FIELD_DATE = re.compile(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})")


def _default_fetch_page(page: int) -> str:
    return fetch_text_post(
        AJAX_URL,
        {
            "action": "mof_dpp_fetch",
            "language": "en",
            "page": page,
            "search": "",
            "ministry": "",
            "order": "desc",
            "order_by": "open-date",
        },
        headers={"Accept": "text/html, */*"},
    )


def _field(pattern: re.Pattern[str], block: str) -> str | None:
    match = pattern.search(block)
    return strip_html(match.group(1)) if match else None


def _parse_date(value: str | None) -> date | None:
    """Date part of ``dd/mm/yyyy h:mm:ss AM``."""
    match = _FIELD_DATE.match(value or "")
    if not match:
        return None
    day, month, year = (int(group) for group in match.groups())
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _parse_items(html: str) -> list[dict[str, str | None]]:
    """Tenders of one answer fragment, in page order."""
    body = html.split(_PAGINATION_MARKER, 1)[0]
    items: list[dict[str, str | None]] = []
    for block in body.split(_ITEM_MARKER)[1:]:
        link = _LINK.search(block)
        items.append(
            {
                "title": _field(_TITLE, block),
                "rfq": _field(_RFQ_NUMBER, block),
                "entity": _field(_ENTITY, block),
                "description": _field(_DESCRIPTION, block),
                "opened": _field(_OPEN_DATE, block),
                "closes": _field(_CLOSE_DATE, block),
                "link": unescape(link.group(1)).strip() if link else None,
            }
        )
    return items


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from[:10])
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _build_document(
    item: dict[str, str | None],
    *,
    link: str,
    title: str,
    published: date,
    deadline: date | None,
    include_unclassified: bool,
) -> CollectedSourceDocument:
    description = item["description"]
    entity = _ENTITY_CODE_SUFFIX.sub("", item["entity"] or "").strip() or None
    payload = {
        "title": title,
        "buyer": entity,
        "noticeId": item["rfq"],
        "deadline": deadline.isoformat() if deadline else None,
        # The expandable description repeats the title when the tender has no other text.
        "summary": description if description and description != title else None,
        "officialUrl": link,
        "procedureType": "Request for Quotation",
        "publishedAt": published.isoformat(),
        "country": "United Arab Emirates",
        "location": "United Arab Emirates",
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        **({"rawNotice": item, "rawNoticeHtml": ""} if include_unclassified else {}),
    }
    return CollectedSourceDocument(source_url=link, payload=json.dumps(payload, ensure_ascii=False))


def collect_uae_mof_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_page: FetchPage | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Open federal tenders opened since ``publication_date_from``, newest first, at most ``limit``.

    The list is read newest-opened first and ends at the first tender opened before the window.
    Tenders whose close date has passed are dropped. The list has no category, so AI mode keeps
    every open tender for the triage model; otherwise the free-text design gate applies.
    """
    read_page = fetch_page or _default_fetch_page
    window_start = _window_start(publication_date_from)
    today = clock.today()
    documents: list[CollectedSourceDocument] = []
    if limit <= 0:
        return documents
    seen: set[str] = set()

    for page in range(1, MAX_PAGES + 1):
        items = _parse_items(read_page(page))
        if not items:
            return documents
        for item in items:
            published = _parse_date(item["opened"])
            if published is None:
                continue
            if published < window_start:
                return documents
            title, rfq, link = item["title"], item["rfq"], item["link"]
            if not title or not rfq or not link or rfq in seen:
                continue
            seen.add(rfq)
            deadline = _parse_date(item["closes"])
            if deadline is not None and deadline < today:
                continue
            if not include_unclassified and not (
                is_design_relevant(title, item["description"]) or is_design_and_build(title)
            ):
                continue
            documents.append(
                _build_document(
                    item,
                    link=link,
                    title=title,
                    published=published,
                    deadline=deadline,
                    include_unclassified=include_unclassified,
                )
            )
            if len(documents) >= limit:
                return documents
    logger.warning("UAE MoF open tender list not fully read: stopped at the %d-page cap", MAX_PAGES)
    return documents
