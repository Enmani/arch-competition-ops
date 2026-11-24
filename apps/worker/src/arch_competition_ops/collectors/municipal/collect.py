"""Dispatcher: reads each configured profile URL and hands it to the matching parser."""

from __future__ import annotations

import json
import os

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import fetch_text_get, fetch_text_post
from arch_competition_ops.collectors.municipal.feed import collect_feed_documents
from arch_competition_ops.collectors.municipal.hamburg import collect_hamburg_listing_documents
from arch_competition_ops.collectors.municipal.nettender import (
    collect_nettender_listing_documents,
)
from arch_competition_ops.models import SourceDefinition


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(
        url,
        headers={
            "Accept": (
                "text/html,application/xhtml+xml,application/xml;q=0.9,text/xml;q=0.8,*/*;q=0.7"
            )
        },
    )


def _default_post_text(url: str, data: dict[str, str]) -> str:
    return fetch_text_post(
        url,
        data,
        headers={"Accept": "text/plain,text/html,application/xhtml+xml,*/*;q=0.7"},
    )


def parse_profile_urls(raw_value: str | None) -> list[str]:
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


def resolve_profile_urls(source: SourceDefinition, profile_urls: list[str] | None) -> list[str]:
    if profile_urls is not None:
        return [url.strip() for url in profile_urls if url.strip()]

    if source.url_list:
        return [url.strip() for url in source.url_list if url.strip()]

    env_urls = parse_profile_urls(os.getenv("ARCH_COMPETITION_OPS_MUNICIPAL_PROFILE_URLS"))
    if env_urls:
        return env_urls

    configured_urls = parse_profile_urls(source.base_url)
    if len(configured_urls) > 1:
        return configured_urls

    if "example.gov.local" not in source.base_url:
        return [source.base_url]

    return []


def looks_like_feed(payload: str) -> bool:
    stripped = payload.lstrip()
    return (
        stripped.startswith("<?xml") or stripped.startswith("<rss") or stripped.startswith("<feed")
    )


def collect_municipal_buyer_profile_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    profile_urls: list[str] | None = None,
    fetch_text: callable | None = None,
    post_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    resolved_urls = resolve_profile_urls(source, profile_urls)
    if not resolved_urls:
        raise ValueError(
            "Municipal profile URLs are not configured. "
            "Set ARCH_COMPETITION_OPS_MUNICIPAL_PROFILE_URLS "
            "or pass profile_urls explicitly."
        )

    get_text = fetch_text or _default_fetch_text
    post_listing = post_text or _default_post_text
    documents: list[CollectedSourceDocument] = []
    for url in resolved_urls:
        if len(documents) >= limit:
            break

        payload = get_text(url)
        if looks_like_feed(payload):
            remaining = limit - len(documents)
            documents.extend(
                collect_feed_documents(
                    source,
                    url,
                    payload,
                    limit=remaining,
                    publication_date_from=publication_date_from,
                    fetch_text=get_text,
                )
            )
            continue

        if ("publicationDetail" in payload and "data-oid=" in payload) or (
            "tableHorizontalHeader" in payload and "PublicationSearchControllerServlet" in payload
        ):
            remaining = limit - len(documents)
            documents.extend(
                collect_nettender_listing_documents(
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

        if "km1-teaser__heading-link" in payload and "hamburg.de" in url:
            remaining = limit - len(documents)
            documents.extend(
                collect_hamburg_listing_documents(
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
