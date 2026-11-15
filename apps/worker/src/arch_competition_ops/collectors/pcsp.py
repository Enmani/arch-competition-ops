"""Spain's public sector procurement platform (PCSP), Atom syndication feed.

Checked against the live feed in 2026-11:

* The feed is a chain of files. The first holds the latest few dozen entries; each file's
  ``<link rel="next">`` names an archive file (``..._YYYYMMDD_HHMMSS[_n].atom``) of about 500
  entries and 13-17 MB, newest first. A 7-day window (2026-11-08 to 2026-11-14) was 31 files,
  14,787 entries and 12,754 distinct tenders; the server does not compress them.
* An entry is one update of a tender: the same tender reappears each time its state changes, so
  the newest entry in the window is its current state.
* Each entry embeds the CODICE ``ContractFolderStatus``: ``ContractFolderStatusCode`` (PRE prior
  notice, PUB open for bids, EV under evaluation, ADJ awarded, RES resolved, ANUL cancelled),
  ``TenderingProcess/ProcedureCode`` (``8`` = design contest, "concurso de proyectos") and the
  CPV codes of the project and its lots (``ItemClassificationCode``). Of the 2,960 open tenders
  in that window, 249 had a CPV code under 71 or 7993, 22 had none (all property leases and
  sales) and 2 more were design contests outside that CPV scope.

The AI design scope is defined in ``collectors.design_scope`` and applied locally to each entry,
including design-and-build contracts ("redacción del proyecto y ejecución de las obras") whose
title names the model whatever their CPV codes.
"""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from collections.abc import Callable, Iterator
from datetime import date, timedelta
from urllib.parse import parse_qs, urlsplit

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    DEFAULT_HEADERS,
    parse_money_value,
)
from arch_competition_ops.collectors.design_scope import has_design_cpv, is_design_and_build
from arch_competition_ops.collectors.relevance import (
    has_built_environment_context,
    is_design_relevant,
)
from arch_competition_ops.http import get_default_client
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string, slash_order_for_jurisdiction
from arch_competition_ops.normalizers.money import format_money_text
from arch_competition_ops.normalizers.text import extract_cpv_codes, normalize_text, strip_html

logger = logging.getLogger(__name__)

ATOM_NS = {"atom": "http://www.w3.org/2005/Atom"}
DEFAULT_LOOKBACK_DAYS = 7
# A 2026-11 week was 31 feed files; the cap leaves room for a longer window and stops a loop.
FEED_MAX_FILES = 80
# Archive files are 13-17 MB; the cap only stops a runaway response.
FEED_MAX_BYTES = 50 * 1024 * 1024
FEED_TIMEOUT_SECONDS = 120.0
# AI scope (``collectors.design_scope``), or a design contest whatever its CPV code; only tenders
# still open for bids.
DESIGN_CONTEST_PROCEDURE_CODE = "8"
OPEN_FOLDER_STATES = frozenset({"PUB"})
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


FetchText = Callable[[str], str]


def _default_fetch_text(url: str) -> str:
    # Feed files and detail pages share one fetcher; the larger cap and timeout are for the feed.
    return get_default_client().get_text(
        url,
        headers={
            **DEFAULT_HEADERS,
            "Accept": "application/atom+xml, application/xml;q=0.9, text/html;q=0.8, */*;q=0.5",
        },
        max_bytes=FEED_MAX_BYTES,
        timeout=FEED_TIMEOUT_SECONDS,
    )


def _window_start(publication_date_from: str | None) -> str:
    if publication_date_from:
        return date.fromisoformat(publication_date_from).isoformat()
    return (clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)).isoformat()


def _feed_link(root: ET.Element, rel: str) -> str | None:
    for link in root.findall("atom:link", ATOM_NS):
        href = (link.get("href") or "").strip()
        if href and (link.get("rel") or "").strip() == rel:
            return href
    return None


def _feed_entries(fetcher: FetchText, first_url: str, window_start: str) -> Iterator[ET.Element]:
    """Entries updated inside the window, newest first, following the feed's ``next`` links.

    Files are read one at a time and only as long as the caller keeps asking. Reading stops
    after the first file that reaches entries older than the window.
    """
    url: str | None = first_url
    visited: set[str] = set()
    for _ in range(FEED_MAX_FILES):
        if url is None or url in visited:
            return
        visited.add(url)
        root = ET.fromstring(fetcher(url))
        reached_older = False
        for entry in root.findall("atom:entry", ATOM_NS):
            updated = parse_date_string(
                entry.findtext("atom:updated", default="", namespaces=ATOM_NS) or ""
            )
            if updated and updated < window_start:
                reached_older = True
                continue
            yield entry
        if reached_older:
            return
        url = _feed_link(root, "next")
    if url is not None and url not in visited:
        logger.warning(
            "PCSP feed paging stopped after %d files; older entries were not read", FEED_MAX_FILES
        )


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _entry_codes(entry: ET.Element) -> tuple[str | None, str | None, list[str]]:
    """``(folder status, procedure code, CPV codes)`` from the entry's CODICE block."""
    status = procedure = None
    cpv_codes: list[str] = []
    for element in entry.iter():
        name = _local_name(element.tag)
        text = (element.text or "").strip()
        if name == "ContractFolderStatusCode" and status is None:
            status = text.upper() or None
        elif name == "ProcedureCode" and procedure is None:
            procedure = text or None
        elif name == "ItemClassificationCode":
            code = text[:8]
            if len(code) == 8 and code.isdigit() and code not in cpv_codes:
                cpv_codes.append(code)
    return status, procedure, cpv_codes


