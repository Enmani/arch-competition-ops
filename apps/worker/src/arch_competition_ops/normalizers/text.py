"""Text normalization shared by relevance filters, inference, and identity helpers."""

from __future__ import annotations

import re
import unicodedata
from collections.abc import Iterable
from functools import lru_cache
from html import unescape
from typing import Any

# Characters that NFKD does not decompose into base + accent.
_LATIN_FOLDS = str.maketrans({"ß": "ss", "æ": "ae", "œ": "oe", "ø": "o", "đ": "d", "ł": "l"})


def fold_latin_accents(value: str) -> str:
    """Strip accents from Latin letters while leaving CJK, kana, and other scripts untouched.

    A blanket ``NFKD`` + ``encode("ascii", "ignore")`` (the previous behaviour) erased every
    non-ASCII character, so Chinese notices normalized to an empty string.
    """
    folded: list[str] = []
    for char in value.translate(_LATIN_FOLDS):
        base = "".join(
            part for part in unicodedata.normalize("NFKD", char) if not unicodedata.combining(part)
        )
        folded.append(base if base.isascii() else char)
    return "".join(folded)


def normalize_text(value: str | None) -> str:
    """Lower-case, accent-fold Latin text, and reduce everything non-alphanumeric to one space.

    Apostrophes become spaces, so ``maîtrise d'oeuvre`` normalizes to ``maitrise d oeuvre``;
    marker lists must be passed through this function too (see ``compile_markers``).
    """
    if not value:
        return ""
    folded = fold_latin_accents(value).lower()
    alphanumeric = "".join(char if char.isalnum() else " " for char in folded)
    return " ".join(alphanumeric.split())


@lru_cache(maxsize=4096)
def _phrase_pattern(normalized_phrase: str) -> re.Pattern[str]:
    escaped = re.escape(normalized_phrase)
    # Only constrain edges that are ASCII word characters: CJK has no spaces between words, so a
    # Chinese marker must be allowed to sit directly next to other Chinese characters.
    prefix = (
        r"(?<![0-9A-Za-z])"
        if normalized_phrase[:1].isascii() and normalized_phrase[:1].isalnum()
        else ""
    )
    suffix = (
        r"(?![0-9A-Za-z])"
        if normalized_phrase[-1:].isascii() and normalized_phrase[-1:].isalnum()
        else ""
    )
    return re.compile(f"{prefix}{escaped}{suffix}")


def contains_phrase(normalized_haystack: str, normalized_phrase: str) -> bool:
    """Whole-word (Latin) / substring (CJK) match on already-normalized text."""
    if not normalized_phrase:
        return False
    return _phrase_pattern(normalized_phrase).search(normalized_haystack) is not None


def compile_markers(markers: Iterable[str]) -> tuple[str, ...]:
    """Normalize a marker list once so it can be matched against ``normalize_text`` output."""
    seen: dict[str, None] = {}
    for marker in markers:
        normalized = normalize_text(marker)
        if normalized:
            seen.setdefault(normalized, None)
    return tuple(seen)


def contains_any_phrase(normalized_haystack: str, normalized_markers: Iterable[str]) -> bool:
    return any(contains_phrase(normalized_haystack, marker) for marker in normalized_markers)


def contains_any_substring(normalized_haystack: str, normalized_markers: Iterable[str]) -> bool:
    """Prefix-stem matching (``architett`` -> ``architetto``) for markers that are stems."""
    return any(marker in normalized_haystack for marker in normalized_markers)


CPV_PATTERN = re.compile(r"\b(\d{8})(?:-\d)?\b")


def extract_cpv_codes(payload: Any) -> list[str]:
    found: list[str] = []

    def visit(value: Any) -> None:
        if isinstance(value, dict):
            for nested_value in value.values():
                visit(nested_value)
            return
        if isinstance(value, list):
            for item in value:
                visit(item)
            return
        if isinstance(value, str):
            found.extend(CPV_PATTERN.findall(value))

    visit(payload)
    return list(dict.fromkeys(found))


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    without_tags = re.sub(r"<[^>]+>", " ", unescape(value))
    collapsed = re.sub(r"\s+", " ", without_tags)
    return collapsed.strip() or None
