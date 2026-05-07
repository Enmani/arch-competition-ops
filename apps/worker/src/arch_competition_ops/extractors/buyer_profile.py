from __future__ import annotations

import re
from urllib.parse import urljoin

from arch_competition_ops.collectors.common import extract_cpv_codes, strip_html
from arch_competition_ops.extractors.common import (
    build_base_record,
    parse_iso_date,
    parse_money_amount,
    pick_first_value,
    pick_list_value,
    pick_regex,
    try_load_json,
)
from arch_competition_ops.models import CompetitionRecord, SourceDefinition


def _infer_opportunity_type(title: str) -> str:
    normalized = title.lower()
    if any(marker in normalized for marker in ("competition", "contest", "concorso", "concours")):
        return "public_design_contest"
    return "public_design_services_procurement"


def _infer_implementation_path(opportunity_type: str) -> str:
    if opportunity_type == "public_design_contest":
        return "winner_or_winners_progress_to_negotiated_service_award"
    return "service_contract_award_after_competitive_selection"


def _extract_notice_id_from_url(source_url: str) -> str | None:
    match = re.search(r"/tenderId/(\d+)", source_url)
    if match:
        return match.group(1)

    match = re.search(r"/notice/([^/?#]+)", source_url)
    if match:
        return match.group(1)
    return None


def _clean_detail_title(raw_title: str | None) -> str | None:
    if not raw_title:
        return None
    cleaned = raw_title.strip()
    cleaned = re.sub(r"^\d+(?:[_/-]\d+)+(?:\s+)?", "", cleaned)
    return cleaned.strip() or raw_title.strip()


def _parse_detail_title(detail_html: str) -> str | None:
    raw_title = pick_regex(
        detail_html,
        [
            r'<h4[^>]*title="([^"]+)"',
            r"<h4[^>]*>\s*([^<]+)\s*</h4>",
            r"<h1[^>]*>\s*([^<]+)\s*</h1>",
            r"<title>([^<]+)</title>",
        ],
    )
    return _clean_detail_title(raw_title)


def _parse_detail_authority(detail_html: str) -> str | None:
    return pick_regex(
        detail_html,
        [
            r"Offizielle Bezeichnung:\s*([^<\n]+)",
            r"Name und Anschrift:</td><td>\s*([^<\n]+)",
            r"Ausschreibende Stelle:\s*(?:<strong>)?([^<\n]+)",
            r'<span[^>]*class="[^"]*\bkm1-topline\b[^"]*"[^>]*>\s*([^<]+)\s*</span>',
            r"Contracting Authority</strong></h6>\s*([^<\n]+)",
            r"Vergabestelle</strong></h6>\s*([^<\n]+)",
            r"Stazione appaltante[^:]*:\s*([^<\n]+)",
            r"Contracting authority[^:]*:\s*([^<\n]+)",
            r"Acheteur[^:]*:\s*([^<\n]+)",
        ],
    )


def _parse_detail_procedure(detail_html: str) -> str | None:
    return pick_regex(
        detail_html,
        [
            r"Verfahrensart:</td><td>\s*([^<\n]+)",
            r"Verfahrensart[^:]*:\s*([^<\n]+)",
            r"Procedure[^:]*:\s*([^<\n]+)",
        ],
    )


def _parse_detail_deadline(detail_html: str) -> str | None:
    return pick_regex(
        detail_html,
        [
            r"Frist für den Eingang der Angebote:\s*([^<\n]+)",
            r"Angebote sind einzureichen bis:</td><td>\s*([^<\n]+)",
            r"Einreichungsfrist:\s*(?:<strong>)?([^<\n]+)",
            r"Ablauf der Angebotsfrist[^:]*:\s*([^<\n]+)",
            r"Application deadline</div>\s*<div[^>]*>\s*([^<]+)",
            r"Offer period end</div>\s*<div[^>]*>\s*([^<]+)",
            r"Participation deadline</div>\s*<div[^>]*>\s*([^<]+)",
            r"Scadenza[^:]*:\s*([^<\n]+)",
            r"Deadline[^:]*:\s*([^<\n]+)",
        ],
    )


def _parse_detail_value(detail_html: str) -> str | None:
    return pick_regex(
        detail_html,
        [
            r"Gesch[aä]tzter Auftragswert[^:]*:\s*([^<\n]+)",
            r"Geschaetzter Auftragswert[^:]*:\s*([^<\n]+)",
            r"Auftragswert[^:]*:\s*([^<\n]+)",
            r"Valore stimato[^:]*:\s*([^<\n]+)",
            r"Estimated value[^:]*:\s*([^<\n]+)",
            r"Valeur estimée[^:]*:\s*([^<\n]+)",
        ],
    )


