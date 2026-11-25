"""Jordan: the Jordan Online E-Procurement System tender invitations (``www.joneps.gov.jo``).

Shape verified live on 2026-11-15, without a login. The site has no ``robots.txt`` (404).

* ``/ep/invt/selectListTendInvitAL.do`` is the public tender-invitation search. It is a Spring form:
  GET the page for a session cookie and a ``_csrf`` token, then POST the search fields back.
  Fields used: ``searchTendTypeCd1`` (``EP0014`` technical services, ``EP0012`` services,
  ``EP0015`` works), ``searchTendTypeCd2`` (``EP0218`` consulting and studies under services),
  ``searchStartPublicationYmd`` / ``searchEndPublicationYmd`` and ``searchStartSubmDlineDt`` /
  ``searchEndSubmDlineDt`` (all ``DD/MM/YYYY``), ``currentPageNo``, ``offSet`` and
  ``recordCountPerPage`` (20 a page here). The status filter ``searchTendStatusCd=Opened`` means
  "bids opened", not "open for bids", and returns nothing for a current tender, so it is not used.
* The technical-services type is design (``EP1123``) and supervision (``EP1124``) of buildings and
  infrastructure by consultants, which makes it the portal's own design category.
* A row carries the tender number and sequence, subject, procuring entity, type, publication date
  and closing date. The page links to a detail form that is POSTed; the same detail pages answer a
  plain GET at ``/ep/invt/WorkDetails.do`` (and ``ServiceDetails.do``, ``GoodsDetails.do``...) with
  the tender number in the query, which is the notice address used here. The detail pages load most
  of their fields by script, so the list row is the evidence.
* Scope: all technical-services tenders, services tenders of the consulting-and-studies sub-type,
  and from works only design-and-build contracts (shared title detector).
"""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable
from datetime import date
from typing import Any
from urllib import parse

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import DEFAULT_HEADERS
from arch_competition_ops.collectors.mideast_common import (
    build_paced_client,
    clean_text,
    parse_dmy,
    window_start,
)
from arch_competition_ops.collectors.pagination import (
    numbered_pages,
    page_items,
    page_limit,
    repeated_page,
    unfinished_page,
    window_end,
)
from arch_competition_ops.models import SourceDefinition

logger = logging.getLogger(__name__)

SITE = "https://www.joneps.gov.jo"
LIST_URL = (
    SITE + "/ep/invt/selectListTendInvitAL.do"
    "?menuId=EP03000000&upperMenuId=EP03010000&subMenuId=EP03010100&noneMn=Y"
)
PAGE_SIZE = 20
MAX_PAGES = 30
SERVICES = "EP0012"
WORKS = "EP0015"
PROCEDURE_NAMES = {
    "EP0021": "Public tender",
    "EP0022": "Prequalification",
    "EP5021": "Expression of interest",
    "EP0025": "Limited tender",
    "EP0026": "Limited tender (two envelopes)",
    "EP0023": "Prequalification (two envelopes)",
    "EP0024": "Public tender (two envelopes)",
    "EP1122": "Individual consultants",
    "EP0027": "Single source",
}
EVIDENCE_NOTE = "Official Jordanian tender invitation from JONEPS (www.joneps.gov.jo)."

_DETAIL_ARGS = re.compile(r"fn_goDetail\(\s*((?:'[^']*'\s*,?\s*){8})\)")
_ROW = re.compile(r"<tr[^>]*>(?:(?!</tr>).)*?fn_goDetail\((?:(?!</tr>).)*?</tr>", flags=re.S)
_CSRF = re.compile(r'name="_csrf"\s+value="([^"]+)"')


class _Session:
    """One cookie jar and CSRF token for a run of searches."""

    def __init__(self) -> None:
        self._client = build_paced_client()
        self._csrf: str | None = None

    def _open(self) -> None:
        page = self._client.get(LIST_URL, headers={**DEFAULT_HEADERS, "Accept": "text/html,*/*"})
        match = _CSRF.search(page.text)
        if not match:
            raise RuntimeError("JONEPS tender search page carries no CSRF token")
        self._csrf = match.group(1)

    def search(self, fields: dict[str, str]) -> str:
        for _ in range(2):
            if self._csrf is None:
                self._open()
            response = self._client.post(
                LIST_URL,
                data={"_csrf": self._csrf, **fields},
                headers={**DEFAULT_HEADERS, "Accept": "text/html,*/*", "Referer": LIST_URL},
            )
            token = _CSRF.search(response.text)
            if token:
                self._csrf = token.group(1)
                return response.text
            self._csrf = None  # the session expired: open a new one once
        raise RuntimeError("JONEPS search page answered twice without a CSRF token")


