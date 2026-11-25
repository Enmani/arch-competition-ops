"""Select original notice material from a collector envelope."""

import json
import re
from urllib.parse import urlsplit

from arch_competition_ops.screening.field_contract import FIELD_BY_PATH
from arch_competition_ops.screening.notice_urls import stored_link
from arch_competition_ops.screening.readability import visible_text

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


# These keys are local annotations in the identifiable legacy *adapter* format.
# A raw upstream object, including one inside rawNotice, owns its keys and values.
_LOCAL_FIELDS = {
    "opportunityType",
    "evidenceLevel",
    "evidenceNote",
    "competitionTypes",
    "projectTypes",
    "buildingCategories",
    "officialSectors",
    "builtAssetTypes",
    "designScopes",
    "projectModes",
}


def _archive_source(value):
    if (
        isinstance(value, dict)
        and {"opportunityType", "evidenceLevel", "evidenceNote"} <= value.keys()
    ):
        return {k: v for k, v in value.items() if k not in _LOCAL_FIELDS}
    return value


def _source_parts(value, collected):
    if not isinstance(value, dict):
        return [value]
    raw_keys = {"rawNotice", "rawNoticeHtml"}
    # A flat archived source may itself have a rawNoticeHtml field with sibling source facts.
    # Current collectors identify their envelope explicitly. Raw replay wrappers and deferred
    # detail jobs can also be recognised by their reserved wrapper keys alone.
    if (
        "rawNotice" in value
        or "pendingDetailUrl" in value
        or (
            raw_keys.intersection(value)
            and (collected or value.keys() <= raw_keys | {"summary", "extra"})
        )
    ):
        return [v for k, v in value.items() if k in raw_keys and v is not None]
    if collected and "opportunityType" in value and "evidenceNote" not in value:
        # Pre-archive adapter summaries and inferred labels have no original-source provenance.
        return [{k: v for k, v in value.items() if k not in _LOCAL_FIELDS and k != "summary"}]
    return [_archive_source(value)]


def _decode(payload, decoder):
    if isinstance(payload, str) and (text := payload.lstrip()).startswith(("{", "[")):
        try:
            data, end = decoder.raw_decode(text)
            return data, text[end:].strip().removeprefix("Source notice detail:").lstrip()
        except ValueError:
            pass  # Preserve clipped archives as plain text.
    return payload, ""


def _parts(payload, decoder, *, collected):
    value, tail = _decode(payload, decoder)
    return [*_source_parts(value, collected), tail] if tail else _source_parts(value, collected)


def notice_evidence(payload: str, *, collected=True) -> str:
    return "\n".join(
        part if isinstance(part, str) else json.dumps(part, ensure_ascii=False)
        for part in _parts(payload, json.JSONDecoder(), collected=collected)
    ).replace(r"\/", "/")


_HTML = re.compile(r"<(?:[A-Za-z][\w:.-]*(?:\s[^<>]*)?/?>|!--|!DOCTYPE\b)", re.I)


def _lines(value, path, url, links, leaves):
    value, tail = _decode(value, _TEXT_DECODER)
    if isinstance(value, dict):
        for key, item in value.items():
            yield from _lines(item, f"{path}.{key}" if path else key, url, links, leaves)
    elif isinstance(value, list):
        for item in value:
            yield from _lines(item, path, url, links, leaves)
    elif value is not None:
        text = json.dumps(value) if isinstance(value, bool) else str(value)
        if not text.lstrip().startswith(("{", "[")) and _HTML.search(text):
            text, targets = visible_text(text, url, content_only=True)
            text = " ".join(text.split())
            if links is not None:
                links.extend(targets)
        if text.strip():
            if leaves is not None and path in FIELD_BY_PATH:
                leaves.append((path, text))
            yield f"{path}: {text}" if path else text

    if tail:
        yield from _lines(tail, path, url, links, leaves)


def notice_text(payload: str, url="", *, links=None, leaves=None, collected=False) -> str:
    lines = []
    for part in _parts(payload, _TEXT_DECODER, collected=collected):
        value, tail = _decode(part, _TEXT_DECODER)
        if not collected and isinstance(part, str):
            value = _archive_source(value)
        for item in (value, tail):
            lines.extend(_lines(item, "", url, links, leaves))
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