def _parse_detail_summary(detail_html: str) -> str | None:
    raw_summary = pick_regex(
        detail_html,
        [
            r"Verfahrensinhalt:\s*(.*?)\s*</p>",
            r"Beschreibung der Beschaffung</td><td>Beschreibung:\s*(.*?)</td>",
            r"Art der Leistung:</td><td>\s*(.*?)</td>",
            r"Menge und Umfang:</td><td>\s*(.*?)</td>",
            r"Brief Description</strong></h6>\s*(.*?)\s*(?:<h6|<!-- Termine|<!-- Dates|</body>)",
            r"Kurzbeschreibung</strong></h6>\s*(.*?)\s*(?:<h6|<!-- Termine|<!-- Dates|</body>)",
            r"Requisiti[^:]*:\s*([^<\n]+)",
            r"Requirements[^:]*:\s*([^<\n]+)",
        ],
    )
    return strip_html(raw_summary)


def _parse_detail_notice_id(detail_html: str) -> str | None:
    return pick_regex(
        detail_html,
        [
            r"Interne Kennung:\s*([^<\n]+)",
            r"Vergabenr\.</td><td>\s*([^<\n]+)",
            r"Vergabenr\.\s*([^<\n]+)",
            r"Ausschreibungsnummer:\s*(?:<strong>)?([^<\n]+)",
        ],
    )


def _parse_external_official_url(detail_html: str, source_url: str) -> str | None:
    href = pick_regex(
        detail_html,
        [
            r'href="(https://fbhh-evergabe\.web\.hamburg\.de/[^"]+)"',
            r"Adresse für die Einreichung \(URL\):\s*<a[^>]*href=\"([^\"]+)\"",
            r"unter \(URL:\)</td><td>\s*<a[^>]*href=\"([^\"]+)\"",
            r"Auftragsunterlagen[^<]*\(URL\):\s*<a[^>]*href=\"([^\"]+)\"",
        ],
    )
    if not href:
        return None
    return urljoin(source_url, href)


def _parse_brief_pdf_url(detail_html: str, source_url: str) -> str | None:
    href = pick_regex(
        detail_html,
        [
            r'href="([^"]+\.pdf)"',
        ],
    )
    if not href:
        return None
    return urljoin(source_url, href)


