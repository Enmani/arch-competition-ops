"""Select original notice material from a collector envelope."""

import json
import re
from urllib.parse import urlsplit

from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.notice_urls import stored_link

# Model input needs the source number's spelling, including decimals beyond binary64 precision.
_TEXT_DECODER = json.JSONDecoder(parse_int=str, parse_float=str)


def notice_title(payload: str) -> str:
    text = payload.lstrip()
    if not text.startswith("{"):
        return ""
    try:
        envelope, _ = json.JSONDecoder().raw_decode(text)
    except ValueError:
        return ""
    raw = envelope.get("rawNotice")
    for source in (envelope, raw):
        if (
            isinstance(source, dict)
            and isinstance(title := source.get("title"), str)
            and title.strip()
        ):
            return title.strip()
    return ""


def _parts(payload: str, decoder: json.JSONDecoder) -> list:
    stripped = payload.lstrip()
    if not stripped.startswith("{"):
        return [payload]
    try:
        notice, end = decoder.raw_decode(stripped)
    except ValueError:
        return []
    parts = []
    for key in ("rawNotice", "rawNoticeHtml"):
        value = notice.get(key)
        if isinstance(value, str):
            parts.append(value)
        elif key == "rawNotice" and isinstance(value, dict | list):
            parts.append(value)
    if not parts:
        parts.append(
            {key: notice[key] for key in ("title", "category") if isinstance(notice.get(key), str)}
        )
    tail = stripped[end:].lstrip("\n")
    detail = tail.removeprefix("Source notice detail:\n")
    if detail != tail:
        parts.append(detail)
    return parts


def notice_evidence(payload: str) -> str:
    parts = _parts(payload, json.JSONDecoder())
    return "\n".join(
        part if isinstance(part, str) else json.dumps(part, ensure_ascii=False) for part in parts
    ).replace(r"\/", "/")


def _decoded(value):
    if isinstance(value, str) and value.lstrip().startswith(("{", "[")):
        try:
            return _TEXT_DECODER.decode(value.strip())
        except ValueError:
            pass
    return value


def _lines(value, path=""):
    value = _decoded(value)
    if isinstance(value, dict):
        for key in sorted(value):
            yield from _lines(value[key], f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for item in value:
            yield from _lines(item, path)
    elif value is not None and value != "":
        text = json.dumps(value) if isinstance(value, bool) else str(value)
        yield f"{path}: {text}" if path else text


def _plain_text(part):
    visible = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", part, flags=re.I | re.S)
    return strip_html(visible.replace(r"\/", "/")) or ""


def notice_text(payload: str) -> str:
    parts = [_decoded(raw) for raw in _parts(payload, _TEXT_DECODER)]
    if all(isinstance(part, str) for part in parts):
        return _plain_text("\n".join(parts))
    lines = []
    for part in parts:
        if isinstance(part, dict | list):
            lines.extend(_lines(part))
        elif text := _plain_text(part):
            lines.append(text)
    return "\n".join(lines)


def exclusion_identity(source, payload, url):
    """Match a prior record by its upstream ID or an individual notice URL, never a site root."""
    try:
        envelope = json.loads(payload)
    except ValueError:
        envelope = None
    upstream_id = envelope.get("officialNoticeId") if isinstance(envelope, dict) else None
    url = stored_link(url)[0]
    parts = urlsplit(url)
    if (parts.path in {"", "/"} and not (parts.query or parts.fragment)) or (
        url.rstrip("/") == source.base_url.rstrip("/")
        and source.collector != "generic_notice_pages"
    ):
        url = None
    return source.source_id, str(upstream_id) if upstream_id is not None else None, url
