"""Find an authority's own page for a procurement notice published on a third-party platform.

Used by the simap verifier. The search is: derive the authority's domains, read their sitemaps,
rank URLs by title-token overlap, fetch the best few pages, and accept a page only when its own
``<title>``/``<h1>`` carries the notice's distinctive title tokens (see ``PageMatch``).

Acceptance deliberately ignores URL suffix and path bonuses (``.html``, ``/ausschreibungen/``):
those only rank candidates. A page is accepted on title-token evidence plus the domain match that
the candidate generation already enforces, never on URL shape alone.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

from arch_competition_ops.browser import render_page
from arch_competition_ops.http import HttpError, get_default_client
from arch_competition_ops.normalizers.text import normalize_text, strip_html
from arch_competition_ops.settings import Settings

logger = logging.getLogger(__name__)

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
    "wohnen",
    "stadt",
    "zurich",
}
MAX_PAGE_BYTES = 5 * 1024 * 1024
MAX_SITEMAPS_PER_INDEX = 20
MAX_CANDIDATE_PAGES = 5
# Distinct title tokens that must appear in the page's own title/heading (or all of them when the
# notice title only has fewer distinctive tokens).
REQUIRED_TITLE_TOKEN_HITS = 2

_SITEMAP_URL_CACHE: dict[str, list[str]] = {}
_TEXT_CACHE: dict[str, str] = {}


@dataclass(frozen=True)
class PageMatch:
    """How well a fetched page matches the notice.

    ``title_hits`` counts notice-title tokens found in the page ``<title>``/``<h1>``;
    ``body_hits`` counts further tokens found only in the visible text.
    """

    title_hits: int
    body_hits: int
    required: int

    @property
    def accepted(self) -> bool:
        """Enough evidence to call the page the authority's page for this notice."""
        return self.title_hits >= max(1, self.required)

    @property
    def high_confidence(self) -> bool:
        """Strong enough to copy facts (prize money) off the page."""
        return self.accepted and (
            self.required <= 1 or self.title_hits >= REQUIRED_TITLE_TOKEN_HITS
        )


@dataclass(frozen=True)
class OfficialPageCandidate:
    official_url: str
    html: str
    pdf_links: list[str]
    match: PageMatch
    used_browser: bool = False


def clear_verifier_caches() -> None:
    _SITEMAP_URL_CACHE.clear()
    _TEXT_CACHE.clear()


def _fetch_text(url: str) -> str:
    return get_default_client().get_text(
        url, headers={"User-Agent": "Mozilla/5.0"}, max_bytes=MAX_PAGE_BYTES
    )


def _fetch_text_cached(url: str) -> str:
    if url not in _TEXT_CACHE:
        _TEXT_CACHE[url] = _fetch_text(url)
    return _TEXT_CACHE[url]


def domain_from_url(url: str | None) -> str | None:
    if not url:
        return None
    host = urlsplit(url).netloc.lower().strip()
    return host or None


def is_blocked_official_url(url: str | None) -> bool:
    domain = domain_from_url(url)
    return domain in BLOCKED_OFFICIAL_DOMAINS if domain else True


def derive_candidate_domains(*, authority_email: str | None, official_url: str | None) -> list[str]:
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

    official_domain = domain_from_url(official_url)
    if official_domain and official_domain not in BLOCKED_OFFICIAL_DOMAINS:
        domains.insert(0, official_domain)
        if not official_domain.startswith("www."):
            domains.insert(1, f"www.{official_domain}")

    return list(
        dict.fromkeys(cleaned for cleaned in (d.strip().lower() for d in domains) if cleaned)
    )


def _bare_host(host: str) -> str:
    return host.removeprefix("www.")


def _is_same_site(url: str, domain: str) -> bool:
    """True when ``url`` is hosted on ``domain`` or one of its subdomains (``www.`` ignored)."""
    host = _bare_host((domain_from_url(url) or "").split(":")[0])
    site = _bare_host(domain)
    return bool(host) and (host == site or host.endswith("." + site))


def _extract_sitemap_urls(robots_text: str, domain: str) -> list[str]:
    declared = [
        match.strip()
        for match in re.findall(r"(?im)^\s*sitemap:\s*(\S+)\s*$", robots_text.replace("\xa0", " "))
        if match.strip()
    ]
    # robots.txt is attacker-influenced input: only follow sitemaps hosted on the authority's own
    # site, never an arbitrary host it points at.
    same_site = [url for url in declared if _is_same_site(url, domain)]
    for url in declared:
        if url not in same_site:
            logger.warning("Ignoring off-site sitemap %s declared by %s", url, domain)
    return same_site or [f"https://{domain}/sitemap.xml"]


def _extract_loc_values(xml_text: str) -> list[str]:
    return [
        match.strip() for match in re.findall(r"<loc>\s*([^<]+?)\s*</loc>", xml_text, flags=re.I)
    ]


def _collect_sitemap_target_urls(sitemap_url: str, domain: str, *, depth: int = 0) -> list[str]:
    if depth > 2:
        return []

    xml_text = _fetch_text_cached(sitemap_url)
    loc_values = [url for url in _extract_loc_values(xml_text) if _is_same_site(url, domain)]
    if not loc_values:
        return []

    if "<sitemapindex" in xml_text[:500].lower():
        urls: list[str] = []
        for nested_sitemap_url in loc_values[:MAX_SITEMAPS_PER_INDEX]:
            urls.extend(_collect_sitemap_target_urls(nested_sitemap_url, domain, depth=depth + 1))
        return urls

    return loc_values