def _in_ai_scope(
    status: str | None, procedure: str | None, cpv_codes: list[str], title: str
) -> bool:
    # A missing state or CPV code cannot rule a tender out; only stated facts exclude it.
    if status is not None and status not in OPEN_FOLDER_STATES:
        return False
    if procedure == DESIGN_CONTEST_PROCEDURE_CODE or not cpv_codes:
        return True
    return has_design_cpv(cpv_codes) or is_design_and_build(title)


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


def _detail_belongs_to(detail_fields: dict[str, str], detail_url: str) -> bool:
    """The portal can answer a deeplink with a shell or with another tender held in its session.

    The page states its own deeplink; anything else must not supply this notice's facts.
    """
    link = _pick_value(detail_fields, "EnlaceLic", "link_to_the_bidding")
    if not link:
        return False
    page_id = parse_qs(urlsplit(link).query).get("idEvl")
    requested_id = parse_qs(urlsplit(detail_url).query).get("idEvl")
    return page_id == requested_id if requested_id else link == detail_url


def _pick_value(mapping: dict[str, str], *keys: str) -> str | None:
    for key in keys:
        value = mapping.get(key)
        if value:
            return value
    return None


def _pick_deadline(fields: dict[str, str], source: SourceDefinition) -> str | None:
    return parse_date_string(
        _pick_value(
            fields,
            "FechaPresentacionOferta",
            "end_date_for_the_submission_of_offers",
            "FechaSolicitudParticipacion",
            "end_date_for_requests_to_participate",
        ),
        # The detail page prints dd/mm/yyyy; the order comes from the source's jurisdiction.
        slash_order=slash_order_for_jurisdiction(source.jurisdiction),
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
    fetch_text: FetchText | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    fetcher = fetch_text or _default_fetch_text
    documents: list[CollectedSourceDocument] = []
    max_candidates = max(limit * 10, 40)
    inspected = 0
    # Tenders already decided by a newer entry in the window (emitted or skipped).
    seen_urls: set[str] = set()
    seen_notice_ids: set[str] = set()

    for entry in _feed_entries(fetcher, source.base_url, _window_start(publication_date_from)):
        title = (entry.findtext("atom:title", default="", namespaces=ATOM_NS) or "").strip()
        summary = entry.findtext("atom:summary", default="", namespaces=ATOM_NS) or ""
        updated = parse_date_string(
            entry.findtext("atom:updated", default="", namespaces=ATOM_NS) or ""
        )
        summary_fields = _parse_summary_fields(summary)
        detail_url = _extract_entry_link(entry)

        if not title or not detail_url or detail_url in seen_urls:
            continue
        seen_urls.add(detail_url)
        status, procedure, entry_cpv_codes = _entry_codes(entry)
        state = status or (summary_fields.get("estado") or "").strip().upper()
        if include_unclassified:
            # Scope on the entry's structured codes before any detail page is fetched.
            if not _in_ai_scope(state or None, procedure, entry_cpv_codes, title):
                continue
        elif state not in LIVE_STATES or not _is_candidate_pcsp_notice(title, summary):
            continue

        inspected += 1
        detail_html = fetcher(detail_url)
        detail_fields = _extract_detail_fields(detail_html)
        if not _detail_belongs_to(detail_fields, detail_url):
            # Keep the Atom entry as the evidence; an empty page tells enrichment not to refetch.
            detail_html, detail_fields = "", {}
        detail_text = " ".join(detail_fields.values())
        cpv_codes = (
            extract_cpv_codes(_pick_value(detail_fields, "CPV", "cpv_code")) or entry_cpv_codes
        )
        if not include_unclassified and (
            not _is_relevant_pcsp_notice(title, summary, detail_text, cpv_codes)
        ):
            if inspected >= max_candidates:
                break
            continue

        deadline = _pick_deadline(detail_fields, source)
        notice_id = _pick_value(detail_fields, "Expediente", "file") or summary_fields.get(
            "id_licitacion"
        )
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
                "title": _pick_value(detail_fields, "ObjetoContrato", "subject_of_the_contract")
                or title,
                "buyer": _pick_value(detail_fields, "OC", "contracting_party")
                or summary_fields.get("organo_de_contratacion"),
                "noticeId": notice_id,
                "deadline": deadline,
                **({"rawNoticeHtml": detail_html} if include_unclassified else {}),
                **(
                    {"rawNotice": ET.tostring(entry, encoding="unicode")}
                    if include_unclassified
                    else {}
                ),
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
                "procedureType": _pick_value(
                    detail_fields, "Procedimiento", "procurement_procedure"
                ),
                "evidenceLevel": "official_notice",
                "evidenceNote": (
                    "Official PCSP syndication Atom entry enriched with the public detail page."
                ),
                "publishedAt": updated,
            },
            ensure_ascii=False,
        )
        if notice_id:
            seen_notice_ids.add(notice_id)
        documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
        if len(documents) >= limit:
            break
        if inspected >= max_candidates:
            break

    return documents
