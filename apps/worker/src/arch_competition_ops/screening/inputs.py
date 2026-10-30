"""Bounded source evidence, separated from trusted instructions and targeting preferences."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import urljoin, urlsplit

import yaml

from arch_competition_ops import clock
from arch_competition_ops.http import HttpError, get_default_client
from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.models import INSTRUCTIONS, canonical_json
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.settings import Settings

_VOLATILE_FIELDS = {
    "id",
    "dedup_key",
    "discovered_at",
    "updated_at",
    "last_verified_at",
    "geo_lat",
    "geo_lng",
    "geo_source",
    "geo_confidence",
    "qualification_score",
    "status",
}


class _PageLinks(HTMLParser):
    def __init__(self, base_url: str):
        super().__init__(convert_charrefs=True)
        self.base_url = base_url
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        for key, value in attrs:
            if key == "href" and value:
                absolute = urljoin(self.base_url, value)
                if absolute.startswith(("https://", "http://")):
                    self.links.append(absolute)


def enrich_notice_payload(payload: str, source_url: str, settings: Settings) -> str:
    """API listing summaries often omit the very fields we need; also read the linked notice."""
    if (
        not settings.ai_fetch_details
        or not payload.lstrip().startswith("{")
        or urlsplit(source_url).path in {"", "/"}
    ):
        return payload
    try:
        response = get_default_client().get(
            source_url,
            archive=settings.resolve_path(settings.html_archive_dir),
            max_bytes=2 * 1024 * 1024,
        )
    except HttpError:
        # The existing listing remains usable evidence; its missing fields stay visible.
        return payload
    media = response.headers.get("Content-Type", response.headers.get("content-type", ""))
    if "pdf" in media.lower():
        return payload
    return payload + "\n\nSource notice detail:\n" + response.text


def prepare_input(
    row: dict[str, Any],
    settings: Settings,
    preferences: dict[str, Any],
    *,
    source_payload: str | None = None,
    fetch_source: bool = True,
) -> tuple[str, dict[str, str], list[str]]:
    limitations: list[str] = []
    source_url = (
        row["source_url"]
        if source_payload is not None
        else row.get("official_url") or row["source_url"]
    )
    if source_payload is None and fetch_source:
        try:
            response = get_default_client().get(
                source_url, archive=settings.resolve_path(settings.html_archive_dir)
            )
            media = response.headers.get("Content-Type", response.headers.get("content-type", ""))
            if "pdf" in media.lower():
                limitations.append("PDF content was not read; structured record only")
            else:
                source_payload = response.text
        except HttpError:
            limitations.append("Source page could not be fetched; structured record only")
    if source_payload is None:
        limitations.append("No source notice text supplied")
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", source_payload or "", flags=re.I | re.S)
    text = strip_html(text) or ""
    links = _PageLinks(source_url)
    links.feed(source_payload or "")
    links.links.extend(re.findall(r'https?://[^\s<>"\\]+', source_payload or ""))
    links.links.insert(0, source_url)
    fields: dict[str, str] = {}
    remaining = settings.ai_max_input_chars
    for key, value in [
        *(row.items()),
        ("notice_links", "\n".join(dict.fromkeys(links.links))),
        ("notice_text", text),
    ]:
        if key in _VOLATILE_FIELDS or value is None or value == "":
            continue
        rendered = value if isinstance(value, str) else canonical_json(value)
        if len(rendered) > remaining:
            limitations.append("Input was truncated to the configured character limit")
        fields[key] = rendered[:remaining]
        remaining = max(0, remaining - len(fields[key]))
    content = {
        "date": clock.today().isoformat(),
        "preferences": preferences,
        "evidence_fields": fields,
        "limitations": sorted(set(limitations)),
        "notice_url": source_url,
    }
    content["screening_instructions"] = load_screening_instructions(settings)
    taxonomy_file = settings.resolve_path(settings.taxonomy_config)
    if taxonomy_file.exists():
        taxonomy = yaml.safe_load(taxonomy_file.read_text(encoding="utf-8"))
        content["allowed_labels"] = {
            name: taxonomy.get(name, [])
            for name in (
                "opportunity_types",
                "procedure_types",
                "implementation_paths",
                "competition_types",
                "project_types",
                "building_categories",
                "design_scopes",
                "project_modes",
                "audience",
            )
        }
    # Store the exact prompt/config, so any relevant change invalidates reuse without hashing.
    request = {
        "version": 1,
        "instructions": INSTRUCTIONS,
        "input": canonical_json(content),
        "max_output_tokens": settings.ai_max_output_tokens,
        "reasoning": {"effort": settings.ai_reasoning_effort},
    }
    payload = canonical_json(request)
    if len(payload.encode("utf-8")) > 200_000:
        raise ValueError("AI input exceeds 200 KB; lower ai_max_input_chars or shorten preferences")
    return payload, fields, content["limitations"]


def request_arguments(input_json: str) -> dict[str, Any]:
    request = json.loads(input_json)
    request.pop("version")
    return request
