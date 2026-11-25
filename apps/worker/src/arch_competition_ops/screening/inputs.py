"""Bounded source evidence, separated from trusted instructions and targeting preferences."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlsplit

from arch_competition_ops.http import HttpError, get_default_client
from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.models import ScreeningAnswer, canonical_json
from arch_competition_ops.screening.notice_urls import URL, PageLinks, public_url
from arch_competition_ops.screening.preferences import answer_format
from arch_competition_ops.screening.providers import provider_identity, structured_request
from arch_competition_ops.screening.readability import NoReadableText, has_notice_text
from arch_competition_ops.screening.source_evidence import notice_evidence, notice_title
from arch_competition_ops.settings import Settings


def enrich_notice_payload(
    payload: str, source_url: str, settings: Settings, *, limitations=None
) -> str:
    """API listing summaries often omit the very fields we need; also read the linked notice."""
    if not payload:
        # Retention may have cleared a terminal notice before the owner requested another read.
        payload = json.dumps({"pendingDetailUrl": source_url})
    if not payload.lstrip().startswith("{"):
        return payload
    try:
        envelope = json.loads(payload)
    except ValueError:
        return payload
    pending = envelope.get("pendingDetailUrl")
    if not pending and (
        not settings.ai_fetch_details
        or "rawNoticeHtml" in envelope
        or urlsplit(source_url).path in {"", "/"}
    ):
        return payload
    try:
        response = get_default_client().get(
            pending or source_url,
            archive=settings.resolve_path(settings.html_archive_dir),
            max_bytes=2 * 1024 * 1024,
        )
    except HttpError as exc:
        if (pending or exc.status_code in {403, 429}) and not (
            notice_title(payload) or has_notice_text(notice_evidence(payload), source_url)
        ):
            raise
        if limitations is not None:
            limitations.append(
                f"Detail unavailable (HTTP {exc.status_code}); only listing evidence was read"
            )
        # The existing listing remains usable evidence; its missing fields stay visible.
        return payload
    media = response.headers.get("Content-Type", response.headers.get("content-type", ""))
    if "pdf" in media.lower() or not response.text.strip():
        return payload
    if pending and urlsplit(source_url).hostname == "contrataciondelestado.es":
        from arch_competition_ops.collectors.pcsp import _detail_belongs_to, _extract_detail_fields

        if not _detail_belongs_to(_extract_detail_fields(response.text), source_url):
            return payload
    return payload + "\n\nSource notice detail:\n" + response.text


def prepare_input(
    row: dict[str, Any],
    settings: Settings,
    *,
    model_id: str | None = None,
    source_payload: str | None = None,
    fetch_source: bool = True,
    original_links: dict[str, set[str]] | None = None,
) -> tuple[str, dict[str, str], list[str]]:
    limitations: list[str] = []
    source_url = row["source_url"]
    if source_payload is None and fetch_source:
        try:
            response = get_default_client().get(
                source_url,
                archive=settings.resolve_path(settings.html_archive_dir),
                max_bytes=2 * 1024 * 1024,  # Same bound as enrichment; a dataset is not a notice.
            )
            media = response.headers.get("Content-Type", response.headers.get("content-type", ""))
            if "pdf" in media.lower():
                limitations.append("PDF content was not read; structured record only")
            else:
                source_payload = json.dumps({"rawNotice": response.text}, ensure_ascii=False)
        except HttpError as exc:
            if exc.status_code in {403, 429}:
                raise
            limitations.append("Source page could not be fetched; structured record only")
    if source_payload is None:
        limitations.append("No source notice text supplied")
    version = notice_content_hash(source_payload or "", source_url)
    notice_heading = notice_title(source_payload or "")
    title = notice_heading or row.get("title") or ""
    source_payload = notice_evidence(source_payload or "")
    if not has_notice_text(source_payload, source_url) and not notice_heading:
        raise NoReadableText(source_url)
    text = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", source_payload or "", flags=re.I | re.S)
    text = strip_html(text) or ""
    links = PageLinks(source_url)
    links.feed(source_payload or "")
    links.links.extend(URL.findall(text))
    candidates = [source_url, *links.links]
    if original_links is not None:
        for original in candidates:
            if clean_url := public_url(original):
                original_links.setdefault(clean_url, set()).add(original)
    fields = {}
    remaining = settings.ai_max_input_chars
    for name, value in (
        ("notice_title", title),
        ("notice_url", public_url(source_url)),
        ("notice_text", text),
        (
            "notice_links",
            "\n".join(dict.fromkeys(filter(None, map(public_url, candidates)))),
        ),
    ):
        clean = URL.sub(lambda match: public_url(match[0]), value.replace(r"\/", "/"))
        fields[name] = clean[:remaining]
        if len(clean) > remaining:
            limitations.append("Input was truncated to the configured character limit")
        remaining -= len(fields[name])
    instructions, schema = answer_format(settings)
    request = structured_request(
        settings.ai_provider,
        model_id or settings.ai_model,
        instructions,
        canonical_json({"evidence_fields": fields}),
        schema,
        "competition_screening",
        settings.ai_max_output_tokens,
        settings.ai_reasoning_effort,
    )
    return (
        canonical_json(
            {
                "provider": provider_identity(settings),
                "notice_version": version,
                "schema_version": ScreeningAnswer.schema_version,
                "request": request,
            }
        ),
        fields,
        sorted(set(limitations)),
    )
