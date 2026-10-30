"""Hamburg tender teaser listing."""

from __future__ import annotations

import json
import re
from html import unescape
from urllib.parse import urljoin

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.municipal.relevance import (
    is_candidate_municipal_notice,
    is_relevant_municipal_notice,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.text import strip_html

HAMBURG_TEASER_PATTERN = re.compile(
    r'<div[^>]*class="[^"]*\bkm1-teaser\b[^"]*"[^>]*>'
    r'.*?<span[^>]*class="[^"]*\bkm1-topline\b[^"]*"[^>]*>(.*?)</span>'
    r'.*?<a[^>]*href="([^"]+)"[^>]*class="[^"]*\bkm1-teaser__heading-link\b[^"]*"[^>]*>'
    r'.*?<h3[^>]*class="[^"]*\bkm1-teaser__heading\b[^"]*"[^>]*>(.*?)</h3>'
    r'.*?<p[^>]*class="[^"]*\bkm1-teaser__paragraph\b[^"]*"[^>]*>(.*?)</p>',
    flags=re.IGNORECASE | re.DOTALL,
)


def collect_hamburg_listing_documents(
    source: SourceDefinition,
    listing_url: str,
    listing_html: str,
    *,
    limit: int,
    publication_date_from: str | None,
    fetch_text: callable,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    del source, publication_date_from
    documents: list[CollectedSourceDocument] = []
    seen_urls: set[str] = set()
    for topline_html, href, title_html, paragraph_html in HAMBURG_TEASER_PATTERN.findall(
        listing_html
    ):
        title = strip_html(title_html)
        authority = strip_html(topline_html)
        deadline_raw = None
        if paragraph_html:
            deadline_match = re.search(
                r"Einreichungsfrist:\s*([^<]+)", paragraph_html, flags=re.IGNORECASE
            )
            if deadline_match:
                deadline_raw = strip_html(deadline_match.group(1))
        if not title or not href:
            continue

        listing_context = " ".join(value for value in (authority, deadline_raw) if value)
        if not is_candidate_municipal_notice(title, listing_context):
            continue

        detail_url = urljoin(listing_url, unescape(href))
        if detail_url in seen_urls:
            continue
        seen_urls.add(detail_url)

        detail_html = fetch_text(detail_url)
        combined_context = " ".join(
            value for value in (listing_context, strip_html(detail_html) or "") if value
        )
        if not include_unclassified and (not is_relevant_municipal_notice(title, combined_context)):
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
