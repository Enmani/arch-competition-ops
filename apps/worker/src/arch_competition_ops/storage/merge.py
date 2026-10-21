"""Field-level merge applied when a record is ingested for an opportunity that already exists.

The old upsert overwrote every column, so a re-ingest reset ``shortlisted``/``verified``/
``discarded`` rows to ``discovered``, replaced a verified ``official_url`` with ``NULL``, and threw
away notes. This module is the single place that decides, column by column, what survives.
Pure functions only; ``competitions.py`` does the SQL.

Rules
-----
* ``status`` follows ``merge_status`` (a small explicit transition table, below).
* ``official_url`` and ``evidence_note`` are never replaced by an empty value. A *different*
  non-empty ``official_url`` is not adopted silently: the existing one is kept and the disagreement
  is appended to ``evidence_note`` (AGENTS.md rule 3). The note text contains the word
  "conflict", which is what routes the row into the operator review queue.
* ``evidence_level`` never moves to a weaker level (a failed detail fetch must not demote a row).
* Geocode columns travel together: an ingest without coordinates keeps the stored coordinates.
* ``title``, ``source_url``, ``dedup_key``, the two scores, and ``updated_at`` always come from the
  latest ingest (they describe the latest extraction). ``discovered_at`` always stays.
* Every other column keeps the stored value when the incoming one is empty and takes the incoming
  value otherwise, so evidence is never erased by a thinner re-extraction.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

EMPTY_VALUES = (None, "", "[]")

# Statuses that mean a person (or an explicit maintenance command) made a decision.
HUMAN_STATUSES = frozenset({"shortlisted", "verified", "discarded"})

_ALWAYS_INCOMING = frozenset(
    {
        "id",
        "dedup_key",
        "title",
        "source_url",
        "extraction_confidence",
        "qualification_score",
        "updated_at",
    }
)
_GEO_COLUMNS = ("geo_lat", "geo_lng", "geo_source", "geo_confidence")
_SPECIAL = frozenset(
    {"status", "official_url", "evidence_note", "evidence_level", "discovered_at", *_GEO_COLUMNS}
)

_EVIDENCE_RANK = {
    "tertiary": 0,
    "secondary": 1,
    "authority_page": 2,
    "official_listing": 3,
    "official_notice": 4,
}

NOTE_SEPARATOR = "\n"
MAX_NOTE_LINES = 10


def is_empty(value: Any) -> bool:
    return value in EMPTY_VALUES


def merge_status(existing: str | None, incoming: str | None) -> str:
    """Status transition table for ingest-driven updates.

    ===================  =========================================================
    stored status        result of an ingest that carries ``incoming``
    ===================  =========================================================
    (new row)            ``incoming``
    shortlisted/verified/discarded   unchanged (only an explicit command changes them)
    archived             unchanged (a closed notice is never reopened automatically)
    discovered           ``incoming`` (``archived`` when the source reports an award)
    anything else        unchanged
    ===================  =========================================================
    """
    if existing is None:
        return incoming or "discovered"
    if existing in HUMAN_STATUSES or existing == "archived":
        return existing
    if existing == "discovered" and incoming:
        return incoming
    return existing


def _normalize_url(url: str) -> str:
    return url.strip().rstrip("/").lower()


def merge_evidence_note(
    existing: str | None, incoming: str | None, extra_lines: list[str]
) -> str | None:
    """First line is the latest extraction note; later lines accumulate and are de-duplicated."""
    existing_lines = [line for line in (existing or "").split(NOTE_SEPARATOR) if line]
    base = incoming or (existing_lines[0] if existing_lines else None)
    kept = existing_lines[1:] if existing_lines else []

    lines: list[str] = [base] if base else []
    for line in [*kept, *extra_lines]:
        if line and line not in lines:
            lines.append(line)
    if len(lines) > MAX_NOTE_LINES:
        lines = [lines[0], *lines[-(MAX_NOTE_LINES - 1) :]]
    return NOTE_SEPARATOR.join(lines) or None


def merge_rows(
    existing: Mapping[str, Any] | None,
    incoming: dict[str, Any],
    *,
    source_label: str,
) -> dict[str, Any]:
    """Return the row to persist for ``incoming`` given the stored ``existing`` row."""
    if existing is None:
        return incoming

    merged = dict(incoming)
    merged["id"] = existing["id"]
    merged["discovered_at"] = existing["discovered_at"]

    for column, value in incoming.items():
        if column in _ALWAYS_INCOMING or column in _SPECIAL:
            continue
        if is_empty(value):
            merged[column] = existing[column]

    merged["status"] = merge_status(existing["status"], incoming["status"])

    if _EVIDENCE_RANK.get(existing["evidence_level"], -1) > _EVIDENCE_RANK.get(
        incoming["evidence_level"], -1
    ):
        merged["evidence_level"] = existing["evidence_level"]

    if incoming["geo_lat"] is None or incoming["geo_lng"] is None:
        for column in _GEO_COLUMNS:
            merged[column] = existing[column]

    conflict_lines: list[str] = []
    existing_url, incoming_url = existing["official_url"], incoming["official_url"]
    if is_empty(incoming_url):
        merged["official_url"] = existing_url
    elif is_empty(existing_url) or _normalize_url(existing_url) == _normalize_url(incoming_url):
        merged["official_url"] = incoming_url if is_empty(existing_url) else existing_url
    else:
        merged["official_url"] = existing_url
        conflict_lines.append(
            f"Official URL conflict: kept {existing_url}; {source_label} reported {incoming_url}."
        )

    merged["evidence_note"] = merge_evidence_note(
        existing["evidence_note"], incoming["evidence_note"], conflict_lines
    )
    return merged
