from __future__ import annotations

import json
from datetime import date
from typing import Any

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
    has_built_environment_context,
    is_design_relevant,
    normalize_text,
    parse_date_string,
)
from arch_competition_ops.models import SourceDefinition


ANAC_AVVISI_URL = "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi"
ANAC_HEADERS = {
    "Accept": "application/json",
    "Referer": "https://pubblicitalegale.anticorruzione.it/",
}


def _default_fetch_json(url: str) -> Any:
    return fetch_json_get(url, headers=ANAC_HEADERS)


def _build_notice_detail_url(notice_id: str | None) -> str | None:
    if not isinstance(notice_id, str) or not notice_id.strip():
        return None
    return f"{ANAC_AVVISI_URL}/{notice_id.strip()}"


def _build_notice_public_url(notice_id: str | None, procedure_type: str | None) -> str | None:
    if not isinstance(notice_id, str) or not notice_id.strip():
        return None

    normalized_notice_id = notice_id.strip()
    normalized_procedure_type = (procedure_type or "").strip().lower()
    route = "esiti" if normalized_procedure_type.startswith("ad") else "bandi"
    return f"https://pubblicitalegale.anticorruzione.it/{route}/{normalized_notice_id}?ricercaArchivio=true"


def _extract_template(item: dict[str, Any]) -> dict[str, Any]:
    templates = item.get("template")
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


def _extract_document_link(template: dict[str, Any], flattened_items: list[dict[str, Any]]) -> str | None:
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


def collect_anac_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    get_json = fetch_json or _default_fetch_json
    min_publication_date = date.fromisoformat(publication_date_from) if publication_date_from else None
    page = 0
    page_size = max(limit * 10, 50)
    max_pages = 5
    documents: list[CollectedSourceDocument] = []

    while len(documents) < limit and page < max_pages:
        url = build_url(
            ANAC_AVVISI_URL,
            {
                "page": page,
                "size": page_size,
                "sortField": "dataPubblicazione",
                "sortDirection": "desc",
            },
        )
        response = get_json(url)
        content = response.get("content", []) if isinstance(response, dict) else []
        if not isinstance(content, list) or not content:
            break

        for item in content:
            if not isinstance(item, dict):
                continue

            publication_date = parse_date_string(str(item.get("dataPubblicazione") or ""))
            if min_publication_date and publication_date:
                if date.fromisoformat(publication_date) < min_publication_date:
                    continue

            template = _extract_template(item)
            metadata = template.get("metadata", {}) if isinstance(template, dict) else {}
            flattened_items = _flatten_section_items(template)

            title = metadata.get("titolo") or metadata.get("descrizione")
            if not title and flattened_items:
                title = flattened_items[0].get("descrizione")
            title = str(title or "").strip()
            summary = str(metadata.get("descrizione") or "").strip() or title
            if not title or not is_design_relevant(title, summary):
                continue
            normalized_title = normalize_text(title)
            if not has_built_environment_context(title, summary) and not any(
                marker in normalized_title for marker in ("architett", "archeolog", "restauro", "paesagg")
            ):
                continue

            first_item = flattened_items[0] if flattened_items else {}
            if "aggiudicazione" in summary.lower() and not item.get("dataScadenza"):
                continue

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
                    "url": document_link or source.base_url,
                    "officialUrl": document_link or source.base_url,
                    "sourceApiUrl": detail_url,
                    "sourcePublicUrl": public_notice_url,
                },
                ensure_ascii=False,
            )
            documents.append(
                CollectedSourceDocument(
                    source_url=public_notice_url or detail_url or source.base_url,
                    payload=payload,
                )
            )
            if len(documents) >= limit:
                break

        page += 1

    return documents
