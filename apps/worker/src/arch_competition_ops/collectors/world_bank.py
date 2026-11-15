"""World Bank procurement notices (``search.worldbank.org/api/v2/procnotices``).

Shape verified live on 2026-11-15:

* JSON ``{"rows", "os", "page", "total", "procnotices": [...]}``; ``rows`` is the page size (the
  API caps it at 1000) and ``os`` the zero-based offset. ``srt=noticedate&order=desc`` sorts
  newest first (``order=asc`` really reverses it, so the parameters are honoured).
* ``fl=*`` returns every field, including ``agency_name`` (implementing agency),
  ``noticetitle`` and the market approach; the default field list omits them.
* ``noticedate`` is ``DD-Mon-YYYY``; ``submission_deadline_date`` is ISO. About one REOI in ten
  carries a deadline equal to its publication date (time ``00:00``) while the notice text names
  a later one, so a deadline that is not after the publication date is treated as a placeholder.
* There is no CPV. Consulting services are ``procurement_group`` ``CS``; their notice types are
  ``Request for Expression of Interest`` and ``Contract Award`` (plus one 2012 ``Invitation for
  Bids``). Consultant RFPs go to shortlisted firms and are not published as notices.
* Each notice has its own public page,
  ``https://projects.worldbank.org/en/projects-operations/procurement-detail/<id>``; the page is
  a shell whose canonical URL is that address and which loads ``procnotices?id=<id>``.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import date, timedelta
from typing import Any
from urllib import parse

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import build_url, fetch_json_get
from arch_competition_ops.collectors.relevance import (
    has_built_environment_context,
    is_design_relevant,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import strip_html

WORLD_BANK_PROCNOTICES_URL = "https://search.worldbank.org/api/v2/procnotices"
WORLD_BANK_NOTICE_PAGE_URL = (
    "https://projects.worldbank.org/en/projects-operations/procurement-detail/{notice_id}"
)
CONSULTING_SERVICES_GROUP = "CS"
# Notice types that invite consultants to take part. An allow-list on purpose: awards and any
# notice type the World Bank adds later stay out until someone looks at them.
CONSULTING_INVITATION_NOTICE_TYPES = frozenset(
    {
        "Request for Expression of Interest",
        "Invitation for Bids",
        "Invitation for Prequalification",
    }
)
PAGE_SIZE = 100
DEFAULT_LOOKBACK_DAYS = 7
_MONTHS = {
    name: number
    for number, name in enumerate(
        ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"),
        start=1,
    )
}


def _default_fetch_json(url: str) -> Any:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _text(value: Any) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    return None


def _parse_notice_date(raw_value: Any) -> date | None:
    """``14-Nov-2026`` as a date; the month map avoids locale-dependent ``%b`` parsing."""
    text = _text(raw_value)
    if not text:
        return None
    parts = text.split("-")
    if len(parts) != 3 or parts[1].lower() not in _MONTHS:
        return None
    try:
        return date(int(parts[2]), _MONTHS[parts[1].lower()], int(parts[0]))
    except ValueError:
        return None


def _explicit_deadline(notice: dict[str, Any], published: date) -> str | None:
    raw_value = _text(notice.get("submission_deadline_date"))
    if not raw_value:
        return None
    try:
        deadline = date.fromisoformat(raw_value[:10])
    except ValueError:
        return None
    # A deadline on or before the publication date is the placeholder described above.
    return deadline.isoformat() if deadline > published else None


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from[:10])
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _page_url(offset: int) -> str:
    return build_url(
        WORLD_BANK_PROCNOTICES_URL,
        {
            "format": "json",
            "apilang": "en",
            "fl": "*",
            "procurement_group_exact": CONSULTING_SERVICES_GROUP,
            "srt": "noticedate",
            "order": "desc",
            "rows": PAGE_SIZE,
            "os": offset,
        },
    )


def _is_consulting_invitation(notice: dict[str, Any]) -> bool:
    return (
        notice.get("procurement_group") == CONSULTING_SERVICES_GROUP
        and notice.get("notice_type") in CONSULTING_INVITATION_NOTICE_TYPES
    )


def _is_design_notice(title: str, project_name: str | None) -> bool:
    # Negative markers ("workshop", "website") are common in REOI body text, so the gate reads
    # the assignment title and project name only.
    return is_design_relevant(title) and has_built_environment_context(title, project_name)


def _build_document(
    notice: dict[str, Any],
    *,
    notice_id: str,
    title: str,
    published: date,
    include_unclassified: bool,
) -> CollectedSourceDocument:
    page_url = WORLD_BANK_NOTICE_PAGE_URL.format(notice_id=parse.quote(notice_id, safe=""))
    country = _text(notice.get("project_ctry_name"))
    payload = {
        "title": title,
        "buyer": _text(notice.get("agency_name")) or _text(notice.get("contact_organization")),
        "noticeId": notice_id,
        "deadline": _explicit_deadline(notice, published),
        "summary": strip_html(_text(notice.get("notice_text"))),
        "country": country,
        # The generic listing parser reads ``location``, not ``country``.
        "location": country,
        "officialUrl": page_url,
        "noticeType": _text(notice.get("notice_type")),
        "procedureType": _text(notice.get("procurement_method_name")),
        "opportunityType": "public_design_services_procurement",
        "evidenceLevel": "official_notice",
        "evidenceNote": "Official World Bank procurement notice (procnotices API).",
        "publishedAt": published.isoformat(),
        # The notice page is script-rendered from this same record; an empty rawNoticeHtml
        # tells AI enrichment not to fetch the empty shell.
        **({"rawNotice": notice, "rawNoticeHtml": ""} if include_unclassified else {}),
    }
    return CollectedSourceDocument(
        source_url=page_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_world_bank_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: Callable[[str], Any] | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Consulting-services invitations published since ``publication_date_from``, newest first.

    With ``include_unclassified`` every invitation in the window is kept (AI triage decides
    relevance downstream); otherwise an architecture/urban/landscape keyword gate applies.
    """
    fetch = fetch_json or _default_fetch_json
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []
    offset = 0

    while len(documents) < limit:
        response = fetch(_page_url(offset))
        notices = response.get("procnotices") if isinstance(response, dict) else None
        if not isinstance(notices, list) or not notices:
            break

        for notice in notices:
            if not isinstance(notice, dict):
                continue
            published = _parse_notice_date(notice.get("noticedate"))
            if published is None:
                continue
            if published < window_start:
                return documents
            if not _is_consulting_invitation(notice):
                continue
            notice_id = _text(notice.get("id"))
            title = (
                _text(notice.get("noticetitle"))
                or _text(notice.get("bid_description"))
                or _text(notice.get("project_name"))
            )
            if not notice_id or not title:
                continue
            if not include_unclassified and not _is_design_notice(
                title, _text(notice.get("project_name"))
            ):
                continue
            documents.append(
                _build_document(
                    notice,
                    notice_id=notice_id,
                    title=title,
                    published=published,
                    include_unclassified=include_unclassified,
                )
            )
            if len(documents) >= limit:
                return documents

        offset += len(notices)
        total = response.get("total")
        if isinstance(total, int | str) and str(total).isdigit() and offset >= int(total):
            break

    return documents
