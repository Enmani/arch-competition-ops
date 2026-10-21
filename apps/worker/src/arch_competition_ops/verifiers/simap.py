"""simap enrichment: upgrade a platform-hosted notice with the authority's own page.

The simap payload usually only links to simap/konkurado. When the authority's own page for the
same project can be found (see ``authority_pages``), the record gains that page as ``official_url``
and, if the page is a high-confidence match, its prize money and attached brief PDF.
"""

from __future__ import annotations

import re

from arch_competition_ops import clock
from arch_competition_ops.extractors.common import pick_first_value, try_load_json
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.settings import Settings
from arch_competition_ops.verifiers.authority_pages import (
    OfficialPageCandidate,
    best_official_candidate,
    browser_candidate,
    derive_candidate_domains,
    is_blocked_official_url,
    keyword_tokens,
)

_PRIZE_PATTERNS = (
    r"(Preisgeld\s*CHF\s*[\d\s'.,]+(?:exkl\.\s*MWST)?)",
    r"(Wettbewerbssumme(?:\s+total)?\s*CHF\s*[\d\s'.,]+(?:exkl\.\s*MWST)?)",
    r"(Preissumme\s*CHF\s*[\d\s'.,]+(?:exkl\.\s*MWST)?)",
    r"(Prize\s+(?:money|pool)\s*[A-Z]{3}\s*[\d\s'.,]+)",
    r"(Honorarium(?:\s+and\s+prize\s+pool)?\s*[A-Z]{3}\s*[\d\s'.,]+)",
)


def _extract_prize_summary(html: str) -> str | None:
    plain = strip_html(html)
    if not plain:
        return None

    normalized = re.sub(r"\s+", " ", plain.replace("\xa0", " ")).strip()
    for pattern in _PRIZE_PATTERNS:
        match = re.search(pattern, normalized, flags=re.I)
        if match:
            return match.group(1).strip()
    return None


def _append_evidence_note(existing: str | None, addition: str) -> str:
    if not existing:
        return addition
    if addition in existing:
        return existing
    return f"{existing} {addition}"


def verify_simap_record(
    source: SourceDefinition,
    payload: str,
    source_url: str,
    record: CompetitionRecord,
    settings: Settings,
) -> CompetitionRecord:
    del source, source_url

    data = try_load_json(payload)
    if not data:
        return record

    if record.prize_summary and not is_blocked_official_url(record.official_url):
        return record

    authority_email = pick_first_value(data, ["authorityEmail", "authorityContactEmail"])
    if not record.documents_portal_url:
        record.documents_portal_url = pick_first_value(data, ["documentsPortalUrl"])
    current_official_url = record.official_url or pick_first_value(data, ["officialUrl"])
    domains = derive_candidate_domains(
        authority_email=authority_email,
        official_url=current_official_url,
    )
    title_tokens = keyword_tokens(record.title)
    if not title_tokens:
        title_tokens = keyword_tokens(record.title, pick_first_value(data, ["description"]))

    if not domains or not title_tokens:
        return record

    best_candidate = best_official_candidate(
        domains=domains, title_tokens=title_tokens, settings=settings
    )
    if not best_candidate:
        return record

    official_url = best_candidate.official_url
    # Facts are copied off the page only when it matches the notice with high confidence; a page
    # that merely clears the (lower) acceptance bar can still become official_url.
    prize_summary = (
        _extract_prize_summary(best_candidate.html)
        if best_candidate.match.high_confidence
        else None
    )
    pdf_links = best_candidate.pdf_links if best_candidate.match.high_confidence else []
    used_browser = best_candidate.used_browser

    if (not prize_summary or not pdf_links) and not used_browser:
        rendered: OfficialPageCandidate | None = browser_candidate(
            candidate_url=official_url,
            title_tokens=title_tokens,
            domains=domains,
            settings=settings,
        )
        if rendered is not None:
            official_url = rendered.official_url
            if rendered.match.high_confidence:
                prize_summary = prize_summary or _extract_prize_summary(rendered.html)
                pdf_links = pdf_links or rendered.pdf_links
            used_browser = True

    if not (prize_summary or pdf_links):
        return record

    record.official_url = official_url
    if prize_summary and not record.prize_summary:
        record.prize_summary = prize_summary
    if pdf_links and not record.brief_pdf_url:
        record.brief_pdf_url = pdf_links[0]
    if record.documents_portal_url and record.documents_portal_url != record.official_url:
        record.evidence_note = _append_evidence_note(
            record.evidence_note,
            "External document portal retained from source payload for competition materials "
            "access.",
        )
    record.last_verified_at = clock.now_utc()
    record.evidence_note = _append_evidence_note(
        record.evidence_note,
        "Official secondary verification matched an authority page via sitemap discovery.",
    )
    if used_browser:
        record.evidence_note = _append_evidence_note(
            record.evidence_note,
            "Crawlee browser fallback rendered the authority page to recover missing DOM evidence.",
        )
    return record
