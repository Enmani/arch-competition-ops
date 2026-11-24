"""Bounded source evidence, separated from trusted instructions and targeting preferences."""

from __future__ import annotations

import ipaddress
import json
import re
from html.parser import HTMLParser
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

from arch_competition_ops.http import HttpError, get_default_client
from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.fingerprints import notice_content_hash
from arch_competition_ops.screening.models import ScreeningDecision, canonical_json
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.screening.providers import provider_identity
from arch_competition_ops.screening.source_evidence import notice_evidence
from arch_competition_ops.settings import Settings

URL = re.compile(r"""https?://[^\s<>"'\\]+""", re.I)


def public_url(value: str) -> str:
    try:
        url = urlsplit(value)
        host = url.hostname or ""
        if (
            url.scheme not in {"http", "https"}
            or "." not in host
            or host.endswith((".local", ".localhost", ".internal"))
        ):
            return ""
        try:
            if not ipaddress.ip_address(host).is_global:
                return ""
        except ValueError:
            pass
        port = f":{url.port}" if url.port else ""
        # Public identifiers survive; unknown query parameters can carry signed credentials.
        query = [
            (k, v)
            for k, v in parse_qsl(url.query)
            if k.lower()
            in {
                "id",
                "noticeid",
                "projectid",
                "oid",
                "publicationid",
                "tenderid",
                "tendno",
                "tendseq",
                "frameworkagreementseq",
                "tendcategcd",
                "intrllocaltypecd",
                "tendmthodcd",
                "invtyn",
                "stenderid",
                "noticeversion",
                "pid",
                "idevl",
                "toid",
                "category",
                "function",
                "uri",
                "meformsnoticeid",
                "projectnumber",
                "docid",
                "resid",
            }
            or (k == "q" and re.fullmatch(r"idweb:[\w-]+", v))
        ]
        return urlunsplit((url.scheme, host + port, url.path, urlencode(query), ""))
    except ValueError:
        return ""


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
        if pending or exc.status_code in {403, 429}:
            raise
        # The existing listing remains usable evidence; its missing fields stay visible.
        return payload
    media = response.headers.get("Content-Type", response.headers.get("content-type", ""))
    if "pdf" in media.lower():
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
    links = _PageLinks(source_url)
    links.feed(source_payload or "")
    links.links.extend(URL.findall(text))
    fields = {}
    remaining = settings.ai_max_input_chars
    for name, value in (
        ("notice_title", title),
        ("notice_url", public_url(source_url)),
        ("notice_text", text),
        (
            "notice_links",
            "\n".join(dict.fromkeys(filter(None, map(public_url, [source_url, *links.links])))),
        ),
    ):
        clean = URL.sub(lambda match: public_url(match[0]), value)
        fields[name] = clean[:remaining]
        if len(clean) > remaining:
            limitations.append("Input was truncated to the configured character limit")
        remaining -= len(fields[name])
    schema = ScreeningDecision.model_json_schema()
    schema["required"] = list(schema["properties"])
    request = {
        "model": model_id or settings.ai_model,
        "instructions": load_screening_instructions(settings),
        "input": canonical_json({"evidence_fields": fields}),
        "max_output_tokens": settings.ai_max_output_tokens,
        "reasoning": {"effort": settings.ai_reasoning_effort},
        "store": False,
        "service_tier": "default",
        "text": {
            "format": {
                "type": "json_schema",
                "name": "competition_screening",
                "strict": True,
                "schema": schema,
            }
        },
    }
    if settings.ai_provider == "chat_completions":
        fmt = request["text"]["format"]
        request = {
            "model": request["model"],
            "messages": [
                {"role": "system", "content": request["instructions"]},
                {"role": "user", "content": request["input"]},
            ],
            "reasoning_effort": settings.ai_reasoning_effort,
            "max_tokens": settings.ai_max_output_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {k: v for k, v in fmt.items() if k != "type"},
            },
        }
    return (
        canonical_json(
            {"provider": provider_identity(settings), "notice_version": version, "request": request}
        ),
        fields,
        sorted(set(limitations)),
    )
