from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit

import requests

from arch_competition_ops.browser import render_page
from arch_competition_ops.collectors.common import normalize_text, strip_html
from arch_competition_ops.extractors.common import pick_first_value, try_load_json
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.settings import Settings

BLOCKED_OFFICIAL_DOMAINS = {
    "simap.ch",
    "www.simap.ch",
    "konkurado.ch",
    "www.konkurado.ch",
}
PROCUREMENT_PATH_MARKERS = (
    "ausschreibung",
    "ausschreibungen",
    "wettbewerb",
    "projekte-und-ausschreibungen",
    "planung-ausfuehrung",
    "hochbauvorhaben",
)
STOPWORDS = {
    "concours",
    "ouvert",
    "selection",
    "sous",
    "reserve",
    "obtention",
    "credit",
    "lotissement",
    "renovation",
    "partielle",
    "densification",
    "fuer",
    "pour",
    "selection",
    "maitre",
    "oeuvre",
    "offener",
    "projektwettbewerb",
    "generalplanende",
    "verfahren",
    "project",
    "competition",
    "competitione",
    "planung",
    "projets",
    "prozedura",
    "verfahren",
    "wohnen",
    "stadt",
    "zurich",
}

_SITEMAP_URL_CACHE: dict[str, list[str]] = {}
_TEXT_CACHE: dict[str, str] = {}


@dataclass(frozen=True)
class OfficialPageCandidate:
    official_url: str
    html: str
    pdf_links: list[str]
    used_browser: bool = False


def clear_verifier_caches() -> None:
    _SITEMAP_URL_CACHE.clear()
    _TEXT_CACHE.clear()


def _fetch_text(url: str) -> str:
    response = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0"},
        timeout=30,
    )
    response.raise_for_status()
    response.encoding = response.encoding or "utf-8"
    return response.text


def _fetch_text_cached(url: str) -> str:
    if url not in _TEXT_CACHE:
        _TEXT_CACHE[url] = _fetch_text(url)
    return _TEXT_CACHE[url]


def _domain_from_url(url: str | None) -> str | None:
    if not url:
        return None
    host = urlsplit(url).netloc.lower().strip()
    return host or None


def _is_blocked_official_url(url: str | None) -> bool:
    domain = _domain_from_url(url)
    return domain in BLOCKED_OFFICIAL_DOMAINS if domain else True


def _derive_candidate_domains(*, authority_email: str | None, official_url: str | None) -> list[str]:
    domains: list[str] = []

    if authority_email and "@" in authority_email:
        email_domain = authority_email.rsplit("@", 1)[-1].strip().lower()
        if email_domain:
            domains.append(email_domain)
            if not email_domain.startswith("www."):
                domains.append(f"www.{email_domain}")

            labels = email_domain.split(".")
            if len(labels) == 2 and not labels[0].startswith("stadt-"):
                municipal_domain = f"stadt-{email_domain}"
                domains.append(municipal_domain)
                domains.append(f"www.{municipal_domain}")

    official_domain = _domain_from_url(official_url)
    if official_domain and official_domain not in BLOCKED_OFFICIAL_DOMAINS:
        domains.insert(0, official_domain)
        if not official_domain.startswith("www."):
            domains.insert(1, f"www.{official_domain}")

    deduped: list[str] = []
    seen: set[str] = set()
    for domain in domains:
        cleaned = domain.strip().lower()
        if not cleaned or cleaned in seen:
            continue
        seen.add(cleaned)
        deduped.append(cleaned)
    return deduped


def _extract_sitemap_urls(robots_text: str, domain: str) -> list[str]:
    sitemap_urls = [
        match.strip()
        for match in re.findall(r"(?im)^\s*sitemap:\s*(\S+)\s*$", robots_text.replace("\xa0", " "))
        if match.strip()
    ]
    if sitemap_urls:
        return sitemap_urls
    return [f"https://{domain}/sitemap.xml"]


def _extract_loc_values(xml_text: str) -> list[str]:
    return [match.strip() for match in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml_text, flags=re.I)]


def _collect_sitemap_target_urls(sitemap_url: str, *, depth: int = 0) -> list[str]:
    if depth > 2:
        return []

    xml_text = _fetch_text_cached(sitemap_url)
    loc_values = _extract_loc_values(xml_text)
    if not loc_values:
        return []

    if "<sitemapindex" in xml_text[:500].lower():
        urls: list[str] = []
        for nested_sitemap_url in loc_values[:20]:
            urls.extend(_collect_sitemap_target_urls(nested_sitemap_url, depth=depth + 1))
        return urls

    return loc_values


