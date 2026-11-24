"""UK Find a Tender Service (FTS) collector."""

from __future__ import annotations

import json
import re
from collections.abc import Callable
from datetime import timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import build_url, fetch_json_get
from arch_competition_ops.collectors.uk_ocds import (
    OCDS_PAGE_SIZE,
    iter_ocds_releases,
    pick_buyer_name,
    pick_delivery_location,
    pick_estimated_value,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.text import normalize_text

FIND_A_TENDER_NOTICE_URL = "https://www.find-tender.service.gov.uk/Notice/{notice_id}"
DEFAULT_WINDOW_DAYS = 7

_NOTICE_ID_PATTERN = re.compile(r"^\d+-\d{4}$")
_NOTICE_URL_PREFIX = "https://www.find-tender.service.gov.uk/Notice/"


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _resolve_window(publication_date_from: str | None) -> tuple[str, str]:
    today = clock.today()
    updated_from = (
        publication_date_from or (today - timedelta(days=DEFAULT_WINDOW_DAYS)).isoformat()
    )
    return f"{updated_from}T00:00:00", f"{today.isoformat()}T23:59:59"


def _cpv_codes(tender: dict[str, Any]) -> list[str]:
    classifications: list[Any] = [tender.get("classification")]
    for item in tender.get("items") or []:
        if isinstance(item, dict):
            classifications.append(item.get("classification"))
            classifications += item.get("additionalClassifications") or []

    codes: list[str] = []
    for classification in classifications:
        if not isinstance(classification, dict):
            continue
        scheme = str(classification.get("scheme") or "CPV").strip().upper()
        code = str(classification.get("id") or "").strip()
        if scheme == "CPV" and code and code not in codes:
            codes.append(code)
    return codes


def _is_design_contest(tender: dict[str, Any]) -> bool:
    text = normalize_text(
        f"{tender.get('procurementMethodDetails') or ''} {tender.get('title') or ''}"
    )
    return "design contest" in text


def _notice_documents(release: dict[str, Any]) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    for section in ("tender", "planning"):
        block = release.get(section)
        if isinstance(block, dict):
            documents += [d for d in block.get("documents") or [] if isinstance(d, dict)]
    return [d for d in documents if d.get("noticeType")]


def _notice_page_url(release: dict[str, Any]) -> str | None:
    notice_id = str(release.get("id") or "").strip()
    if _NOTICE_ID_PATTERN.match(notice_id):
        return FIND_A_TENDER_NOTICE_URL.format(notice_id=notice_id)
    for document in _notice_documents(release):
        url = str(document.get("url") or "").strip()
        if url.startswith(_NOTICE_URL_PREFIX):
            return url
    return None


def _build_payload(
    release: dict[str, Any],
    tender: dict[str, Any],
    *,
    official_url: str,
    cpv_codes: list[str],
    design_contest: bool,
) -> str:
    estimated_value_eur, estimated_value_text = pick_estimated_value(tender)
    notice_types = [d["noticeType"] for d in _notice_documents(release)]
    return json.dumps(
        {
            "title": (tender.get("title") or "").strip(),
            "rawNotice": release,
            "buyer": pick_buyer_name(release),
            "noticeId": release.get("ocid"),
            "noticeType": notice_types[0] if notice_types else None,
            "deadline": (tender.get("tenderPeriod") or {}).get("endDate"),
            "estimatedValueEur": estimated_value_eur,
            "estimatedValueText": estimated_value_text,
            "location": pick_delivery_location(tender),
            "summary": (tender.get("description") or "").strip(),
            "officialUrl": official_url,
            "cpv": cpv_codes,
            "opportunityType": (
                "public_design_contest" if design_contest else "public_design_services_procurement"
            ),
            "procedureType": tender.get("procurementMethodDetails")
            or tender.get("procurementMethod"),
            "evidenceLevel": "official_notice",
            "evidenceNote": "Official UK Find a Tender OCDS release.",
            "publishedAt": tender.get("datePublished") or release.get("date"),
        },
        ensure_ascii=False,
    )


def collect_find_a_tender_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: Callable[[str], dict] | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    updated_from, updated_to = _resolve_window(publication_date_from)
    search_url = build_url(
        source.base_url,
        {"limit": OCDS_PAGE_SIZE, "updatedFrom": updated_from, "updatedTo": updated_to},
    )

    kept: list[tuple[str, CollectedSourceDocument]] = []
    if limit <= 0:
        return []
    seen_urls: set[str] = set()
    for release in iter_ocds_releases(search_url, fetch_json or _default_fetch_json):
        official_url = _notice_page_url(release)
        if official_url is None or official_url in seen_urls:
            continue
        seen_urls.add(official_url)
        tender = release.get("tender") if isinstance(release.get("tender"), dict) else {}
        cpv_codes = _cpv_codes(tender)
        design_contest = _is_design_contest(tender)
        payload = _build_payload(
            release,
            tender,
            official_url=official_url,
            cpv_codes=cpv_codes,
            design_contest=design_contest,
        )
        kept.append(
            (str(release.get("date") or ""), CollectedSourceDocument(official_url, payload))
        )
        if len(kept) >= limit:
            break

    kept.sort(key=lambda entry: entry[0], reverse=True)
    return [document for _, document in kept]
