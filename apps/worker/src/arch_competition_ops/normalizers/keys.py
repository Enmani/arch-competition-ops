"""Record identity.

``competition id`` is the stable primary key and appears in Web URLs::

    {title slug, <=60 chars}__{source_id}__{token}

``token`` is the normalized ``official_notice_id`` when the notice has one, otherwise the first
10 hex characters of ``sha1(source_url)``. The deadline is deliberately *not* part of the id: a
corrected deadline must update the same row instead of orphaning it. Two different buyers using
the same platform and the same title get different notice ids, hence different rows.

``dedup_key`` (title + buyer + deadline) is a different thing: a fuzzy cross-source duplicate
signal consumed by the review queue. It is never used as a primary key.
"""

from __future__ import annotations

import hashlib
import re

from arch_competition_ops.normalizers.text import fold_latin_accents

MAX_TITLE_SLUG_CHARS = 60
MAX_TOKEN_CHARS = 80


def slugify(value: str, *, max_length: int | None = None) -> str:
    """Lower-case slug of letters/digits (any script) joined by single hyphens.

    Latin accents are folded (``é`` -> ``e``); CJK and other scripts are kept because the Web layer
    percent-encodes slugs and a Chinese notice would otherwise lose its whole title. Underscores
    become hyphens so that ``__`` stays an unambiguous id separator.
    """
    folded = fold_latin_accents(value.strip()).lower()
    slug = re.sub(r"[^\w]+|_+", "-", folded, flags=re.UNICODE)
    slug = re.sub(r"-{2,}", "-", slug).strip("-")
    if max_length is not None:
        slug = slug[:max_length].rstrip("-")
    return slug or "untitled"


def normalize_fragment(value: str) -> str:
    lowered = value.strip().lower()
    normalized = re.sub(r"[^\w]+", "-", lowered, flags=re.UNICODE)
    normalized = re.sub(r"-{2,}", "-", normalized)
    normalized = normalized.strip("-_")
    return normalized or "unknown"


def build_competition_key(title: str, organizer: str, deadline: str) -> str:
    """Cross-source duplicate signal (``dedup_key``). Not an identity."""
    return "__".join(
        [
            normalize_fragment(title),
            normalize_fragment(organizer),
            normalize_fragment(deadline),
        ]
    )


def _identity_token(official_notice_id: str | None, source_url: str) -> str:
    if official_notice_id and official_notice_id.strip():
        return slugify(official_notice_id, max_length=MAX_TOKEN_CHARS)
    return hashlib.sha1(source_url.encode("utf-8")).hexdigest()[:10]


def build_competition_id(
    *,
    title: str,
    source_id: str | None,
    official_notice_id: str | None,
    source_url: str,
) -> str:
    source_part = re.sub(r"[^a-z0-9_-]+", "-", (source_id or "unknown").strip().lower()).strip("-")
    return "__".join(
        [
            slugify(title, max_length=MAX_TITLE_SLUG_CHARS),
            source_part or "unknown",
            _identity_token(official_notice_id, source_url),
        ]
    )