def _domain_sitemap_urls(domain: str) -> list[str]:
    cached = _SITEMAP_URL_CACHE.get(domain)
    if cached is not None:
        return cached

    try:
        robots_text = _fetch_text_cached(f"https://{domain}/robots.txt")
    except Exception:  # noqa: BLE001
        robots_text = ""

    urls: list[str] = []
    for sitemap_url in _extract_sitemap_urls(robots_text, domain):
        try:
            urls.extend(_collect_sitemap_target_urls(sitemap_url))
        except Exception:  # noqa: BLE001
            continue

    deduped: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)

    _SITEMAP_URL_CACHE[domain] = deduped
    return deduped


def _keyword_tokens(*chunks: str | None) -> list[str]:
    tokens: list[str] = []
    for chunk in chunks:
        if not chunk:
            continue
        for token in normalize_text(chunk).split():
            if len(token) < 6 or token in STOPWORDS or token.isdigit():
                continue
            if token not in tokens:
                tokens.append(token)
    return tokens[:12]


def _score_candidate_url(url: str, title_tokens: list[str]) -> int:
    normalized_url = normalize_text(url)
    score = 0
    for token in title_tokens:
        if token in normalized_url:
            score += len(token)
    if url.lower().endswith(".html"):
        score += 15
    if any(marker in url.lower() for marker in PROCUREMENT_PATH_MARKERS):
        score += 10
    if "/content/dam/" in url.lower():
        score -= 20
    return score


def _extract_html_title(html: str) -> str | None:
    match = re.search(r"<title>([^<]+)</title>", html, flags=re.I)
    if not match:
        return None
    return match.group(1).strip()


def _extract_canonical_url(html: str, fallback_url: str) -> str:
    match = re.search(
        r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"',
        html,
        flags=re.I,
    )
    if match:
        return match.group(1).strip()
    return fallback_url


def _page_match_score(
    *,
    candidate_url: str,
    html: str,
    title_tokens: list[str],
    authority_name: str | None,
) -> int:
    page_title = normalize_text(_extract_html_title(html) or "")
    page_text = normalize_text(strip_html(html) or "")
    score = _score_candidate_url(candidate_url, title_tokens)
    for token in title_tokens:
        if token in page_title:
            score += len(token) * 4
        elif token in page_text:
            score += len(token) * 2
    for token in _keyword_tokens(authority_name):
        if token in page_text:
            score += len(token)
    return score