def _domain_sitemap_urls(domain: str) -> list[str]:
    cached = _SITEMAP_URL_CACHE.get(domain)
    if cached is not None:
        return cached

    try:
        robots_text = _fetch_text_cached(f"https://{domain}/robots.txt")
    except HttpError as exc:
        logger.info("No robots.txt for %s: %s", domain, exc)
        robots_text = ""

    urls: list[str] = []
    for sitemap_url in _extract_sitemap_urls(robots_text, domain):
        try:
            urls.extend(_collect_sitemap_target_urls(sitemap_url, domain))
        except HttpError as exc:
            logger.info("Sitemap %s unavailable: %s", sitemap_url, exc)
            continue

    deduped = list(dict.fromkeys(urls))
    _SITEMAP_URL_CACHE[domain] = deduped
    return deduped


def keyword_tokens(*chunks: str | None) -> list[str]:
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


def _url_token_score(url: str, title_tokens: list[str]) -> int:
    normalized_url = normalize_text(url)
    return sum(len(token) for token in title_tokens if token in normalized_url)


def _rank_candidate_url(url: str, title_tokens: list[str]) -> int:
    """Ordering score only; never used to accept a page."""
    score = _url_token_score(url, title_tokens)
    if url.lower().endswith(".html"):
        score += 15
    if any(marker in url.lower() for marker in PROCUREMENT_PATH_MARKERS):
        score += 10
    if "/content/dam/" in url.lower():
        score -= 20
    return score


def _extract_html_title(html: str) -> str | None:
    match = re.search(r"<title>([^<]+)</title>", html, flags=re.I)
    return match.group(1).strip() if match else None


def _extract_headings(html: str) -> str:
    return " ".join(
        strip_html(match) or ""
        for match in re.findall(r"<h1[^>]*>(.*?)</h1>", html, flags=re.I | re.S)
    )


def extract_canonical_url(html: str, fallback_url: str, domains: list[str]) -> str:
    """The page's canonical URL, unless it points outside the authority's own domains."""
    match = re.search(r'<link[^>]+rel="canonical"[^>]+href="([^"]+)"', html, flags=re.I)
    if not match:
        return fallback_url
    canonical = match.group(1).strip()
    return canonical if _is_on_any_domain(canonical, domains) else fallback_url


def _is_on_any_domain(url: str, domains: list[str]) -> bool:
    return any(_is_same_site(url, domain) for domain in domains)


def match_page(html: str, title_tokens: list[str]) -> PageMatch:
    page_title = normalize_text(f"{_extract_html_title(html) or ''} {_extract_headings(html)}")
    page_text = normalize_text(strip_html(html) or "")
    title_hits = sum(1 for token in title_tokens if token in page_title)
    body_hits = sum(1 for token in title_tokens if token not in page_title and token in page_text)
    return PageMatch(
        title_hits=title_hits,
        body_hits=body_hits,
        required=min(REQUIRED_TITLE_TOKEN_HITS, len(title_tokens)),
    )


def _browser_storage_dir(settings: Settings) -> Path:
    return settings.resolve_path(settings.browser_storage_dir)


def browser_candidate(
    *, candidate_url: str, title_tokens: list[str], domains: list[str], settings: Settings
) -> OfficialPageCandidate | None:
    try:
        browser_page = render_page(
            url=candidate_url,
            storage_dir=_browser_storage_dir(settings),
            timeout_ms=20000,
        )
    except Exception as exc:  # noqa: BLE001 - the headless browser can fail in many ways
        logger.info("Browser fallback failed for %s: %s", candidate_url, exc)
        return None

    final_url = browser_page.final_url or candidate_url
    if not _is_on_any_domain(final_url, domains):
        logger.warning("Browser fallback for %s ended off-site at %s", candidate_url, final_url)
        return None

    match = match_page(browser_page.html, title_tokens)
    if not match.accepted:
        return None

    return OfficialPageCandidate(
        official_url=final_url,
        html=browser_page.html,
        pdf_links=browser_page.pdf_links,
        match=match,
        used_browser=True,
    )


def best_official_candidate(
    *,
    domains: list[str],
    title_tokens: list[str],
    settings: Settings,
) -> OfficialPageCandidate | None:
    if not domains or not title_tokens:
        return None

    candidate_urls: list[tuple[int, str]] = []
    for domain in domains:
        for url in _domain_sitemap_urls(domain):
            if _url_token_score(url, title_tokens) <= 0:
                continue
            candidate_urls.append((_rank_candidate_url(url, title_tokens), url))

    if not candidate_urls:
        return None

    candidate_urls.sort(key=lambda item: item[0], reverse=True)
    for _, candidate_url in candidate_urls[:MAX_CANDIDATE_PAGES]:
        try:
            html = _fetch_text_cached(candidate_url)
        except HttpError as exc:
            logger.info("Candidate page %s unavailable: %s", candidate_url, exc)
            fallback = browser_candidate(
                candidate_url=candidate_url,
                title_tokens=title_tokens,
                domains=domains,
                settings=settings,
            )
            if fallback is not None:
                return fallback
            continue

        match = match_page(html, title_tokens)
        if not match.accepted:
            fallback = browser_candidate(
                candidate_url=candidate_url,
                title_tokens=title_tokens,
                domains=domains,
                settings=settings,
            )
            if fallback is not None:
                return fallback
            continue
        return OfficialPageCandidate(
            official_url=extract_canonical_url(html, candidate_url, domains),
            html=html,
            pdf_links=[],
            match=match,
        )

    return None
