from __future__ import annotations

import json
import xml.etree.ElementTree as ET

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_text_get,
    is_design_relevant,
    parse_date_string,
    strip_html,
)
from arch_competition_ops.models import SourceDefinition


COMPETITIONS_ARCHI_FEED_URL = "https://competitions.archi/cat/all-competitions/feed/"


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(
        url,
        headers={"Accept": "application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5"},
    )


def collect_competitions_archi_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    raw_feed = (fetch_text or _default_fetch_text)(COMPETITIONS_ARCHI_FEED_URL)
    root = ET.fromstring(raw_feed)
    channel = root.find("channel")
    if channel is None:
        return []

    documents: list[CollectedSourceDocument] = []
    for item in channel.findall("item"):
        title = (item.findtext("title") or "").strip()
        link = (item.findtext("link") or source.base_url).strip()
        pub_date = parse_date_string(item.findtext("pubDate"))
        description = strip_html(item.findtext("description")) or ""
        categories = [category.text.strip() for category in item.findall("category") if category.text]

        if publication_date_from and pub_date and pub_date < publication_date_from:
            continue
        if not title or not is_design_relevant(
            title,
            description,
            categories=categories,
            require_professional_category=True,
        ):
            continue

        payload = json.dumps(
            {
                "title": title,
                "summary": description,
                "categories": categories,
                "publishedAt": pub_date,
                "url": link,
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=link, payload=payload))
        if len(documents) >= limit:
            break

    return documents
