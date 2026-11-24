"""GGZY collector orchestration: search, bounded detail fetching, scoring, payload assembly."""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.ggzy.fetch import (
    ListFetcher,
    PageFetcher,
    default_fetch_list,
    detail_url_from_listing,
    fetch_page_or_none,
    iter_candidate_rows,
    make_page_fetcher,
)
from arch_competition_ops.collectors.ggzy.html_text import (
    extract_detail_title,
    extract_notice_body_text,
    extract_original_link,
    normalize_space,
)
from arch_competition_ops.collectors.ggzy.relevance import (
    GGZYNoticeFeatures,
    classification_text_from_notice,
    extract_notice_features,
    map_building_categories,
    map_competition_types,
    map_project_types,
)
from arch_competition_ops.extractors.ggzy_fields import (
    AUTHORITY_PATTERNS,
    NOTICE_ID_PATTERNS,
    extract_deadline_iso,
    extract_first,
    extract_procedure_type,
    extract_qualification_clause,
    extract_value_text,
)
from arch_competition_ops.http import HttpError
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string

DETAIL_FETCH_WORKERS = 4
# Cap on the descriptive text carried in the payload (never used as an eligibility clause).
MAX_SUMMARY_CHARS = 4000


def _extract_notice_context(record: dict[str, Any], detail_html: str | None) -> tuple[str, str]:
    title = (
        extract_detail_title(detail_html or "")
        or normalize_space(str(record.get("title") or ""))
        or "Untitled notice"
    )
    body_text = extract_notice_body_text(detail_html or "") or ""
    return title, body_text


def _build_listing_payload(
    source: SourceDefinition,
    record: dict[str, Any],
    *,
    title: str,
    body_text: str,
    detail_html: str | None,
    detail_url: str,
    features: GGZYNoticeFeatures,
) -> dict[str, Any]:
    listing_publish_time = normalize_space(str(record.get("publishTime") or ""))
    published_at = parse_date_string(listing_publish_time)
    official_url = extract_original_link(detail_html or "")

    evidence_level = "official_notice" if detail_html else "official_listing"
    evidence_note = (
        f"Official {source.name} notice detail."
        if detail_html
        else f"Official {source.name} listing."
    )

    payload: dict[str, Any] = {
        "title": title,
        "buyer": extract_first(AUTHORITY_PATTERNS, body_text),
        "noticeId": extract_first(NOTICE_ID_PATTERNS, body_text)
        or normalize_space(str(record.get("id") or "")),
        "deadline": extract_deadline_iso(body_text, published_at_iso=published_at),
        "summary": body_text[:MAX_SUMMARY_CHARS]
        if body_text
        else normalize_space(str(record.get("title") or "")),
        # Only text under a qualification heading counts as an eligibility clause.
        "eligibility": extract_qualification_clause(body_text),
        "officialUrl": official_url,
        "documentsPortalUrl": official_url,
        "opportunityType": "public_design_services_procurement",
        "procedureType": extract_procedure_type(
            body_text,
            normalize_space(str(record.get("businessTypeText") or "")),
            normalize_space(str(record.get("informationTypeText") or "")),
        ),
        "evidenceLevel": evidence_level,
        "evidenceNote": evidence_note,
        "publishedAt": published_at,
        "estimatedValueText": extract_value_text(body_text),
        "location": normalize_space(str(record.get("provinceText") or "")),
        "businessType": normalize_space(str(record.get("businessTypeText") or "")),
        "informationType": normalize_space(str(record.get("informationTypeText") or "")),
        "detailUrl": detail_url,
        "competitionTypes": map_competition_types(features),
        "projectTypes": map_project_types(features),
        "buildingCategories": map_building_categories(features),
        "builtAssetTypes": sorted(features.built_asset_types),
        "designScopes": sorted(features.design_scopes),
        "projectModes": sorted(features.project_modes),
    }

    return {key: value for key, value in payload.items() if value not in (None, "")}


def _collect_document(
    source: SourceDefinition,
    record: dict[str, Any],
    *,
    fetch_page: PageFetcher,
) -> CollectedSourceDocument:
    detail_url = detail_url_from_listing(source, normalize_space(str(record.get("url") or "")))
    try:
        detail_html = fetch_page_or_none(detail_url, fetch_page=fetch_page)
    except HttpError as exc:
        return deferred_detail(exc, detail_url, record)

    title, body_text = _extract_notice_context(record, detail_html)
    features = extract_notice_features(
        combined_text=f"{title.lower()} {body_text.lower()}".strip(),
        classification_text=classification_text_from_notice(title, body_text),
    )
    payload = _build_listing_payload(
        source,
        record,
        title=title,
        body_text=body_text,
        detail_html=detail_html,
        detail_url=detail_url,
        features=features,
    )
    payload["rawNotice"] = record
    payload["rawNoticeHtml"] = detail_html or ""
    return CollectedSourceDocument(
        source_url=detail_url, payload=json.dumps(payload, ensure_ascii=False)
    )


def collect_ggzy_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_list: ListFetcher | None = None,
    fetch_detail: PageFetcher | None = None,
    today: date | None = None,
    archive_dir: Path | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    candidates = iter_candidate_rows(
        publication_date_from=publication_date_from,
        today=today or clock.today(),
        fetch_list=fetch_list or default_fetch_list,
    )[:limit]

    fetch_page = fetch_detail or make_page_fetcher(archive_dir)
    with ThreadPoolExecutor(max_workers=DETAIL_FETCH_WORKERS) as executor:
        futures = [
            executor.submit(_collect_document, source, row, fetch_page=fetch_page)
            for row in candidates
        ]
        return [future.result() for future in futures]
