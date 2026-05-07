from __future__ import annotations

import json
import re
from datetime import date
from typing import Any

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    extract_cpv_codes,
    fetch_json_get,
    has_built_environment_context,
    normalize_text,
    parse_date_string,
    pick_localized_text,
    strip_html,
)
from arch_competition_ops.models import SourceDefinition


SIMAP_PROJECT_SEARCH_URL = "https://www.simap.ch/api/publications/v2/project/project-search"
SIMAP_PROJECT_HEADER_URL = "https://www.simap.ch/api/publications/v2/project/{project_id}/project-header"
SIMAP_PUBLICATION_DETAIL_URL = (
    "https://www.simap.ch/api/publications/v1/project/{project_id}/publication-details/{publication_id}"
)
SIMAP_PROJECT_DETAIL_URL = "https://www.simap.ch/de/project-detail/{project_id}"
ALLOWED_PROJECT_SUBTYPES = (
    "project_competition",
    "overall_performance_competition",
)


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


def collect_simap_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    get_json = fetch_json or _default_fetch_json
    min_publication_date = date.fromisoformat(publication_date_from) if publication_date_from else None
    last_item: str | None = None
    documents: list[CollectedSourceDocument] = []

    while len(documents) < limit:
        params: dict[str, Any] = {"lang": ["en"], "projectSubTypes": list(ALLOWED_PROJECT_SUBTYPES)}
        if last_item:
            params["lastItem"] = last_item

        response = get_json(build_url(SIMAP_PROJECT_SEARCH_URL, params))
        if not isinstance(response, dict):
            break

        projects = response.get("projects", [])
        if not isinstance(projects, list) or not projects:
            break

        for project in projects:
            if not isinstance(project, dict):
                continue

            publication_date = parse_date_string(str(project.get("publicationDate") or ""))
            if min_publication_date and publication_date:
                if date.fromisoformat(publication_date) < min_publication_date:
                    continue
            if str(project.get("pubType") or "").lower() != "competition":
                continue

            project_id = str(project.get("id") or "").strip()
            if not project_id:
                continue

            header_url = SIMAP_PROJECT_HEADER_URL.format(project_id=project_id)
            header = get_json(header_url)
            latest_publication = header.get("latestPublication", {}) if isinstance(header, dict) else {}
            if not isinstance(latest_publication, dict):
                latest_publication = {}
            publication_id = str(latest_publication.get("id") or project.get("publicationId") or "").strip()
            if not publication_id:
                continue
            detail_url = (
                SIMAP_PUBLICATION_DETAIL_URL.format(project_id=project_id, publication_id=publication_id)
                if publication_id
                else None
            )
            detail = get_json(detail_url) if detail_url else None
            detail_project_info = detail.get("project-info", {}) if isinstance(detail, dict) else {}
            detail_procurement = detail.get("procurement", {}) if isinstance(detail, dict) else {}
            detail_dates = detail.get("dates", {}) if isinstance(detail, dict) else {}
            detail_base = detail.get("base", {}) if isinstance(detail, dict) else {}
            proc_office_address = detail_project_info.get("procOfficeAddress", {})
            if not isinstance(proc_office_address, dict):
                proc_office_address = {}

            title = pick_localized_text(detail_project_info.get("title")) or pick_localized_text(latest_publication.get("title")) or pick_localized_text(
                project.get("title")
            )
            if not title:
                continue
            normalized_title = normalize_text(title)
            if not has_built_environment_context(title) and not any(
                marker in normalized_title for marker in ("architett", "architecture", "maitre d oeuvre", "planification")
            ):
                continue

            payload = json.dumps(
                {
                    "officialNoticeId": detail_base.get("publicationNumber")
                    or latest_publication.get("publicationNumber")
                    or project.get("publicationNumber")
                    or project.get("projectNumber"),
                    "title": title,
                    "buyer": pick_localized_text(proc_office_address.get("name"))
                    or pick_localized_text(project.get("procOfficeName")),
                    "location": pick_localized_text(proc_office_address.get("city"))
                    or pick_localized_text(proc_office_address.get("locality"))
                    or pick_localized_text(proc_office_address.get("place")),
                    "procedureType": detail_base.get("processType") or project.get("processType"),
                    "projectSubType": detail_base.get("projectSubType") or project.get("projectSubType"),
                    "deadline": parse_date_string(
                        str(detail_dates.get("offerDeadline") or latest_publication.get("dates", {}).get("offerDeadline") or "")
                    ),
                    "publicationDate": publication_date,
                    "cpv": extract_cpv_codes(detail) if isinstance(detail, dict) else [],
                    "description": strip_html(pick_localized_text(detail_procurement.get("orderDescription"))),
                    "estimatedValueText": _pick_simap_estimated_value_text(detail) if isinstance(detail, dict) else None,
                    "officialUrl": (
                        _pick_simap_official_url(detail) or _build_simap_project_detail_url(project_id)
                        if isinstance(detail, dict)
                        else _build_simap_project_detail_url(project_id)
                    ),
                    "documentsPortalUrl": _pick_simap_documents_portal_url(detail) if isinstance(detail, dict) else None,
                    "prizeSummary": _pick_simap_prize_summary(detail) if isinstance(detail, dict) else None,
                    "authorityEmail": pick_localized_text(proc_office_address.get("email")),
                    "url": detail_url or header_url,
                },
                ensure_ascii=False,
            )
            documents.append(CollectedSourceDocument(source_url=detail_url or header_url, payload=payload))
            if len(documents) >= limit:
                break

        pagination = response.get("pagination", {}) if isinstance(response, dict) else {}
        last_item = pagination.get("lastItem") if isinstance(pagination, dict) else None
        if not last_item:
            break

    return documents
