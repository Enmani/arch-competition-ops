"""Qatar: Ashghal (Public Works Authority) open tenders (``www.ashghal.gov.qa``).

Shape verified live on 2026-11-15, without a login. The site has no ``robots.txt`` (it redirects to
a not-found page). Ashghal tenders are also listed on the Ministry of Finance site
(``collectors.monaqasat``) with a one-line subject; this site has the fuller list, in English.

* ``/en/Tenders/pages/erPTenders.aspx`` is a server-rendered SharePoint page with one grid of the
  open tenders (36 on the day, no paging), a grid of closed ones below it, and rows of tender
  number, type (``ITC``, ``GTC``, ``STC``), title, issuing date, closing date and category. The
  category column was empty on every row; the title is shortened.
* ``/en/Tenders/Pages/ERPTenderDetailes.aspx?TenderID=<id>&Status=Open`` is the public page of one
  tender, with the full title, project id, bond and document fees. The scope of work is in a
  project-brief PDF behind a link.
* ``/en/Tenders/pages/PreqShowAll.aspx?Status=Open&Type=EOI`` and ``...&Type=PQ`` list open
  expressions of interest and prequalifications for consultants and contractors. Both were empty on
  the day, so their row layout is unconfirmed; the same link pattern is read from them and a row
  that does not match is skipped.
* The category column is empty, so AI mode keeps every open tender and leaves the judgment to the
  triage model. Tender documents sit in the Oracle e-tendering system behind a supplier login.
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from datetime import date, datetime
from html import unescape
from urllib import parse

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import DEFAULT_HEADERS
from arch_competition_ops.collectors.mideast_common import (
    build_paced_client,
    clean_text,
    page_text,
    window_start,
)
from arch_competition_ops.collectors.relevance import is_design_relevant
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition

logger = logging.getLogger(__name__)

SITE = "https://www.ashghal.gov.qa"
LISTS = (
    ("Tender", SITE + "/en/Tenders/pages/erPTenders.aspx"),
    ("Expression of interest", SITE + "/en/Tenders/pages/PreqShowAll.aspx?Status=Open&Type=EOI"),
    ("Prequalification", SITE + "/en/Tenders/pages/PreqShowAll.aspx?Status=Open&Type=PQ"),
)
DETAIL_CHARS = 3000
EVIDENCE_NOTE = (
    "Official Qatari tender from the Ashghal (Public Works Authority) open tenders list."
)

_ROW = re.compile(r'<tr class="grid-(?:alt-)?row"[^>]*>(.*?)</tr>', flags=re.S)
_LINK = re.compile(
    r'href="(/en/Tenders/Pages/ERPTenderDetailes\.aspx\?[^"]*Status=Open[^"]*)"', re.I
)

_client = None


def _http():
    global _client
    if _client is None:
        _client = build_paced_client()
    return _client


def _default_fetch_text(url: str) -> str:
    return _http().get(url, headers={**DEFAULT_HEADERS, "Accept": "text/html,*/*"}).text


def _parse_date(value: str) -> date | None:
    try:
        return datetime.strptime(value.strip(), "%d %B %Y").date()
    except ValueError:
        return None


def _parse_rows(page: str, kind: str) -> list[dict]:
    rows = []
    for block in _ROW.findall(page):
        link = _LINK.search(block)
        cells = [clean_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", block, flags=re.S)]
        if not link or len(cells) < 5:
            continue
        path = unescape(link.group(1))
        query = parse.parse_qs(parse.urlsplit(path).query)
        rows.append(
            {
                "tenderNumber": cells[0],
                "tenderType": cells[1] or None,
                "title": cells[2],
                "published": _parse_date(cells[3]),
                "closing": _parse_date(cells[4]),
                "category": cells[5] if len(cells) > 5 and cells[5] else None,
                "tenderId": (query.get("TenderID") or [""])[0],
                "kind": kind,
                "url": SITE + path,
            }
        )
    return rows


def _without_project_id(title: str) -> str:
    """``Roads ... - Project ID: BP 2026 S 030 S`` without its project id suffix."""
    return clean_text(title.split("- Project ID")[0])


def _detail(page: str) -> dict[str, str]:
    """Full title (the list shortens it) and the descriptive block of a detail page."""
    text = page_text(page)
    start = text.find("Tender Print Email")
    end = text.find("Contact Details", start)
    block = text[start + len("Tender Print Email") : end].strip() if 0 <= start < end else ""
    details = re.search(
        r"Tender Details:(.*?)(?:Refer to Tender Project Brief|Document Fees)", block
    )
    return {
        "block": block[:DETAIL_CHARS],
        "title": _without_project_id(details.group(1)) if details else "",
    }


def _build_document(
    row: dict, detail: dict[str, str] | None, *, include_unclassified: bool
) -> CollectedSourceDocument:
    full_title = (detail or {}).get("title")
    payload = {
        "title": full_title or row["title"],
        "buyer": "Public Works Authority (Ashghal)",
        "noticeId": row["tenderNumber"],
        "deadline": row["closing"].isoformat(),
        "summary": (detail or {}).get("block") or None,
        "officialUrl": row["url"],
        "publishedAt": row["published"].isoformat(),
        "procedureType": row["kind"],
        "tenderType": row["tenderType"],
        "country": "Qatar",
        "location": "Qatar",
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        **(
            {
                "rawNotice": {k: str(v) if isinstance(v, date) else v for k, v in row.items()},
                "rawNoticeHtml": (detail or {}).get("block") or "",
            }
            if include_unclassified
            else {}
        ),
    }
    return CollectedSourceDocument(
        source_url=row["url"], payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_ashghal_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: Callable[[str], str] | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Open Ashghal tenders, expressions of interest and prequalifications, newest first.

    A row counts when it was issued on or after ``publication_date_from`` and has not closed. AI
    mode keeps all of them; without it the title must pass the shared design relevance gate.
    """
    start = window_start(publication_date_from)
    today = clock.today()
    get = fetch_text or _default_fetch_text
    rows: list[dict] = []
    seen: set[str] = set()
    for kind, url in LISTS:
        for row in _parse_rows(get(url), kind):
            published, closing = row["published"], row["closing"]
            if published is None or published < start or closing is None or closing < today:
                continue
            if row["url"] in seen:
                continue
            if not include_unclassified and not is_design_relevant(row["title"]):
                continue
            seen.add(row["url"])
            rows.append(row)
    rows.sort(key=lambda row: (row["published"], row["tenderNumber"]), reverse=True)

    documents = []
    for row in rows[: max(limit, 0)]:
        detail = None
        try:
            detail = _detail(get(row["url"]))
        except HttpError as exc:  # the list row alone is still a valid record
            logger.warning("Ashghal tender %s detail not read: %s", row["tenderNumber"], exc)
        documents.append(_build_document(row, detail, include_unclassified=include_unclassified))
    return documents
