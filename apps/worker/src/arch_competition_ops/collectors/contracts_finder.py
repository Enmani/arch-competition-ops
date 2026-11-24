from __future__ import annotations

import json
import re
from collections.abc import Callable

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
)
from arch_competition_ops.collectors.uk_ocds import (
    OCDS_PAGE_SIZE,
    iter_ocds_releases,
    pick_buyer_name,
    pick_delivery_location,
    pick_estimated_value,
)
from arch_competition_ops.models import SourceDefinition

CONTRACTS_FINDER_NOTICE_URL = "https://www.contractsfinder.service.gov.uk/Notice/{notice_id}"
# A release id is "<notice uuid>-<release sequence>"; the notice uuid names the public page
# (checked live 2026-11: all 52 tender releases of a week matched their own /Notice/ document).
# The ocid uuid is a different value and does not resolve to the notice page.
_RELEASE_ID_PATTERN = re.compile(
    r"^(?P<notice>[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-\d+$"
)
_NOTICE_URL_PATTERN = re.compile(
    r"^https://www\.contractsfinder\.service\.gov\.uk/Notice/[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$"
)

# Overlap with Find a Tender (checked live for 2026-11-08..15): 12 of 52 Contracts Finder tender
# releases were also on Find a Tender (same buyer and deadline; the Contracts Finder title is
# "<FTS tender.id> - <FTS title>", e.g. "CA18682 - RFQ 2026/47 - ..."). No Contracts Finder field
# references the Find a Tender notice, so the copy is not skipped here; downstream de-duplication
# has to match on buyer, title and deadline.


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _resolve_search_window(publication_date_from: str | None) -> tuple[str, str]:
    today = clock.today()
    published_from = publication_date_from or today.replace(day=1).isoformat()
    published_to = today.isoformat()
    return f"{published_from}T00:00:00", f"{published_to}T23:59:59"


def _notice_page_url(release: dict, tender: dict) -> str | None:
    """The notice's own public page, or ``None`` when neither release id nor documents name it."""
    match = _RELEASE_ID_PATTERN.match(str(release.get("id") or "").strip().lower())
    if match:
        return CONTRACTS_FINDER_NOTICE_URL.format(notice_id=match.group("notice"))
    for document in tender.get("documents", []):
        url = document.get("url") if isinstance(document, dict) else None
        if isinstance(url, str) and _NOTICE_URL_PATTERN.match(url.strip()):
            return url.strip()
    return None


def collect_contracts_finder_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: Callable[[str], dict] | None = None,
) -> list[CollectedSourceDocument]:
    published_from, published_to = _resolve_search_window(publication_date_from)
    search_url = build_url(
        source.base_url,
        {
            "publishedFrom": published_from,
            "publishedTo": published_to,
            "limit": OCDS_PAGE_SIZE,
        },
    )

    documents: list[CollectedSourceDocument] = []
    if limit <= 0:
        return documents
    for release in iter_ocds_releases(search_url, fetch_json or _default_fetch_json):
        tender = release.get("tender", {})
        if not isinstance(tender, dict):
            continue

        title = (tender.get("title") or "").strip()
        description = (tender.get("description") or "").strip()
        classification = tender.get("classification", {})
        cpv_code = classification.get("id", "").strip() if isinstance(classification, dict) else ""

        official_url = _notice_page_url(release, tender)
        if official_url is None:
            # Without its own page the notice cannot be told apart from the other rows.
            continue
        estimated_value_eur, estimated_value_text = pick_estimated_value(tender)
        payload_row = json.dumps(
            {
                "title": title,
                "rawNotice": release,
                "buyer": pick_buyer_name(release),
                "noticeId": release.get("ocid"),
                "deadline": (tender.get("tenderPeriod") or {}).get("endDate"),
                "estimatedValueEur": estimated_value_eur,
                "estimatedValueText": estimated_value_text,
                "location": pick_delivery_location(tender),
                "summary": description,
                "officialUrl": official_url,
                "cpv": [cpv_code] if cpv_code else [],
                "opportunityType": "public_design_services_procurement",
                "procedureType": tender.get("procurementMethodDetails")
                or tender.get("procurementMethod"),
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official UK Contracts Finder OCDS tender release.",
                "publishedAt": tender.get("datePublished") or release.get("date"),
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=official_url, payload=payload_row))
        if len(documents) >= limit:
            break

    return documents
