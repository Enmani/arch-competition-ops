"""Best-effort bytes -> str decoding for web responses.

Priority: HTTP ``Content-Type`` charset, BOM, in-document declaration (first 4096 bytes), strict
UTF-8, then a statistical guess, then cp1252 with replacement. Each candidate is tried with strict
decoding, so a wrong declaration (common on Chinese sites) falls through to the next candidate.
"""

from __future__ import annotations

import codecs
import re

SNIFF_BYTES = 4096

# Legacy Chinese encodings are strict subsets of GB18030; decoding them all as GB18030 handles
# pages that declare gb2312/gbk but contain characters outside the declared repertoire.
_GB_ALIASES = frozenset(
    {"gb2312", "gb_2312", "gb_2312-80", "gbk", "x-gbk", "cp936", "936", "euc-cn", "gb18030"}
)

_BOMS: tuple[tuple[bytes, str], ...] = (
    (codecs.BOM_UTF8, "utf-8-sig"),
    (codecs.BOM_UTF32_LE, "utf-32"),
    (codecs.BOM_UTF32_BE, "utf-32"),
    (codecs.BOM_UTF16_LE, "utf-16"),
    (codecs.BOM_UTF16_BE, "utf-16"),
)

_HEADER_CHARSET = re.compile(r"charset\s*=\s*[\"']?\s*([^\s;\"']+)", re.IGNORECASE)
_META_TAG = re.compile(rb"<meta\b[^>]*>", re.IGNORECASE)
_META_CHARSET = re.compile(rb"charset\s*=\s*[\"']?\s*([\w.:\-]+)", re.IGNORECASE)
_XML_DECL = re.compile(rb"^\s*<\?xml[^>]*?encoding\s*=\s*[\"']([\w.:\-]+)[\"']", re.IGNORECASE)


def normalize_charset(name: str | None) -> str | None:
    """Return a Python codec name for ``name``, or None if it is empty or unknown."""
    if not name:
        return None
    cleaned = name.strip().strip("\"'").lower()
    if not cleaned:
        return None
    if cleaned in _GB_ALIASES:
        return "gb18030"
    try:
        return codecs.lookup(cleaned).name
    except (LookupError, ValueError):
        return None


def _declared_in_document(content: bytes) -> list[str]:
    head = content[:SNIFF_BYTES]
    names: list[str] = []
    xml = _XML_DECL.match(head)
    if xml:
        names.append(xml.group(1).decode("ascii", "ignore"))
    for tag in _META_TAG.finditer(head):
        found = _META_CHARSET.search(tag.group(0))
        if found:
            names.append(found.group(1).decode("ascii", "ignore"))
    return names


def _candidates(content: bytes, content_type: str | None) -> list[str]:
    ordered: list[str | None] = []
    if content_type:
        header = _HEADER_CHARSET.search(content_type)
        ordered.append(normalize_charset(header.group(1)) if header else None)
    for bom, codec in _BOMS:
        if content.startswith(bom):
            ordered.append(codec)
            break
    for declared in _declared_in_document(content):
        codec = normalize_charset(declared)
        # An ASCII-readable meta tag cannot truthfully announce a 16/32-bit encoding; browsers
        # treat such declarations as UTF-8, so skip them instead of producing mojibake.
        if codec and not codec.startswith(("utf-16", "utf-32")):
            ordered.append(codec)
    ordered.append("utf-8")
    seen: set[str] = set()
    result: list[str] = []
    for codec in ordered:
        if codec and codec not in seen:
            seen.add(codec)
            result.append(codec)
    return result


def _guess(content: bytes) -> str | None:
    try:
        from charset_normalizer import from_bytes
    except ImportError:  # charset_normalizer is a transitive dependency of requests
        return None
    best = from_bytes(content).best()
    return normalize_charset(best.encoding) if best else None


def decode_body(content: bytes, content_type: str | None = None) -> str:
    """Decode ``content`` to text; never raises. A leading BOM character is stripped."""
    if not content:
        return ""
    for codec in _candidates(content, content_type):
        try:
            return content.decode(codec).removeprefix("﻿")
        except (UnicodeDecodeError, LookupError):
            continue
    guessed = _guess(content)
    if guessed:
        try:
            return content.decode(guessed).removeprefix("﻿")
        except UnicodeDecodeError:
            pass
    return content.decode("cp1252", errors="replace")