def _extract_prize_summary(html: str) -> str | None:
    plain = strip_html(html)
    if not plain:
        return None

    normalized = re.sub(r"\s+", " ", plain.replace("\xa0", " ")).strip()
    patterns = [
        r"(Preisgeld\s*CHF\s*[\d\s'.,]+(?:exkl\.\s*MWST)?)",
        r"(Wettbewerbssumme(?:\s+total)?\s*CHF\s*[\d\s'.,]+(?:exkl\.\s*MWST)?)",
        r"(Preissumme\s*CHF\s*[\d\s'.,]+(?:exkl\.\s*MWST)?)",
        r"(Prize\s+(?:money|pool)\s*[A-Z]{3}\s*[\d\s'.,]+)",
        r"(Honorarium(?:\s+and\s+prize\s+pool)?\s*[A-Z]{3}\s*[\d\s'.,]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, normalized, flags=re.I)
        if match:
            return match.group(1).strip()
    return None


def _browser_storage_dir() -> Path:
    settings = Settings()
    return settings.resolve_path(settings.browser_storage_dir)


def _browser_candidate(
    *,
    candidate_url: str,
    title_tokens: list[str],
    authority_name: str | None,
) -> OfficialPageCandidate | None:
    try:
        browser_page = render_page(
            url=candidate_url,
            storage_dir=_browser_storage_dir(),
            timeout_ms=20000,
        )
    except Exception:  # noqa: BLE001
        return None

    browser_url = browser_page.final_url or candidate_url
    score = _page_match_score(
        candidate_url=browser_url,
        html=browser_page.html,
        title_tokens=title_tokens,
        authority_name=authority_name,
    )
    if score < 30:
        return None

    return OfficialPageCandidate(
        official_url=browser_url,
        html=browser_page.html,
        pdf_links=browser_page.pdf_links,
        used_browser=True,
    )


def _best_official_candidate(
    *,
    domains: list[str],
    title_tokens: list[str],
    authority_name: str | None,
) -> OfficialPageCandidate | None:
    if not domains or not title_tokens:
        return None

    candidate_urls: list[tuple[int, str]] = []
    for domain in domains:
        for url in _domain_sitemap_urls(domain):
            score = _score_candidate_url(url, title_tokens)
            if score <= 0:
                continue
            candidate_urls.append((score, url))

    if not candidate_urls:
        return None

    candidate_urls.sort(key=lambda item: item[0], reverse=True)
    for _, candidate_url in candidate_urls[:5]:
        try:
            html = _fetch_text_cached(candidate_url)
        except Exception:  # noqa: BLE001
            browser_candidate = _browser_candidate(
                candidate_url=candidate_url,
                title_tokens=title_tokens,
                authority_name=authority_name,
            )
            if browser_candidate is not None:
                return browser_candidate
            continue

        score = _page_match_score(
            candidate_url=candidate_url,
            html=html,
            title_tokens=title_tokens,
            authority_name=authority_name,
        )
        if score < 30:
            browser_candidate = _browser_candidate(
                candidate_url=candidate_url,
                title_tokens=title_tokens,
                authority_name=authority_name,
            )
            if browser_candidate is not None:
                return browser_candidate
            continue
        return OfficialPageCandidate(
            official_url=_extract_canonical_url(html, candidate_url),
            html=html,
            pdf_links=[],
        )

    return None


def _append_evidence_note(existing: str | None, addition: str) -> str:
    if not existing:
        return addition
    if addition in existing:
        return existing
    return f"{existing} {addition}"


def _has_material_secondary_evidence(*, prize_summary: str | None, pdf_links: list[str]) -> bool:
    return bool(prize_summary or pdf_links)


def verify_simap_record(
    source: SourceDefinition,
    payload: str,
    source_url: str,
    record: CompetitionRecord,
) -> CompetitionRecord:
    del source, source_url

    data = try_load_json(payload)
    if not data:
        return record

    if record.prize_summary and not _is_blocked_official_url(record.official_url):
        return record

    authority_email = pick_first_value(data, ["authorityEmail", "authorityContactEmail"])
    if not record.documents_portal_url:
        record.documents_portal_url = pick_first_value(data, ["documentsPortalUrl"])
    current_official_url = record.official_url or pick_first_value(data, ["officialUrl"])
    domains = _derive_candidate_domains(
        authority_email=authority_email,
        official_url=current_official_url,
    )
    title_tokens = _keyword_tokens(record.title)
    if not title_tokens:
        title_tokens = _keyword_tokens(record.title, pick_first_value(data, ["description"]))

    if not domains or not title_tokens:
        return record

    best_candidate = _best_official_candidate(
        domains=domains,
        title_tokens=title_tokens,
        authority_name=record.authority_name,
    )
    if not best_candidate:
        return record

    official_url = best_candidate.official_url
    official_html = best_candidate.html
    prize_summary = _extract_prize_summary(official_html)
    pdf_links = best_candidate.pdf_links
    used_browser = best_candidate.used_browser

    if (not prize_summary or not pdf_links) and not used_browser:
        browser_candidate = _browser_candidate(
            candidate_url=official_url,
            title_tokens=title_tokens,
            authority_name=record.authority_name,
        )
        if browser_candidate is not None:
            official_url = browser_candidate.official_url
            if not prize_summary:
                prize_summary = _extract_prize_summary(browser_candidate.html)
            if not pdf_links:
                pdf_links = browser_candidate.pdf_links
            used_browser = True

    if not _has_material_secondary_evidence(prize_summary=prize_summary, pdf_links=pdf_links):
        return record

    record.official_url = official_url
    if prize_summary and not record.prize_summary:
        record.prize_summary = prize_summary
    if pdf_links and not record.brief_pdf_url:
        record.brief_pdf_url = pdf_links[0]
    if record.documents_portal_url and record.documents_portal_url != record.official_url:
        record.evidence_note = _append_evidence_note(
            record.evidence_note,
            "External document portal retained from source payload for competition materials access.",
        )
    record.last_verified_at = datetime.now(timezone.utc)
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
