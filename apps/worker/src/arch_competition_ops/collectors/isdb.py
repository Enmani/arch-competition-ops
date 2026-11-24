"""Islamic Development Bank project procurement tenders (``www.isdb.org/project-procurement``).

The IsDB's own procurement site, no login. Shape verified live on 2026-11-15:

* ``/project-procurement/tenders?status=active&page=N`` is a Drupal listing of about 120 tenders
  over three pages (page past the last answers an empty list), sorted by closing date, oldest
  first. ``status=active`` does not drop old notices: the 2025 ones that already closed are still
  listed and carry the status ``Closed``, so the status badge of each row is what counts.
* A row is an ``<article>`` with the notice path (``about``), the title, a status badge, a type
  badge (``eoi``, ``spn``, ``spn-cw``, ``pqn``, ``gpn``, ``oth``, ``contract-award`` as the slug),
  the country and the closing date (``24 August 2025``). The list carries no publication date and
  no description; the notice page (server rendered) has the issue date, documents and text.
* Notices are goods, works and consulting for IsDB-financed projects in member countries (about
  two new ones a week) and the Bank's own consultancies (``BCC<year>-<n>``). Few concern design.
* Terms (``/terms-conditions``) allow personal use and limited extracts with the source cited;
  nothing forbids automated reading and ``robots.txt`` allows the section.

There is no publication date to window on, so ``publication_date_from`` cannot be honoured: the
whole open list is read each run (three requests) and the notice ledger drops what was already
screened. The open list is one page set, so ``limit`` simply caps it.
"""

from __future__ import annotations

import html
import json
import logging
import re
from collections.abc import Callable
from datetime import date
from urllib import parse

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import build_url, fetch_text_get
from arch_competition_ops.collectors.pagination import page_limit, unfinished_page
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import strip_html

logger = logging.getLogger(__name__)

ISDB_SITE_URL = "https://www.isdb.org"
ISDB_TENDERS_URL = "https://www.isdb.org/project-procurement/tenders"
# Far above the three pages of the live list; a runaway listing stops here with a warning.
MAX_PAGES = 10
_MONTHS = {
    name: number
    for number, name in enumerate(
        (
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ),
        start=1,
    )
}

# French notices put ``lang`` before ``about`` and use ``/project-procurement/node/<id>`` paths, so
# the attributes are read one by one rather than in a fixed order.
_ARTICLE = re.compile(r"<article(\s[^>]*)>(.*?)</article>", re.S)
_ABOUT = re.compile(r'\sabout="([^"]+)"')
_NODE_ID = re.compile(r'\sdata-nid="(\d+)"')
_TITLE = re.compile(r"<h2><a [^>]*>(.*?)</a>", re.S)
_STATUS = re.compile(r"vocabulary-tender-status slug-([\w-]+)")
_TYPE = re.compile(r"vocabulary-tender-type slug-([\w-]+)[^>]*>\s*(.*?)\s*<", re.S)
_COUNTRY = re.compile(r"field--name-field-world-country[^>]*>\s*(.*?)\s*<", re.S)
_CLOSE = re.compile(r"<time[^>]*>\s*(\d{1,2} [A-Za-z]+ \d{4})\s*</time>")

FetchText = Callable[[str], str]


def _clean(value: str) -> str:
    return " ".join(html.unescape(strip_html(value) or "").split())


def _parse_close_date(raw_value: str | None) -> date | None:
    parts = (raw_value or "").split()
    if len(parts) != 3 or parts[1].lower() not in _MONTHS or not parts[0].isdigit():
        return None
    try:
        return date(int(parts[2]), _MONTHS[parts[1].lower()], int(parts[0]))
    except ValueError:
        return None


def parse_tender_list(page: str) -> list[dict[str, str | None]]:
    """The tenders of one listing page, in page order."""
    tenders: list[dict[str, str | None]] = []
    for match in _ARTICLE.finditer(page):
        attributes, block = match.groups()
        if "type-tender" not in attributes:
            continue  # the page's own heading article, not a listing row
        about = _ABOUT.search(attributes)
        node_id = _NODE_ID.search(attributes)
        title = _TITLE.search(block)
        status = _STATUS.search(block)
        notice_type = _TYPE.search(block)
        country = _COUNTRY.search(block)
        close = _CLOSE.search(block)
        closing = _parse_close_date(close.group(1) if close else None)
        if not about or not node_id or not title or not status:
            logger.warning("IsDB row %s has an unexpected shape; skipped", attributes[:120])
            continue
        tenders.append(
            {
                "path": about.group(1),
                "nodeId": node_id.group(1),
                "title": _clean(title.group(1)),
                "status": status.group(1),
                "typeSlug": notice_type.group(1) if notice_type else None,
                "noticeType": _clean(notice_type.group(2)) if notice_type else None,
                "country": _clean(country.group(1)) if country else None,
                "closeDate": closing.isoformat() if closing else None,
            }
        )
    return tenders


def _submission_deadline(tender: dict[str, str | None]) -> str | None:
    # A general procurement notice announces a coming call: its close date is when the notice
    # lapses (years ahead in the live list), not a submission deadline.
    return None if tender["typeSlug"] == "gpn" else tender["closeDate"]


def _build_document(tender: dict[str, str | None]) -> CollectedSourceDocument:
    page_url = parse.urljoin(ISDB_SITE_URL, str(tender["path"]))
    payload = {
        "title": tender["title"],
        "noticeId": tender["nodeId"],
        "deadline": _submission_deadline(tender),
        "country": tender["country"],
        # The generic listing parser reads ``location``, not ``country``.
        "location": tender["country"],
        "officialUrl": page_url,
        "noticeType": tender["noticeType"],
        "opportunityType": "public_design_services_procurement",
        "evidenceLevel": "official_notice",
        "evidenceNote": "Official Islamic Development Bank project procurement notice.",
        # The notice page is server rendered with the issue date and documents, so
        # ``rawNoticeHtml`` is left out and AI enrichment reads the page itself.
        "rawNotice": tender,
    }
    return CollectedSourceDocument(
        source_url=page_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_isdb_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: FetchText | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    fetch = fetch_text or fetch_text_get

    documents: list[CollectedSourceDocument] = []
    seen: set[str] = set()

    for page_index in range(page_limit(MAX_PAGES)):
        page = fetch(build_url(ISDB_TENDERS_URL, {"status": "active", "page": page_index}))
        tenders = parse_tender_list(page)
        if not tenders:
            return documents
        for tender in tenders:
            path = str(tender["path"])
            if path in seen:
                continue
            seen.add(path)
            documents.append(_build_document(tender))
            if len(documents) >= limit:
                return documents

    unfinished_page()
    logger.warning("IsDB paging stopped after %d pages; later tenders were not read", MAX_PAGES)
    return documents
