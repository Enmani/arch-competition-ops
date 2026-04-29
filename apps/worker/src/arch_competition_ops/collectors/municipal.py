from __future__ import annotations

import json
import os
import re
import xml.etree.ElementTree as ET
from html import unescape
from urllib.parse import urljoin, urlsplit

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_text_get,
    fetch_text_post,
    is_design_relevant,
    normalize_text,
    parse_date_string,
    strip_html,
)
from arch_competition_ops.models import SourceDefinition


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(
        url,
        headers={"Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7"},
    )


def _default_post_text(url: str, data: dict[str, str]) -> str:
    return fetch_text_post(
        url,
        data,
        headers={"Accept": "text/plain,text/html,application/xhtml+xml,*/*;q=0.7"},
    )


GERMAN_DIRECT_SERVICE_MARKERS = (
    "objektplanung",
    "fachplanung",
    "planungsleistung",
    "planungsleistungen",
    "architektenleistung",
    "architektenleistungen",
    "ingenieurleistung",
    "ingenieurleistungen",
    "generalplanung",
    "gesamtplanung",
    "freianlagenplanung",
    "landschaftsarchitektur",
    "stadtplanung",
    "projektleitung",
    "generalplaner",
    "bauakustik",
    "raum und bauakustik",
)
GERMAN_PROJECT_STEERING_MARKERS = (
    "projektsteuerung",
    "projektsteuerer",
    "projektsteuererleistungen",
    "kostenplanung",
)
GERMAN_BUILT_CONTEXT_MARKERS = (
    "gebaude",
    "hochbau",
    "neubau",
    "umbau",
    "sanierung",
    "feuerwache",
    "schule",
    "bibliothek",
    "museum",
    "campus",
    "haltestelle",
    "stadtteilschule",
    "bibliothek",
    "sport",
    "quartier",
    "txl",
)

NETTENDER_ROW_PATTERN = re.compile(
    r'<tr[^>]*class="[^"]*\bpublicationDetail\b[^"]*"[^>]*data-oid="([^"]+)"[^>]*data-category="([^"]+)"[^>]*>(.*?)</tr>',
    flags=re.IGNORECASE | re.DOTALL,
)
HAMBURG_TEASER_PATTERN = re.compile(
    r'<div[^>]*class="[^"]*\bkm1-teaser\b[^"]*"[^>]*>'
    r'.*?<span[^>]*class="[^"]*\bkm1-topline\b[^"]*"[^>]*>(.*?)</span>'
    r'.*?<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bkm1-teaser__heading-link\b[^"]*"[^>]*>'
    r'.*?<h3[^>]*class="[^"]*\bkm1-teaser__heading\b[^"]*"[^>]*>(.*?)</h3>'
    r'.*?<p[^>]*class="[^"]*\bkm1-teaser__paragraph\b[^"]*"[^>]*>(.*?)</p>',
    flags=re.IGNORECASE | re.DOTALL,
)


def _parse_profile_urls(raw_value: str | None) -> list[str]:
    if not raw_value:
        return []
    cleaned = raw_value.strip()
    if not cleaned:
        return []

    if cleaned.startswith("["):
        try:
            decoded = json.loads(cleaned)
        except json.JSONDecodeError:
            decoded = []
        return [str(item).strip() for item in decoded if str(item).strip()]

    normalized = cleaned.replace("\r", "\n").replace(";", "\n").replace(",", "\n")
    return [line.strip() for line in normalized.splitlines() if line.strip()]


def _resolve_profile_urls(source: SourceDefinition, profile_urls: list[str] | None) -> list[str]:
    if profile_urls is not None:
        return [url.strip() for url in profile_urls if url.strip()]

    if source.url_list:
        return [url.strip() for url in source.url_list if url.strip()]

    env_urls = _parse_profile_urls(os.getenv("ARCH_COMPETITION_OPS_MUNICIPAL_PROFILE_URLS"))
    if env_urls:
        return env_urls

    configured_urls = _parse_profile_urls(source.base_url)
    if len(configured_urls) > 1:
        return configured_urls

    if "example.gov.local" not in source.base_url:
        return [source.base_url]

    return []


def _looks_like_feed(payload: str) -> bool:
    stripped = payload.lstrip()
    return stripped.startswith("<?xml") or stripped.startswith("<rss") or stripped.startswith("<feed")


def _extract_notice_id(source_url: str) -> str | None:
    match = re.search(r"/tenderId/(\d+)", source_url)
    if match:
        return match.group(1)
    return None


def _parse_feed_description(description: str) -> dict[str, str]:
    plain = strip_html(description) or ""
    procedure_match = re.search(
        r"Verfahrensart:\s*(.+?)(?:Ausführungsort|Ablauf|Eröffnungstermin|Online seit|$)",
        plain,
    )
    deadline_match = re.search(
        r"(?:Ablauf (?:der )?(?:Teilnahme|Angebots)frist|Eröffnungstermin):\s*(.+?)(?:Online seit|$)",
        plain,
    )
    location_match = re.search(
        r"Ausführungsort:\s*(.+?)(?:Ablauf|Eröffnungstermin|Online seit|$)",
        plain,
    )
    return {
        "summary": plain,
        "procedureType": (procedure_match.group(1).strip() if procedure_match else ""),
        "deadline": parse_date_string(deadline_match.group(1).strip()) if deadline_match else "",
        "location": (location_match.group(1).strip() if location_match else ""),
    }


