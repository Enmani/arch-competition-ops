"""simap.ch, the Swiss public procurement platform (public publication API)."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
    pick_localized_text,
)
from arch_competition_ops.collectors.pagination import (
    bounded_pages,
    current_pages,
    next_page,
    page_items,
    page_limit,
    page_position,
    unfinished_page,
)
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.text import extract_cpv_codes, strip_html

logger = logging.getLogger(__name__)

SIMAP_PROJECT_SEARCH_URL = "https://www.simap.ch/api/publications/v2/project/project-search"
SIMAP_PUBLICATION_DETAIL_URL = "https://www.simap.ch/api/publications/v1/project/{project_id}/publication-details/{publication_id}"
SIMAP_PROJECT_DETAIL_URL = "https://www.simap.ch/de/project-detail/{project_id}"
DEFAULT_LOOKBACK_DAYS = 7
# Pages hold 20 projects. A 2026-11 week had 537 projects of every type and 33 in the AI scope.
SIMAP_MAX_PAGES = 100

FetchJson = Callable[[str], Any]


def _default_fetch_json(url: str) -> Any:
    return fetch_json_get(url, headers={"Accept": "application/json", "User-Agent": "Mozilla/5.0"})


def _build_simap_project_detail_url(project_id: str) -> str | None:
    cleaned_project_id = project_id.strip()
    if not cleaned_project_id:
        return None
    return SIMAP_PROJECT_DETAIL_URL.format(project_id=cleaned_project_id)


def _pick_simap_official_url(detail: dict[str, Any]) -> str | None:
    project_info = detail.get("project-info", {}) if isinstance(detail, dict) else {}
    if not isinstance(project_info, dict):
        return None

    direct_url = project_info.get("documentsSourceUrl")
    if isinstance(direct_url, str) and direct_url.strip():
        return direct_url.strip()

    for key in ("offerDigitalExternalPlatformUrl", "procOfficeAddress.url"):
        current: Any = project_info
        for segment in key.split("."):
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(segment)
        picked = pick_localized_text(current)
        if picked:
            return picked

    return None


def _pick_simap_documents_portal_url(detail: dict[str, Any]) -> str | None:
    project_info = detail.get("project-info", {}) if isinstance(detail, dict) else {}
    if not isinstance(project_info, dict):
        return None

    direct_url = project_info.get("documentsSourceUrl")
    if isinstance(direct_url, str) and direct_url.strip():
        return direct_url.strip()

    picked = pick_localized_text(project_info.get("offerDigitalExternalPlatformUrl"))
    if picked:
        return picked

    return None


def _pick_simap_prize_summary(detail: dict[str, Any]) -> str | None:
    terms = detail.get("terms", {}) if isinstance(detail, dict) else {}
    if not isinstance(terms, dict):
        return None

    compensation_note = pick_localized_text(terms.get("compensationNote"))
    if compensation_note:
        return compensation_note

    total_price_note = pick_localized_text(terms.get("totalPriceNote"))
    if total_price_note:
        return total_price_note

    compensation = terms.get("compensation")
    if not isinstance(compensation, dict):
        compensation = terms.get("totalPrice")
        if not isinstance(compensation, dict):
            return None

    price = compensation.get("price")
    currency = compensation.get("currency")
    if price in (None, ""):
        return None

    amount = str(price).rstrip("0").rstrip(".") if isinstance(price, float) else str(price)
    if currency:
        return f"Compensation: {currency} {amount}."
    return f"Compensation: {amount}."


def _pick_simap_estimated_value_text(detail: dict[str, Any]) -> str | None:
    procurement = detail.get("procurement", {}) if isinstance(detail, dict) else {}
    if not isinstance(procurement, dict):
        return None

    order_description = strip_html(pick_localized_text(procurement.get("orderDescription")))
    if not order_description:
        return None

    budget_patterns = [
        r"(L['’]objectif budgétaire[^.]*\.)",
        r"(Das Kostenziel[^.]*\.)",
        r"(Il budget[^.]*\.)",
        r"(Budget[^.]*CHF[^.]*\.)",
    ]
    for pattern in budget_patterns:
        match = re.search(pattern, order_description, flags=re.IGNORECASE)
        if match:
            return match.group(1).strip()

    return None


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from)
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _searches(window_start: date) -> list[dict[str, Any]]:
    """Search parameters, one dict per search; projects are deduplicated across them."""
    base: dict[str, Any] = {"lang": ["en"], "newestPublicationFrom": window_start.isoformat()}
    return [base]


def _search_projects(
    get_json: FetchJson, params: dict[str, Any], window_start: date
) -> Iterator[dict[str, Any]]:
    """Every project of one search, newest publication first, until the window ends."""
    last_item: str | None = page_position(None)
    for _ in bounded_pages(range(page_limit(SIMAP_MAX_PAGES))):
        query = {**params, **({"lastItem": last_item} if last_item else {})}
        response = get_json(build_url(SIMAP_PROJECT_SEARCH_URL, query))
        projects = response.get("projects") if isinstance(response, dict) else None
        if not isinstance(projects, list) or not projects:
            return
        for project in page_items(projects):
            if not isinstance(project, dict):
                continue
            published = parse_date_string(str(project.get("publicationDate") or ""))
            # Results are sorted by newest publication date; the server already bounds the
            # window, so an older entry only means the rest of the search is older too.
            if published and date.fromisoformat(published) < window_start:
                return
            yield project
        pagination = response.get("pagination")
        if current_pages() and current_pages().rows >= current_pages().items:
            unfinished_page()
            return
        last_item = pagination.get("lastItem") if isinstance(pagination, dict) else None
        next_page(last_item)
        if not last_item:
            return
    unfinished_page()
    logger.warning(
        "simap paging stopped after %d pages; later projects were not read", SIMAP_MAX_PAGES
    )


def _build_document(
    project: dict[str, Any],
    project_id: str,
    detail_url: str,
    detail: Any,
) -> CollectedSourceDocument | None:
    detail_project_info = detail.get("project-info", {}) if isinstance(detail, dict) else {}
    detail_procurement = detail.get("procurement", {}) if isinstance(detail, dict) else {}
    detail_dates = detail.get("dates", {}) if isinstance(detail, dict) else {}
    detail_base = detail.get("base", {}) if isinstance(detail, dict) else {}
    proc_office_address = detail_project_info.get("procOfficeAddress", {})
    if not isinstance(proc_office_address, dict):
        proc_office_address = {}

    title = pick_localized_text(detail_project_info.get("title")) or pick_localized_text(
        project.get("title")
    )
    if not title:
        return None

    payload = json.dumps(
        {
            "officialNoticeId": detail_base.get("publicationNumber")
            or project.get("publicationNumber")
            or project.get("projectNumber"),
            "title": title,
            "rawNotice": {"listing": project, "detail": detail},
            "buyer": pick_localized_text(proc_office_address.get("name"))
            or pick_localized_text(project.get("procOfficeName")),
            "location": pick_localized_text(proc_office_address.get("city"))
            or pick_localized_text(proc_office_address.get("locality"))
            or pick_localized_text(proc_office_address.get("place")),
            "procedureType": detail_base.get("processType") or project.get("processType"),
            "projectSubType": detail_base.get("projectSubType") or project.get("projectSubType"),
            "deadline": parse_date_string(str(detail_dates.get("offerDeadline") or "")),
            "publicationDate": parse_date_string(str(project.get("publicationDate") or "")),
            "cpv": extract_cpv_codes(detail) if isinstance(detail, dict) else [],
            "description": strip_html(
                pick_localized_text(detail_procurement.get("orderDescription"))
            ),
            "estimatedValueText": _pick_simap_estimated_value_text(detail)
            if isinstance(detail, dict)
            else None,
            "officialUrl": (
                _pick_simap_official_url(detail) or _build_simap_project_detail_url(project_id)
                if isinstance(detail, dict)
                else _build_simap_project_detail_url(project_id)
            ),
            "documentsPortalUrl": _pick_simap_documents_portal_url(detail)
            if isinstance(detail, dict)
            else None,
            "prizeSummary": _pick_simap_prize_summary(detail) if isinstance(detail, dict) else None,
            "authorityEmail": pick_localized_text(proc_office_address.get("email")),
            "url": detail_url,
        },
        ensure_ascii=False,
    )
    return CollectedSourceDocument(source_url=detail_url, payload=payload)


def collect_simap_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: FetchJson | None = None,
) -> list[CollectedSourceDocument]:
    get_json = fetch_json or _default_fetch_json
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []
    seen_projects: set[str] = set()

    projects = (
        project
        for params in _searches(window_start)
        for project in _search_projects(get_json, params, window_start)
    )
    for project in projects:
        project_id = str(project.get("id") or "").strip()
        # The search entry carries the project's newest publication.
        publication_id = str(project.get("publicationId") or "").strip()
        if not project_id or not publication_id or project_id in seen_projects:
            continue
        seen_projects.add(project_id)
        detail_url = SIMAP_PUBLICATION_DETAIL_URL.format(
            project_id=project_id, publication_id=publication_id
        )
        try:
            detail = get_json(detail_url)
        except HttpError as exc:
            document = deferred_detail(exc, detail_url, project)
        else:
            document = _build_document(
                project,
                project_id,
                detail_url,
                detail,
            )
        if document is not None:
            documents.append(document)
            if len(documents) >= limit:
                return documents

    return documents
