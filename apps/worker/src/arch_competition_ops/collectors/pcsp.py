from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    extract_cpv_codes,
    fetch_text_get,
    has_built_environment_context,
    is_design_relevant,
    normalize_text,
    parse_date_string,
    parse_money_value,
    strip_html,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.money import format_money_text


ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}
SUMMARY_FIELD_PATTERN = re.compile(r"\s*([^:;]+):\s*(.*?)(?=(?:;\s*[^:;]+:)|$)")
LABEL_PATTERN = re.compile(
    r'<span[^>]*id="[^"]*:label_([^"]+)"[^>]*>(.*?)</span>',
    flags=re.IGNORECASE | re.DOTALL,
)
LIVE_STATES = {"PUB"}
DESIGN_CPV_PREFIXES = ("712", "7142")
PCSP_DESIGN_MARKERS = (
    "arquitect",
    "arquitectura",
    "direccion facultativa",
    "direccion de obra",
    "direccion de ejecucion",
    "redaccion del proyecto",
    "redaccion de proyecto",
    "proyecto basico",
    "proyecto de ejecucion",
    "proyecto tecnico",
    "urbaniz",
    "urbanismo",
    "planeamiento",
    "paisaj",
    "masterplan",
    "espacio publico",
    "espacios publicos",
    "rehabilit",
    "restauracion",
)
PCSP_BUILT_MARKERS = (
    "biblioteca",
    "museo",
    "escuela",
    "colegio",
    "instituto",
    "campus",
    "hospital",
    "centro de salud",
    "edificio",
    "edificios",
    "vivienda",
    "plaza",
    "parque",
    "espacio publico",
    "espacios publicos",
    "urbaniz",
    "urbanismo",
    "rehabilit",
)
PCSP_NEGATIVE_MARKERS = (
    "mantenimiento",
    "conservacion",
    "limpieza",
    "residuos",
    "agencia de viajes",
    "microfilmes",
    "resonancia magnetica",
    "hemodialisis",
    "suministro",
    "reactivos",
    "formaldehido",
    "uniform",
)


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(
        url,
        headers={
            "Accept": "application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
        },
    )


def _parse_summary_fields(summary: str) -> dict[str, str]:
    plain = strip_html(summary) or ""
    fields: dict[str, str] = {}
    for raw_key, raw_value in SUMMARY_FIELD_PATTERN.findall(plain):
        key = normalize_text(raw_key).replace(" ", "_")
        value = raw_value.strip()
        if value:
            fields[key] = value
    return fields


def _extract_entry_link(entry: ET.Element) -> str | None:
    alternate_href: str | None = None
    for link in entry.findall("atom:link", ATOM_NS):
        href = (link.get("href") or "").strip()
        rel = (link.get("rel") or "alternate").strip()
        if not href:
            continue
        if rel == "alternate":
            return href
        if alternate_href is None:
            alternate_href = href
    return alternate_href