def _is_relevant_municipal_notice(title: str, description: str) -> bool:
    if is_design_relevant(title, description):
        return True

    haystack = normalize_text(f"{title} {description}")
    if any(marker in haystack for marker in GERMAN_DIRECT_SERVICE_MARKERS):
        return True

    return (
        any(marker in haystack for marker in GERMAN_PROJECT_STEERING_MARKERS)
        and any(marker in haystack for marker in GERMAN_BUILT_CONTEXT_MARKERS)
    )


def _is_candidate_municipal_notice(title: str, description: str) -> bool:
    if _is_relevant_municipal_notice(title, description):
        return True

    haystack = normalize_text(f"{title} {description}")
    return any(
        marker in haystack
        for marker in (*GERMAN_DIRECT_SERVICE_MARKERS, *GERMAN_PROJECT_STEERING_MARKERS)
    )


def _extract_td_texts(row_html: str) -> list[str]:
    return [strip_html(match) or "" for match in re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.IGNORECASE | re.DOTALL)]


def _extract_td_by_class(row_html: str, class_name: str) -> str | None:
    match = re.search(
        rf'<td[^>]*class="[^"]*\b{re.escape(class_name)}\b[^"]*"[^>]*>(.*?)</td>',
        row_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    return strip_html(match.group(1)) if match else None


def _extract_all_td_by_class(row_html: str, class_name: str) -> list[str]:
    return [
        value
        for value in (
            strip_html(match)
            for match in re.findall(
                rf'<td[^>]*class="[^"]*\b{re.escape(class_name)}\b[^"]*"[^>]*>(.*?)</td>',
                row_html,
                flags=re.IGNORECASE | re.DOTALL,
            )
        )
        if value
    ]


def _nettender_root_url(listing_url: str) -> str:
    parsed = urlsplit(listing_url)
    path_parts = [part for part in parsed.path.split("/") if part]
    first_path = path_parts[0] if path_parts else ""
    if first_path:
        return f"{parsed.scheme}://{parsed.netloc}/{first_path}"
    return f"{parsed.scheme}://{parsed.netloc}"


def _resolve_nettender_detail_url(
    listing_url: str,
    oid: str,
    category: str,
    *,
    post_text: callable,
) -> str | None:
    root_url = _nettender_root_url(listing_url)
    redirect_path = post_text(
        urljoin(f"{root_url}/", "DataProvider"),
        {
            "param": "Redirect",
            "OID": oid,
            "function": "Detail",
            "category": category,
        },
    ).strip()
    if not redirect_path:
        return None
    return urljoin(f"{root_url}/", redirect_path)


def _collect_nettender_listing_documents(
    source: SourceDefinition,
    listing_url: str,
    listing_html: str,
    *,
    limit: int,
    publication_date_from: str | None,
    fetch_text: callable,
    post_text: callable,
) -> list[CollectedSourceDocument]:
    documents: list[CollectedSourceDocument] = []
    for oid, category, row_html in NETTENDER_ROW_PATTERN.findall(listing_html):
        if category != "InvitationToTender":
            continue

        title = _extract_td_by_class(row_html, "tender")
        authority = _extract_td_by_class(row_html, "tenderAuthority")
        deadline_raw = _extract_td_by_class(row_html, "tenderDeadline")
        procedure_bits = _extract_all_td_by_class(row_html, "tenderType")
        published_at = None
        raw_cells = _extract_td_texts(row_html)
        if raw_cells:
            published_at = parse_date_string(raw_cells[0])
        if publication_date_from and published_at and published_at < publication_date_from:
            continue

        if not title:
            continue

        listing_context = " ".join(
            value for value in (authority, " / ".join(procedure_bits), deadline_raw) if value
        )
        if not _is_candidate_municipal_notice(title, listing_context):
            continue

        detail_url = _resolve_nettender_detail_url(
            listing_url,
            oid,
            category,
            post_text=post_text,
        )
        detail_html = fetch_text(detail_url) if detail_url else ""
        combined_context = " ".join(
            value for value in (listing_context, strip_html(detail_html) or "") if value
        )
        if not _is_relevant_municipal_notice(title, combined_context):
            continue

        payload: dict[str, object] = {
            "title": title,
            "authority": authority,
            "procedureType": (" / ".join(procedure_bits) or None),
            "deadline": parse_date_string(deadline_raw) if deadline_raw else None,
            "publishedAt": published_at,
            "sourceListingUrl": listing_url,
        }
        if detail_html:
            payload["detailHtml"] = detail_html

        documents.append(
            CollectedSourceDocument(
                source_url=detail_url or listing_url,
                payload=json.dumps(payload, ensure_ascii=False),
            )
        )
        if len(documents) >= limit:
            break

    return documents


def _collect_hamburg_listing_documents(
    source: SourceDefinition,
    listing_url: str,
    listing_html: str,
    *,
    limit: int,
    publication_date_from: str | None,
    fetch_text: callable,
) -> list[CollectedSourceDocument]:
    del source, publication_date_from
    documents: list[CollectedSourceDocument] = []
    seen_urls: set[str] = set()
    for topline_html, href, title_html, paragraph_html in HAMBURG_TEASER_PATTERN.findall(listing_html):
        title = strip_html(title_html)
        authority = strip_html(topline_html)
        deadline_raw = None
        if paragraph_html:
            deadline_match = re.search(r"Einreichungsfrist:\s*([^<]+)", paragraph_html, flags=re.IGNORECASE)
            if deadline_match:
                deadline_raw = strip_html(deadline_match.group(1))
        if not title or not href:
            continue

        listing_context = " ".join(value for value in (authority, deadline_raw) if value)
        if not _is_candidate_municipal_notice(title, listing_context):
            continue

        detail_url = urljoin(listing_url, unescape(href))
        if detail_url in seen_urls:
            continue
        seen_urls.add(detail_url)

        detail_html = fetch_text(detail_url)
        combined_context = " ".join(
            value for value in (listing_context, strip_html(detail_html) or "") if value
        )
        if not _is_relevant_municipal_notice(title, combined_context):
            continue

        payload: dict[str, object] = {
            "title": title,
            "authority": authority,
            "deadline": parse_date_string(deadline_raw) if deadline_raw else None,
            "sourceListingUrl": listing_url,
        }
        if detail_html:
            payload["detailHtml"] = detail_html

        documents.append(
            CollectedSourceDocument(
                source_url=detail_url,
                payload=json.dumps(payload, ensure_ascii=False),
            )
        )
        if len(documents) >= limit:
            break

    return documents


def _collect_feed_documents(
    source: SourceDefinition,
    feed_url: str,
    feed_payload: str,
    *,
    limit: int,
    publication_date_from: str | None,
    fetch_text: callable,
) -> list[CollectedSourceDocument]:
    root = ET.fromstring(feed_payload)
    channel = root.find("channel")
    if channel is None:
        return []

    documents: list[CollectedSourceDocument] = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or "").strip()
        description = item.findtext("description") or ""
        published_at = parse_date_string(item.findtext("pubDate"))
        parsed_description = _parse_feed_description(description)

        if not title or not link:
            continue
        if publication_date_from and published_at and published_at < publication_date_from:
            continue
        if not _is_relevant_municipal_notice(title, parsed_description["summary"]):
            continue

        payload: dict[str, object] = {
            "title": title,
            "summary": parsed_description["summary"],
            "procedureType": parsed_description["procedureType"] or None,
            "deadline": parsed_description["deadline"] or None,
            "publishedAt": published_at,
            "location": parsed_description["location"] or None,
            "officialNoticeId": _extract_notice_id(link),
            "sourceListingUrl": feed_url,
        }

        try:
            detail_html = fetch_text(link)
        except Exception:  # noqa: BLE001
            detail_html = ""

        if detail_html:
            payload["detailHtml"] = detail_html

        documents.append(
            CollectedSourceDocument(
                source_url=link,
                payload=json.dumps(payload, ensure_ascii=False),
            )
        )
        if len(documents) >= limit:
            break

    return documents


