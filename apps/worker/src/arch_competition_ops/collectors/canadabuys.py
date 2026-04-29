from __future__ import annotations

import csv
import io
import json

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_text_get,
    has_built_environment_context,
    is_design_relevant,
    normalize_text,
    parse_date_string,
)
from arch_competition_ops.models import SourceDefinition


CANADA_DESIGN_MARKERS = (
    "design build",
    "design-builder",
    "design builder",
    "architect",
    "architecture",
    "architectural",
    "landscape",
    "urban design",
    "planning",
    "masterplan",
    "heritage conservation",
)
CANADA_BUILT_MARKERS = (
    "design build",
    "design-builder",
    "design builder",
    "camp infrastructure",
    "infrastructure",
    "public works",
    "stormwater",
    "watermain",
    "heritage",
)
CANADA_NEGATIVE_MARKERS = (
    "naval architecture",
    "marine",
    "tugboat",
    "vessel recycling",
    "hotel rooms",
    "lodging",
    "accommodation services",
)


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(url, headers={"Accept": "text/csv, text/plain;q=0.9, */*;q=0.8"})


def _pick_row_value(row: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = row.get(key)
        if value and value.strip():
            return value.strip()
    return None


def _is_relevant_canadabuys_notice(title: str, summary: str, category: str, unspsc: str) -> bool:
    if not title:
        return False

    normalized = normalize_text(f"{title} {summary} {unspsc}")
    if any(marker in normalized for marker in CANADA_NEGATIVE_MARKERS):
        return False
    has_design_signal = is_design_relevant(title, summary, unspsc) or any(
        marker in normalized for marker in CANADA_DESIGN_MARKERS
    )
    if not has_design_signal:
        return False

    if category.strip() == "*CNST":
        return True

    if has_built_environment_context(title, summary, unspsc):
        return True

    return any(marker in normalized for marker in CANADA_BUILT_MARKERS)


def collect_canadabuys_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    csv_text = (fetch_text or _default_fetch_text)(source.base_url)
    reader = csv.DictReader(io.StringIO(csv_text))

    documents: list[tuple[str, CollectedSourceDocument]] = []
    for row in reader:
        title = _pick_row_value(row, "title-titre-eng", "title-titre-fra")
        summary = _pick_row_value(
            row,
            "description-descriptif-eng",
            "description-descriptif-fra",
            "unspscDescription-eng",
            "unspscDescription-fra",
        ) or ""
        procurement_category = _pick_row_value(row, "procurementCategory-categorieApprovisionnement") or ""
        unspsc_description = _pick_row_value(row, "unspscDescription-eng", "unspscDescription-fra") or ""
        publication_date = parse_date_string(_pick_row_value(row, "publicationDate-datePublication"))

        if publication_date_from and publication_date and publication_date < publication_date_from:
            continue
        if not title or not _is_relevant_canadabuys_notice(
            title,
            summary,
            procurement_category,
            unspsc_description,
        ):
            continue

        official_url = _pick_row_value(row, "noticeURL-URLavis-eng", "noticeURL-URLavis-fra") or source.base_url
        payload = json.dumps(
            {
                "title": title,
                "buyer": _pick_row_value(row, "procuringEntity-entiteContractante"),
                "noticeId": _pick_row_value(
                    row,
                    "referenceNumber-numeroReference",
                    "solicitationNumber-numeroSollicitation",
                ),
                "deadline": parse_date_string(_pick_row_value(row, "tenderClosingDate-appelOffresDateCloture")),
                "summary": summary or procurement_category or unspsc_description,
                "officialUrl": official_url,
                "opportunityType": "public_design_services_procurement",
                "procedureType": _pick_row_value(
                    row,
                    "procurementMethod-methodeApprovisionnement-eng",
                    "noticeType-avisType-eng",
                ),
                "implementationPath": "service_contract_award_after_competitive_selection",
                "evidenceLevel": "official_listing",
                "evidenceNote": "Official CanadaBuys open tender notice dataset row.",
                "publishedAt": publication_date,
            },
            ensure_ascii=False,
        )
        documents.append(
            (
                publication_date or "0000-00-00",
                CollectedSourceDocument(source_url=official_url, payload=payload),
            )
        )

    documents.sort(key=lambda item: item[0], reverse=True)
    return [document for _publication_date, document in documents[:limit]]