def parse_buyer_profile_notice(
    payload: str,
    source: SourceDefinition,
    source_url: str,
) -> CompetitionRecord:
    data = try_load_json(payload)
    if data:
        title = pick_first_value(data, ["title", "headline", "summary"])
        authority_name = pick_first_value(data, ["buyer", "authority", "contractingAuthority"])
        official_notice_id = pick_first_value(data, ["officialNoticeId", "noticeId", "id"])
        deadline_raw = pick_first_value(data, ["deadline", "deadlineAt"])
        value_raw = pick_first_value(data, ["estimatedValueEur", "estimatedValue"])
        procedure_type = pick_first_value(data, ["procedureType"])
        eligibility_summary = pick_first_value(data, ["summary", "description"])
        location_label = pick_first_value(data, ["location", "place", "city", "municipality"])
        cpv_codes = pick_list_value(data, ["cpv", "cpvCodes"])
        detail_html = data.get("detailHtml") if isinstance(data.get("detailHtml"), str) else ""
        official_url = None
        brief_pdf_url = None

        if detail_html:
            authority_name = _parse_detail_authority(detail_html) or authority_name
            official_notice_id = (
                _parse_detail_notice_id(detail_html)
                or official_notice_id
                or _extract_notice_id_from_url(source_url)
            )
            deadline_raw = _parse_detail_deadline(detail_html) or deadline_raw
            value_raw = _parse_detail_value(detail_html) or value_raw
            procedure_type = _parse_detail_procedure(detail_html) or procedure_type
            eligibility_summary = _parse_detail_summary(detail_html) or eligibility_summary
            official_url = _parse_external_official_url(detail_html, source_url)
            brief_pdf_url = _parse_brief_pdf_url(detail_html, source_url)
            if not cpv_codes:
                cpv_codes = extract_cpv_codes(detail_html)
            evidence_level = "official_notice"
            evidence_note = (
                "Parsed from an official municipal procurement listing and its linked detail page."
            )
        else:
            official_notice_id = official_notice_id or _extract_notice_id_from_url(source_url)
            official_url = None
            brief_pdf_url = None
            evidence_level = "official_listing"
            evidence_note = (
                "Parsed from an official municipal procurement listing. Confirm attachments and full detail page."
            )
    else:
        title = pick_regex(payload, [r"<h1[^>]*>\s*([^<]+)</h1>", r"<title>([^<]+)</title>"]) or _parse_detail_title(payload)
        authority_name = pick_regex(
            payload,
            [
                r"Offizielle Bezeichnung:\s*([^<\n]+)",
                r"Name und Anschrift:</td><td>\s*([^<\n]+)",
                r"Ausschreibende Stelle:\s*(?:<strong>)?([^<\n]+)",
                r"Stazione appaltante[^:]*:\s*([^<\n]+)",
                r"Contracting authority[^:]*:\s*([^<\n]+)",
                r"Acheteur[^:]*:\s*([^<\n]+)",
            ],
        ) or _parse_detail_authority(payload)
        official_notice_id = pick_regex(
            payload,
            [
                r"Interne Kennung:\s*([^<\n]+)",
                r"Vergabenr\.</td><td>\s*([^<\n]+)",
                r"Ausschreibungsnummer:\s*(?:<strong>)?([^<\n]+)",
                r"Riferimento[^:]*:\s*([^<\n]+)",
                r"Reference[^:]*:\s*([^<\n]+)",
            ],
        ) or _extract_notice_id_from_url(source_url)
        deadline_raw = pick_regex(
            payload,
            [
                r"Frist für den Eingang der Angebote:\s*([^<\n]+)",
                r"Angebote sind einzureichen bis:</td><td>\s*([^<\n]+)",
                r"Einreichungsfrist:\s*(?:<strong>)?([^<\n]+)",
                r"Scadenza[^:]*:\s*([^<\n]+)",
                r"Deadline[^:]*:\s*([^<\n]+)",
            ],
        ) or _parse_detail_deadline(payload)
        value_raw = pick_regex(
            payload,
            [
                r"Gesch[aä]tzter Auftragswert[^:]*:\s*([^<\n]+)",
                r"Geschaetzter Auftragswert[^:]*:\s*([^<\n]+)",
                r"Auftragswert[^:]*:\s*([^<\n]+)",
                r"Valore stimato[^:]*:\s*([^<\n]+)",
                r"Estimated value[^:]*:\s*([^<\n]+)",
                r"Valeur estimée[^:]*:\s*([^<\n]+)",
            ],
        ) or _parse_detail_value(payload)
        procedure_type = pick_regex(
            payload,
            [r"Procedura[^:]*:\s*([^<\n]+)", r"Procedure[^:]*:\s*([^<\n]+)"],
        ) or _parse_detail_procedure(payload)
        eligibility_summary = pick_regex(
            payload,
            [r"Requisiti[^:]*:\s*([^<\n]+)", r"Requirements[^:]*:\s*([^<\n]+)"],
        ) or _parse_detail_summary(payload)
        cpv_raw = pick_regex(payload, [r"CPV[^:]*:\s*([^<\n]+)"])
        cpv_codes = [code.strip() for code in re.split(r"[,;\s]+", cpv_raw or "") if code.strip()] or extract_cpv_codes(payload)
        official_url = _parse_external_official_url(payload, source_url)
        brief_pdf_url = _parse_brief_pdf_url(payload, source_url)
        evidence_level = "official_notice"
        evidence_note = "Parsed from a municipal buyer-profile page. Confirm attachments and legal notice pages."

    if not title:
        raise ValueError("Buyer profile parser could not determine a title from the payload")

    opportunity_type = _infer_opportunity_type(title)
    return build_base_record(
        source,
        source_url,
        title=title,
        authority_name=authority_name,
        opportunity_type=opportunity_type,
        procedure_type=procedure_type,
        official_notice_id=official_notice_id,
        deadline_at=parse_iso_date(deadline_raw),
        estimated_contract_value_eur=parse_money_amount(value_raw),
        eligibility_summary=eligibility_summary,
        implementation_path=_infer_implementation_path(opportunity_type),
        cpv_codes=cpv_codes,
        evidence_note=evidence_note,
        evidence_level=evidence_level,
        official_url=official_url,
        brief_pdf_url=brief_pdf_url,
        estimated_contract_value_text=value_raw,
        location_label=location_label if data else None,
    )
