"""Hamburg tender teaser listing."""

from __future__ import annotations

import json
import re
from html import unescape
from urllib.parse import urljoin

from arch_competition_ops.collectors.base import CollectedSourceDocument, deferred_detail
from arch_competition_ops.collectors.pagination import current_pages, snapshot_items
from arch_competition_ops.http import HttpError
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
) -> list[CollectedSourceDocument]:
    del source, publication_date_from
    documents: list[CollectedSourceDocument] = []
    seen_urls: set[str] = set()
    rows = HAMBURG_TEASER_PATTERN.findall(listing_html)
    for topline_html, href, title_html, paragraph_html in snapshot_items(
        rows, len(rows), lambda row: row[1]
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

        detail_url = urljoin(listing_url, unescape(href))
        if detail_url in seen_urls:
            continue
        seen_urls.add(detail_url)

        try:
            detail_html = fetch_text(detail_url)
        except HttpError as exc:
            documents.append(
                deferred_detail(
                    exc, detail_url, " ".join([title_html, topline_html, paragraph_html])
                )
            )
            if not current_pages() and len(documents) >= limit:
                break
            continue

        payload: dict[str, object] = {
            "rawNoticeHtml": "\n".join([title_html, topline_html, paragraph_html, detail_html]),
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
        if not current_pages() and len(documents) >= limit:
            break

    return documents