def collect_municipal_buyer_profile_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    profile_urls: list[str] | None = None,
    fetch_text: callable | None = None,
    post_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    resolved_urls = _resolve_profile_urls(source, profile_urls)
    if not resolved_urls:
        raise ValueError(
            "Municipal profile URLs are not configured. Set ARCH_COMPETITION_OPS_MUNICIPAL_PROFILE_URLS "
            "or pass profile_urls explicitly."
        )

    get_text = fetch_text or _default_fetch_text
    post_listing = post_text or _default_post_text
    documents: list[CollectedSourceDocument] = []
    for url in resolved_urls:
        if len(documents) >= limit:
            break

        payload = get_text(url)
        if _looks_like_feed(payload):
            remaining = limit - len(documents)
            documents.extend(
                _collect_feed_documents(
                    source,
                    url,
                    payload,
                    limit=remaining,
                    publication_date_from=publication_date_from,
                    fetch_text=get_text,
                )
            )
            continue

        if (
            ('publicationDetail' in payload and 'data-oid=' in payload)
            or ('tableHorizontalHeader' in payload and 'PublicationSearchControllerServlet' in payload)
        ):
            remaining = limit - len(documents)
            documents.extend(
                _collect_nettender_listing_documents(
                    source,
                    url,
                    payload,
                    limit=remaining,
                    publication_date_from=publication_date_from,
                    fetch_text=get_text,
                    post_text=post_listing,
                )
            )
            continue

        if 'km1-teaser__heading-link' in payload and 'hamburg.de' in url:
            remaining = limit - len(documents)
            documents.extend(
                _collect_hamburg_listing_documents(
                    source,
                    url,
                    payload,
                    limit=remaining,
                    publication_date_from=publication_date_from,
                    fetch_text=get_text,
                )
            )
            continue

        documents.append(
            CollectedSourceDocument(
                source_url=url,
                payload=payload,
            )
        )
    return documents
