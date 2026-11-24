"""Bounded source evidence, separated from trusted instructions and targeting preferences."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlsplit

from arch_competition_ops.http import HttpError, get_default_client
from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.models import ScreeningDecision, canonical_json
from arch_competition_ops.screening.notice_urls import URL, PageLinks, public_url
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.screening.providers import provider_identity, structured_request
from arch_competition_ops.screening.source_evidence import notice_evidence
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
        raw = envelope.get("rawNotice", envelope)
        if isinstance(raw, dict):
            has_listing = any(
                raw.get(key)
                for key in (
                    "title",
                    "heading",
                    "description",
                    "name",
                    "summary",
                    "objet",
                    "description-proc",
                )
            ) or bool(envelope.get("title"))
        else:
            has_listing = bool(isinstance(raw, str) and raw.strip())
        if not has_listing and (pending or exc.status_code in {403, 429}):
            raise
        if limitations is not None:
            limitations.append(
                f"Detail unavailable (HTTP {exc.status_code}); only listing evidence was read"
            )
        # The existing listing remains usable evidence; its missing fields stay visible.
        return payload
    media = response.headers.get("Content-Type", response.headers.get("content-type", ""))
    if "pdf" in media.lower() or not response.text.strip():
        if pending and not envelope.get("rawNotice"):
            raise HttpError("No readable source text", url=source_url)
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
    title = row.get("title") or ""
    if not title and (source_payload or "").lstrip().startswith("{"):
        try:
            envelope, _ = json.JSONDecoder().raw_decode(source_payload.lstrip())
            original = envelope.get("title")
            if isinstance(original, str) and original in notice_evidence(source_payload):
                title = original
        except ValueError:
            pass
    source_payload = notice_evidence(source_payload or "")
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
    schema = ScreeningDecision.model_json_schema()
    schema["required"] = list(schema["properties"])
    request = structured_request(
        settings.ai_provider,
        model_id or settings.ai_model,
        load_screening_instructions(settings),
        canonical_json({"evidence_fields": fields}),
        schema,
        "competition_screening",
        settings.ai_max_output_tokens,
        settings.ai_reasoning_effort,
    )
    return (
        canonical_json(
            {"provider": provider_identity(settings), "notice_version": version, "request": request}
        ),
        fields,
        sorted(set(limitations)),
    )
