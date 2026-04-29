from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET
from html import unescape

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_text_get,
    has_built_environment_context,
    normalize_text,
    parse_date_string,
    strip_html,
)
from arch_competition_ops.models import SourceDefinition


RSS_FIELD_PATTERN = re.compile(
    r"<tr[^>]*>\s*<td[^>]*>\s*<b>\s*([^<:]+?)\s*:?\s*</b>\s*</td>\s*<td[^>]*>(.*?)</td>\s*</tr>",
    flags=re.IGNORECASE | re.DOTALL,
)
RSS_BREAK_PATTERN = re.compile(r"<br\s*/?>", flags=re.IGNORECASE)
RSS_DESIGN_MARKERS = (
    "design build",
    "design builder",
    "design-builder",
    "design services",
    "architectural services",
    "concept design",
    "detailed design",
    "preliminary design",
    "architectural",
    "architecture",
    "architect",
    "landscape architecture",
    "landscape design",
    "urban design",
    "planning competition",
    "project competition",
)
RSS_BUILT_MARKERS = (
    "design build",
    "design builder",
    "design-builder",
    "infrastructure",
    "stormwater",
    "watermain",
    "shared path",
    "boardwalk",
    "hall",
    "pavilion",
    "facility",
    "facilities",
    "public realm",
    "street",
    "camp",
)


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(
        url,
        headers={"Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"},
    )


def _normalize_key(value: str) -> str:
    return normalize_text(value).replace(" ", "_")


def _html_lines(value: str | None) -> list[str]:
    if not value:
        return []

    with_line_breaks = RSS_BREAK_PATTERN.sub("\n", value)
    without_tags = re.sub(r"<[^>]+>", " ", unescape(with_line_breaks))
    return [line.strip() for line in without_tags.splitlines() if line.strip()]


def _parse_description_fields(description_html: str) -> tuple[dict[str, str], list[str]]:
    fields: dict[str, str] = {}
    categories: list[str] = []

    for raw_key, raw_value in RSS_FIELD_PATTERN.findall(description_html):
        key = _normalize_key(raw_key)
        lines = _html_lines(raw_value)
        if not lines:
            continue
        value = " | ".join(lines)
        fields[key] = value
        if key == "categories":
            categories = lines

    return fields, categories


def _is_relevant_rss_notice(title: str, summary: str, categories: list[str]) -> bool:
    normalized = normalize_text(f"{title} {summary} {' '.join(categories)}")
    has_design_signal = any(marker in normalized for marker in RSS_DESIGN_MARKERS)
    if not has_design_signal:
        return False

    if has_built_environment_context(title, summary, *categories):
        return True

    return any(marker in normalized for marker in RSS_BUILT_MARKERS)


def _rss_relevance_score(title: str, summary: str, categories: list[str]) -> int:
    normalized = normalize_text(f"{title} {summary} {' '.join(categories)}")

    score = 0
    if any(marker in normalized for marker in ("architect", "architecture", "architectural")):
        score += 5
    if any(marker in normalized for marker in ("urban design", "landscape architecture", "landscape design")):
        score += 4
    if any(marker in normalized for marker in ("design build", "design and build", "design builder", "design-builder")):
        score += 4
    if any(marker in normalized for marker in ("concept design", "detailed design", "preliminary design")):
        score += 3
    if "design services" in normalized or "architectural services" in normalized:
        score += 3
    if any(marker in normalized for marker in RSS_BUILT_MARKERS):
        score += 1

    return score


def collect_generic_rss_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    raw_feed = (fetch_text or _default_fetch_text)(source.base_url)
    root = ET.fromstring(raw_feed)
    channel = root.find("channel")
    if channel is None:
        return []

    scored_documents: list[tuple[int, str, CollectedSourceDocument]] = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or source.base_url).strip()
        description_html = item.findtext("description") or ""
        fields, categories = _parse_description_fields(description_html)
        summary = fields.get("overview") or fields.get("description") or (strip_html(description_html) or "")
        published_at = parse_date_string(item.findtext("pubDate"))

        if not title or not link:
            continue
        if publication_date_from and published_at and published_at < publication_date_from:
            continue
        if not _is_relevant_rss_notice(title, summary, categories):
            continue

        payload = json.dumps(
            {
                "title": title,
                "buyer": fields.get("organisation") or fields.get("organization"),
                "noticeId": fields.get("rfx_id") or fields.get("notice_id"),
                "deadline": parse_date_string(fields.get("close_date") or fields.get("deadline")),
                "summary": summary,
                "categories": categories,
                "officialUrl": link,
                "opportunityType": "public_design_services_procurement",
                "procedureType": fields.get("tender_type"),
                "implementationPath": "service_contract_award_after_competitive_selection",
                "evidenceLevel": "official_listing",
                "evidenceNote": f"Official {source.name} feed entry.",
                "publishedAt": published_at,
            },
            ensure_ascii=False,
        )
        scored_documents.append(
            (
                _rss_relevance_score(title, summary, categories),
                published_at or "0000-00-00",
                CollectedSourceDocument(source_url=link, payload=payload),
            )
        )

    scored_documents.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [document for _score, _published_at, document in scored_documents[:limit]]