def _search_fields(
    tender_type: str, sub_type: str | None, *, start: date, today: date, page: int
) -> dict[str, str]:
    day = "%d/%m/%Y"
    return {
        "searchTendTypeCd1": tender_type,
        "searchTendTypeCd2": sub_type or "",
        "searchStartPublicationYmd": start.strftime(day),
        "searchEndPublicationYmd": today.strftime(day),
        "searchStartSubmDlineDt": "",
        "searchEndSubmDlineDt": "",
        "searchTendStatusCd": "",
        "recordCountPerPage": str(PAGE_SIZE),
        "currentPageNo": str(page),
        "offSet": str((page - 1) * PAGE_SIZE),
    }


def _detail_path(category: str, method: str, tender_type: str) -> str:
    """The detail page the portal's own ``fn_goDetail`` script opens for a row."""
    if category == "EP1311" and method not in {"EP0022", "EP5021"}:
        return (
            "/ep/invt/GoodsDetails.do" if tender_type == "EP0011" else "/ep/invt/ServiceDetails.do"
        )
    if category == "EP1312" or method in {"EP0022", "EP5021"}:
        return "/ep/invt/WorkDetails.do"
    if category == "EP1313":
        return "/ep/invt/MedicineDetails.do"
    return "/ep/invt/WorkUnspscDetails.do"


def _parse_rows(page: str) -> list[dict[str, Any]]:
    rows = []
    for block in _ROW.findall(page):
        args = _DETAIL_ARGS.search(block)
        cells = [clean_text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", block, flags=re.S)]
        if not args or len(cells) < 6:
            continue
        number, sequence, framework, category, _work, local, method, tender_type = (
            value.strip(" '") for value in re.findall(r"'[^']*'", args.group(1))
        )
        query = parse.urlencode(
            {
                "tendNo": number,
                "tendSeq": sequence,
                "frameworkAgreementSeq": framework,
                "tendCategCd": category,
                "workType": "",
                "intrlLocalTypeCd": local,
                "tendMthodCd": method,
                "invtYn": "Y",
            }
        )
        rows.append(
            {
                "listingText": block,
                "tenderNo": number,
                "tenderSeq": sequence,
                "title": cells[1],
                "buyer": cells[2] or None,
                "typeName": cells[3],
                "tenderType": tender_type,
                "method": method,
                "published": parse_dmy(cells[4]),
                "closing": parse_dmy(cells[5]),
                "url": SITE + _detail_path(category, method, tender_type) + "?" + query,
            }
        )
    return rows


def _build_document(row: dict[str, Any]) -> CollectedSourceDocument:
    payload = {
        "title": row["title"],
        "buyer": row["buyer"],
        "noticeId": row["tenderNo"],
        "tenderSequence": row["tenderSeq"],
        "deadline": row["closing"].isoformat() if row["closing"] else None,
        "officialUrl": row["url"],
        "publishedAt": row["published"].isoformat(),
        "procedureType": PROCEDURE_NAMES.get(row["method"], row["method"]),
        "tenderType": row["typeName"],
        "country": "Jordan",
        "location": "Jordan",
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        # The detail page is filled by script; the list row is the whole evidence.
        "rawNotice": row["listingText"],
        "rawNoticeHtml": "",
    }
    return CollectedSourceDocument(
        source_url=row["url"], payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_joneps_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    search: Callable[[dict[str, str]], str] | None = None,
) -> list[CollectedSourceDocument]:
    """Open Jordanian tender invitations of the design-relevant types, newest first.

    One search per scope (see ``SCOPES``), each paged until a short page, a page without a new
    tender or the page cap. One document per tender number: a re-issued tender keeps its newest
    sequence.
    """
    start = window_start(publication_date_from)
    today = window_end(clock.today())
    run_search = search or _Session().search
    kept: list[dict[str, Any]] = []
    seen_numbers: set[str] = set()
    for tender_type, sub_type in (("", None),):
        seen_rows: set[str] = set()
        for page in numbered_pages(range(1, page_limit(MAX_PAGES) + 1)):
            rows = _parse_rows(
                run_search(
                    _search_fields(tender_type, sub_type, start=start, today=today, page=page)
                )
            )
            fresh = [row for row in rows if row["url"] not in seen_rows]
            seen_rows.update(row["url"] for row in fresh)
            for row in page_items(fresh):
                published = row["published"]
                if published is None or published < start:
                    continue
                if row["tenderNo"] in seen_numbers:
                    continue
                seen_numbers.add(row["tenderNo"])
                kept.append(row)
            if rows and not fresh:
                repeated_page()
            if len(rows) < PAGE_SIZE or not fresh:
                break
        else:
            unfinished_page()
            logger.warning("JONEPS %s search hit the %s-page cap", tender_type, MAX_PAGES)
    kept.sort(key=lambda row: (row["published"], row["tenderNo"]), reverse=True)
    return [_build_document(row) for row in kept[: max(limit, 0)]]
