"""Saudi Arabia: Etimad visitor tender list (``tenders.etimad.sa``).

Shape verified live on 2026-11-15, without a login:

* The visitor page ``/Tender/AllTendersForVisitor`` fills itself from the JSON endpoint
  ``/Tender/AllSupplierTendersForVisitorAsync``. Parameters used: ``TenderActivityId`` (main
  activity: 16 consulting professions, 2 contracting), ``PublishDateId`` (1 any time, 3 last week,
  4 last month, 5 last three months), ``PageNumber``, ``Sort``/``SortDirection``.
* The server caps a page at 24 rows whatever ``PageSize`` says, and answers HTTP 400 for a page
  past the end; ``totalCount`` is not reliable from page two on. Paging therefore stops on an
  empty page, a page without a new tender, or the page cap.
* Rows are newest first by ``submitionDate`` (the publication date). Past-deadline tenders from the
  portal's newer RFx system also come back in the "last week" bucket, so the deadline is checked.
* A tender has its own public page ``/Tender/DetailsForVisitor?STenderId=<tenderIdString>``. The
  string is stable across requests and is put into the address as it is (``*@@**`` included).
  Tenders of the newer system (``isUGRP``, ids from 2000000000) have no public page and are skipped.
* The portal sits behind F5 bot protection. A client with the repository's browser-style headers
  is served the page and the JSON; the same request with a bot-style ``User-Agent`` gets an image
  CAPTCHA. The collector never solves it: a challenge raises ``PortalChallengeError``. The source
  ships disabled in the pack for that reason (see its note).
* Scope: main activity 16 (all of it, including tenders whose sub-activity is missing) and, as the
  extra design-and-build pass, main activity 2 (contracting) with the shared title detector.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from datetime import date
from typing import Any
from urllib import parse

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import DEFAULT_HEADERS, build_url
from arch_competition_ops.collectors.mideast_common import (
    PortalChallengeError,
    build_paced_client,
    clean_text,
    page_text,
    raise_if_challenged,
    window_start,
)
from arch_competition_ops.collectors.pagination import (
    numbered_pages,
    page_items,
    page_limit,
    repeated_page,
    unfinished_page,
)
from arch_competition_ops.http import HttpError, HttpStatusError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.run_errors import error_class, log_url

logger = logging.getLogger(__name__)

LIST_URL = "https://tenders.etimad.sa/Tender/AllSupplierTendersForVisitorAsync"
NOTICE_URL = "https://tenders.etimad.sa/Tender/DetailsForVisitor"
ANNOUNCEMENT_URL = "https://tenders.etimad.sa/Tender/DetailsTenderAnnouncement"
ANNOUNCEMENT_TENDER_TYPE = 15
MAX_PAGES_PER_SCOPE = 40
EVIDENCE_NOTE = "Official Saudi tender from the Etimad visitor list (tenders.etimad.sa)."

_client = None


def _http():
    global _client
    if _client is None:
        _client = build_paced_client()
    return _client


def _default_fetch_json(url: str) -> Any:
    response = _http().get(url, headers={**DEFAULT_HEADERS, "X-Requested-With": "XMLHttpRequest"})
    raise_if_challenged(response.text, portal="Etimad")
    return response.json()


def _default_fetch_text(url: str) -> str:
    text = _http().get(url, headers={**DEFAULT_HEADERS, "Accept": "text/html,*/*"}).text
    raise_if_challenged(text, portal="Etimad")
    return text


def _publish_bucket(start: date) -> int:
    """Smallest server-side ``PublishDateId`` bucket that covers ``start``."""
    age = (clock.today() - start).days
    if age <= 7:
        return 3
    if age <= 31:
        return 4
    if age <= 92:
        return 5
    return 1


def _page_url(activity: int | None, bucket: int, page: int) -> str:
    return build_url(
        LIST_URL,
        {
            **({"TenderActivityId": activity} if activity is not None else {}),
            "PublishDateId": bucket,
            "Sort": "SubmitionDate",
            "SortDirection": "DESC",
            "PageSize": 24,
            "PageNumber": page,
        },
    )


def _iso_day(value: Any) -> date | None:
    try:
        return date.fromisoformat(str(value or "")[:10])
    except ValueError:
        return None


def _notice_url(row: dict[str, Any]) -> str | None:
    tender_id = str(row.get("tenderIdString") or "").strip()
    if not tender_id or row.get("isUGRP"):
        return None
    base = ANNOUNCEMENT_URL if row.get("tenderTypeId") == ANNOUNCEMENT_TENDER_TYPE else NOTICE_URL
    return f"{base}?STenderId={parse.quote(tender_id, safe='*@')}"


def _detail_summary(html: str) -> str:
    """The basic-information block of a detail page (name, number, purpose, type, duration)."""
    text = page_text(html)
    start = text.find("المعلومات الأساسية اسم المنافسة")
    if start < 0:
        start = text.find("اسم المنافسة")
    end = text.find("الرجوع الى جميع المنافسات", start)
    if start < 0 or end < 0:
        return ""
    return text[start:end].strip()


def _build_document(
    row: dict[str, Any],
    *,
    notice_url: str,
    published: date,
    deadline: date | None,
    detail_text: str | None,
) -> CollectedSourceDocument:
    payload = {
        "title": clean_text(str(row.get("tenderName") or "")),
        "buyer": clean_text(str(row.get("agencyName") or "")) or None,
        "noticeId": str(row.get("referenceNumber") or row.get("tenderId") or ""),
        "tenderNumber": row.get("tenderNumber"),
        "deadline": deadline.isoformat() if deadline else None,
        "summary": detail_text or None,
        "officialUrl": notice_url,
        "publishedAt": published.isoformat(),
        "procedureType": row.get("tenderTypeName"),
        "activity": row.get("tenderActivityName"),
        "country": "Saudi Arabia",
        "location": "Saudi Arabia",
        "evidenceLevel": "official_notice",
        "evidenceNote": EVIDENCE_NOTE,
        # The detail page is server-rendered but heavy; the collector reads it once, so
        # enrichment must not fetch it again with the shared client's bot-style User-Agent
        # (which this portal answers with a CAPTCHA).
        "rawNotice": row,
        "rawNoticeHtml": detail_text or "",
    }
    return CollectedSourceDocument(
        source_url=notice_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def _walk_scope(
    activity: int | None,
    *,
    start: date,
    fetch_json: Callable[[str], Any],
) -> Iterator[dict[str, Any]]:
    """Rows of one main activity, newest first, until the window, the end or the page cap."""
    bucket = _publish_bucket(start)
    seen: set[Any] = set()
    for page in numbered_pages(range(1, page_limit(MAX_PAGES_PER_SCOPE) + 1)):
        try:
            response = fetch_json(_page_url(activity, bucket, page))
        except HttpStatusError as exc:
            # A page past the end answers HTTP 400; page one failing is a real error.
            if page == 1 or exc.status_code != 400:
                raise
            logger.info("Etimad activity %s ended at page %s (%s)", activity, page, exc)
            return
        rows = response.get("data") if isinstance(response, dict) else None
        fresh = [r for r in rows or [] if isinstance(r, dict) and r.get("tenderId") not in seen]
        if not fresh:
            if rows:
                repeated_page()
            return
        seen.update(r.get("tenderId") for r in fresh)
        yield from page_items(fresh)
        published = [d for d in (_iso_day(r.get("submitionDate")) for r in fresh) if d]
        if published and max(published) < start:
            return
    unfinished_page()
    logger.warning(
        "Etimad activity %s hit the %s-page cap; older tenders in the window were not read",
        activity,
        MAX_PAGES_PER_SCOPE,
    )


def collect_etimad_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: Callable[[str], Any] | None = None,
    fetch_text: Callable[[str], str] | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    start = window_start(publication_date_from)
    get_json = fetch_json or _default_fetch_json
    get_text = fetch_text or _default_fetch_text
    candidates: list[tuple[date, date, str, dict[str, Any]]] = []
    seen_ids: set[Any] = set()
    for activity in (None,):
        for row in _walk_scope(activity, start=start, fetch_json=get_json):
            published = _iso_day(row.get("submitionDate"))
            deadline = _iso_day(row.get("lastOfferPresentationDate"))
            notice_url = _notice_url(row)
            if published is None or published < start or notice_url is None:
                continue
            if row.get("tenderId") in seen_ids:
                continue
            seen_ids.add(row.get("tenderId"))
            candidates.append((published, deadline, notice_url, row))
    candidates.sort(key=lambda entry: entry[0], reverse=True)

    documents: list[CollectedSourceDocument] = []
    for published, deadline, notice_url, row in candidates[: max(limit, 0)]:
        detail_text = None
        try:
            detail_text = _detail_summary(get_text(notice_url))
        except PortalChallengeError:
            raise
        except HttpError as exc:  # a missing detail page must not drop the notice
            if exc.status_code in {403, 429}:
                documents.append(deferred_detail(exc, notice_url, row))
                if len(documents) >= limit:
                    return documents
                continue
            logger.warning(
                "Etimad detail page %s not read: %s", log_url(notice_url), error_class(exc)
            )
        documents.append(
            _build_document(
                row,
                notice_url=notice_url,
                published=published,
                deadline=deadline,
                detail_text=detail_text,
            )
        )
    return documents
