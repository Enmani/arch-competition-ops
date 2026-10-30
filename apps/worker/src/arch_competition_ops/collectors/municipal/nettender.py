"""NetServer/"NetTender" listing pages (Frankfurt, Stuttgart, Munich, Cologne, Duesseldorf)."""

from __future__ import annotations

import json
import re
from urllib.parse import urljoin, urlsplit

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.municipal.relevance import (
    is_candidate_municipal_notice,
    is_relevant_municipal_notice,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.text import strip_html

NETTENDER_ROW_PATTERN = re.compile(
    r'<tr[^>]*class="[^"]*\bpublicationDetail\b[^"]*"[^>]*data-oid="([^"]+)"[^>]*data-category="([^"]+)"[^>]*>(.*?)</tr>',
    flags=re.IGNORECASE | re.DOTALL,
)


def _extract_td_texts(row_html: str) -> list[str]:
    return [
        strip_html(match) or ""
        for match in re.findall(r"<td[^>]*>(.*?)</td>", row_html, flags=re.IGNORECASE | re.DOTALL)
    ]


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


def collect_nettender_listing_documents(
    source: SourceDefinition,
    listing_url: str,
    listing_html: str,
    *,
    limit: int,
    publication_date_from: str | None,
    fetch_text: callable,
    post_text: callable,
    include_unclassified: bool = False,
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
        if not include_unclassified and not is_candidate_municipal_notice(title, listing_context):
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
        if not include_unclassified and (not is_relevant_municipal_notice(title, combined_context)):
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