def _extract_detail_fields(detail_html: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for raw_key, raw_label in LABEL_PATTERN.findall(detail_html):
        key = raw_key.strip()
        value_match = re.search(
            rf'id="[^"]*:text_{re.escape(key)}[^"]*"[^>]*>(.*?)</(?:span|a)',
            detail_html,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if value_match is None:
            continue
        value = strip_html(value_match.group(1))
        if not value:
            continue
        fields[key] = value
        normalized_label = normalize_text(strip_html(raw_label) or key).replace(" ", "_")
        if normalized_label:
            fields[normalized_label] = value
    return fields


def _pick_value(mapping: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if value:
            return value
    return None


def _pick_deadline(fields: dict[str, str]) -> str | None:
    return parse_date_string(
        _pick_value(
            fields,
            "FechaPresentacionOferta",
            "end_date_for_the_submission_of_offers",
            "FechaSolicitudParticipacion",
            "end_date_for_requests_to_participate",
        )
    )


def _is_candidate_pcsp_notice(title: str, summary: str) -> bool:
    haystack = normalize_text(f"{title} {summary}")
    if any(marker in haystack for marker in PCSP_NEGATIVE_MARKERS):
        return False
    if any(marker in haystack for marker in PCSP_DESIGN_MARKERS):
        return True
    return any(marker in haystack for marker in PCSP_BUILT_MARKERS)


def _is_relevant_pcsp_notice(
    title: str,
    summary: str,
    detail_text: str,
    cpv_codes: list[str],
) -> bool:
    haystack = normalize_text(f"{title} {summary} {detail_text}")
    if any(marker in haystack for marker in PCSP_NEGATIVE_MARKERS):
        return False
    if any(code.startswith(DESIGN_CPV_PREFIXES) for code in cpv_codes):
        return True

    has_design_signal = is_design_relevant(title, summary, detail_text, cpv_codes=cpv_codes) or any(
        marker in haystack for marker in PCSP_DESIGN_MARKERS
    )
    if not has_design_signal:
        return False

    return has_built_environment_context(title, summary, detail_text) or any(
        marker in haystack for marker in PCSP_BUILT_MARKERS
    )


def collect_pcsp_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    fetcher = fetch_text or _default_fetch_text
    feed_xml = fetcher(source.base_url)
    root = ET.fromstring(feed_xml)

    documents: list[CollectedSourceDocument] = []
    max_candidates = max(limit * 10, 40)
    inspected = 0
    seen_urls: set[str] = set()
    seen_notice_ids: set[str] = set()

    for entry in root.findall("atom:entry", ATOM_NS):
        title = (entry.findtext("atom:title", default="", namespaces=ATOM_NS) or "").strip()
        summary = entry.findtext("atom:summary", default="", namespaces=ATOM_NS) or ""
        updated = parse_date_string(entry.findtext("atom:updated", default="", namespaces=ATOM_NS) or "")
        summary_fields = _parse_summary_fields(summary)
        state = (summary_fields.get("estado") or "").strip().upper()
        detail_url = _extract_entry_link(entry)

        if publication_date_from and updated and updated < publication_date_from:
            continue
        if not title or not detail_url or state not in LIVE_STATES:
            continue
        if detail_url in seen_urls:
            continue
        if not _is_candidate_pcsp_notice(title, summary):
            continue

        inspected += 1
        detail_html = fetcher(detail_url)
        detail_fields = _extract_detail_fields(detail_html)
        detail_text = " ".join(detail_fields.values())
        cpv_codes = extract_cpv_codes(_pick_value(detail_fields, "CPV", "cpv_code"))
        if not _is_relevant_pcsp_notice(title, summary, detail_text, cpv_codes):
            if inspected >= max_candidates:
                break
            continue

        deadline = _pick_deadline(detail_fields)
        notice_id = _pick_value(detail_fields, "Expediente", "file") or summary_fields.get("id_licitacion")
        if notice_id and notice_id in seen_notice_ids:
            continue
        estimated_value_raw = _pick_value(
            detail_fields,
            "ValorContrato",
            "estimated_value_of_the_contract",
            "Presupuesto",
            "base_bidding_budget_without_taxes",
        ) or summary_fields.get("importe")
        estimated_value = parse_money_value(estimated_value_raw)

        payload = json.dumps(
            {
                "title": _pick_value(detail_fields, "ObjetoContrato", "subject_of_the_contract") or title,
                "buyer": _pick_value(detail_fields, "OC", "contracting_party")
                or summary_fields.get("organo_de_contratacion"),
                "noticeId": notice_id,
                "deadline": deadline,
                "summary": strip_html(summary) or detail_text or title,
                "officialUrl": detail_url,
                "cpv": cpv_codes,
                "estimatedValueEur": estimated_value,
                "estimatedValueText": format_money_text(
                    amount=estimated_value_raw,
                    currency="EUR",
                    raw_text=estimated_value_raw,
                ),
                "opportunityType": "public_design_services_procurement",
                "procedureType": _pick_value(detail_fields, "Procedimiento", "procurement_procedure"),
                "implementationPath": "service_contract_award_after_competitive_selection",
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official PCSP syndication Atom entry enriched with the public detail page.",
                "publishedAt": updated,
            },
            ensure_ascii=False,
        )
        seen_urls.add(detail_url)
        if notice_id:
            seen_notice_ids.add(notice_id)
        documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
        if len(documents) >= limit:
            break
        if inspected >= max_candidates:
            break

    return documents
