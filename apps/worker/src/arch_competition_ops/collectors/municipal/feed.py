"""RSS feeds of municipal procurement platforms (Berlin)."""

from __future__ import annotations

import json
import re
import xml.etree.ElementTree as ET

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.municipal.relevance import is_relevant_municipal_notice
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.text import strip_html


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
        r"(?:Ablauf (?:der )?(?:Teilnahme|Angebots)frist|Eröffnungstermin):"
        r"\s*(.+?)(?:Online seit|$)",
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


def collect_feed_documents(
    source: SourceDefinition,
    feed_url: str,
    feed_payload: str,
    *,
    limit: int,
    publication_date_from: str | None,
    fetch_text: callable,
    include_unclassified: bool = False,
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
        if not include_unclassified and (
            not is_relevant_municipal_notice(title, parsed_description["summary"])
        ):
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
