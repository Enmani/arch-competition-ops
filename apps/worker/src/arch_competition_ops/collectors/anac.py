"""ANAC legal-publicity platform (pubblicitalegale.anticorruzione.it), ``/api/v0/avvisi``."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
)
from arch_competition_ops.collectors.pagination import (
    numbered_pages,
    page_items,
    page_limit,
    unfinished_page,
)
from arch_competition_ops.extractors.anac import resolve_anac_record_status
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string

logger = logging.getLogger(__name__)

ANAC_AVVISI_URL = "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi"
ANAC_HEADERS = {
    "Accept": "application/json",
    "Referer": "https://pubblicitalegale.anticorruzione.it/",
}
DEFAULT_LOOKBACK_DAYS = 7
# A page of 100 notices is about 0.3 MB.
PAGE_SIZE = 100
# Stops a runaway window: a week of the open groups is about 8 pages, and the unscoped feed read
# without AI stops as soon as ``limit`` relevant notices are kept.
MAX_PAGES = 50
# eForms subtypes 23 and 24 are design contest notices (directives 2014/24 and 2014/25).
DESIGN_CONTEST_EFORM_SUBTYPES = frozenset({"23", "24"})


def _default_fetch_json(url: str) -> Any:
    return fetch_json_get(url, headers=ANAC_HEADERS)


def _build_notice_detail_url(notice_id: str | None) -> str | None:
    if not isinstance(notice_id, str) or not notice_id.strip():
        return None
    return f"{ANAC_AVVISI_URL}/{notice_id.strip()}"


def _build_notice_public_url(notice_id: str | None, procedure_type: str | None) -> str | None:
    if not isinstance(notice_id, str) or not notice_id.strip():
        return None

    is_award = resolve_anac_record_status({"procedureType": procedure_type}) == "archived"
    route = "esiti" if is_award else "bandi"
    return f"https://pubblicitalegale.anticorruzione.it/{route}/{notice_id.strip()}?ricercaArchivio=true"


def _extract_template(item: dict[str, Any]) -> dict[str, Any]:
    templates = item.get("templates") or item.get("template")
    if isinstance(templates, list) and templates:
        candidate = templates[0]
        if isinstance(candidate, dict):
            template = candidate.get("template")
            if isinstance(template, dict):
                return template
    return {}


def _flatten_section_items(template: dict[str, Any]) -> list[dict[str, Any]]:
    flattened: list[dict[str, Any]] = []
    for section in template.get("sections", []):
        if not isinstance(section, dict):
            continue
        items = section.get("items")
        if isinstance(items, list):
            for item in items:
                if isinstance(item, dict):
                    flattened.append(item)
    return flattened


def _extract_authority_name(template: dict[str, Any]) -> str | None:
    for section in template.get("sections", []):
        if not isinstance(section, dict):
            continue
        fields = section.get("fields", {})
        if not isinstance(fields, dict):
            continue
        buyers = fields.get("soggetti_sa")
        if isinstance(buyers, list) and buyers:
            first = buyers[0]
            if isinstance(first, dict):
                name = first.get("denominazione_amministrazione")
                if isinstance(name, str) and name.strip():
                    return name.strip()
    return None


def _extract_document_link(
    template: dict[str, Any], flattened_items: list[dict[str, Any]]
) -> str | None:
    for section in template.get("sections", []):
        if not isinstance(section, dict):
            continue
        fields = section.get("fields", {})
        if not isinstance(fields, dict):
            continue
        candidate = fields.get("documenti_di_gara_link")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()

    for item in flattened_items:
        candidate = item.get("documenti_di_gara_link")
        if isinstance(candidate, str) and candidate.strip():
            return candidate.strip()
    return None


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from)
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _search_url(window_start: date, page: int) -> str:
    params: dict[str, Any] = {
        "page": page,
        "size": PAGE_SIZE,
        "sortField": "dataPubblicazione",
        "sortDirection": "desc",
        "dataPubblicazioneStart": window_start.strftime("%d/%m/%Y"),
    }
    return build_url(ANAC_AVVISI_URL, params)


def _is_design_contest(item: dict[str, Any]) -> bool:
    if str(item.get("codiceEform") or "") in DESIGN_CONTEST_EFORM_SUBTYPES:
        return True
    scheda = str(item.get("codiceScheda") or "")
    return scheda.startswith("P") and scheda.rpartition("_")[2] in DESIGN_CONTEST_EFORM_SUBTYPES


def _build_document(
    source: SourceDefinition,
    item: dict[str, Any],
    publication_date: str | None,
) -> CollectedSourceDocument | None:
    template = _extract_template(item)
    metadata = template.get("metadata", {}) if isinstance(template, dict) else {}
    flattened_items = _flatten_section_items(template)

    title = metadata.get("titolo") or metadata.get("descrizione")
    if not title and flattened_items:
        title = flattened_items[0].get("descrizione")
    title = str(title or "").strip()
    summary = str(metadata.get("descrizione") or "").strip() or title

    first_item = flattened_items[0] if flattened_items else {}
    notice_id = item.get("idAvviso")
    procedure_type = item.get("codiceScheda")
    document_link = _extract_document_link(template, flattened_items)
    detail_url = _build_notice_detail_url(str(notice_id) if notice_id is not None else None)
    public_notice_url = _build_notice_public_url(
        str(notice_id) if notice_id is not None else None,
        str(procedure_type) if procedure_type is not None else None,
    )
    payload = json.dumps(
        {
            "officialNoticeId": notice_id,
            "title": title,
            "buyer": _extract_authority_name(template),
            "procedureType": procedure_type,
            "deadline": parse_date_string(str(item.get("dataScadenza") or "")),
            "publicationDate": publication_date,
            "estimatedValueEur": first_item.get("valore_affidamento"),
            "summary": summary,
            "officialUrl": document_link,
            "sourceApiUrl": detail_url,
            "sourcePublicUrl": public_notice_url,
            "rawNotice": item,
        },
        ensure_ascii=False,
    )
    return CollectedSourceDocument(
        source_url=public_notice_url or detail_url or source.base_url,
        payload=payload,
    )


def collect_anac_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    get_json = fetch_json or _default_fetch_json
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []
    seen_ids: set[str] = set()

    for page in numbered_pages(range(page_limit(MAX_PAGES))):
        response = get_json(_search_url(window_start, page))
        content = response.get("content", []) if isinstance(response, dict) else []
        if not isinstance(content, list) or not content:
            return documents

        for item in page_items(content):
            if not isinstance(item, dict):
                continue
            publication_date = parse_date_string(str(item.get("dataPubblicazione") or ""))
            if publication_date and date.fromisoformat(publication_date) < window_start:
                # Newest first: every later row is older than the window too.
                return documents
            # Offset paging over a feed that grows while it is read can repeat a row.
            notice_key = str(item.get("idAvviso") or "")
            if notice_key and notice_key in seen_ids:
                continue
            seen_ids.add(notice_key)

            document = _build_document(source, item, publication_date)
            if document is None:
                continue
            documents.append(document)
            if len(documents) >= limit:
                return documents

        if response.get("last") is True or len(content) < PAGE_SIZE:
            return documents

    unfinished_page()
    logger.warning(
        "ANAC: stopped after %d pages of %d notices before reaching %s; older notices are not read",
        MAX_PAGES,
        PAGE_SIZE,
        window_start.isoformat(),
    )
    return documents
