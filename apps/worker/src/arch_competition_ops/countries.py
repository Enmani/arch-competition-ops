"""Which country a record is about, for sources that do not say.

A record's ``jurisdiction`` is the product's own vocabulary: the targeted countries plus the
generic ``eu``, ``europe`` and ``global`` that multi-country sources (TED, the Islamic Development
Bank) fall back to. Everything downstream needs a real country: geocoding is limited to it, the
card draws its outline and prints its code. A generic jurisdiction used to end all of that
silently: no coordinates, no satellite image, no outline, a card captioned "GL" or "EU".

The notice usually does say where the project is: ``"placeOfPerformance": ["DEE06", "DEU"]``,
``"country": "Uganda"``, "Place of performance Country : Côte d'Ivoire", or a "Country – " lead on
the title. This module reads those, against the country registry the web app shares
(``packages/previews/data/countries.json``, built by ``scripts/build-country-registry.mjs``, which
also writes the copy in ``data/`` next to this module), so both sides agree on what a name means.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from functools import lru_cache
from importlib import resources
from typing import Any

logger = logging.getLogger(__name__)

_REGISTRY_FILE = "countries.json"

GENERIC_JURISDICTIONS = frozenset(
    {"eu", "europe", "global", "international", "unknown", "worldwide"}
)

# Names that stand for more than one country in running text, whatever the registry lists.
_AMBIGUOUS_NAMES = frozenset({"congo", "guinea", "korea", "sudan", "georgia"})
# Shorter names ("uk", "usa", "oman") match only as a whole segment.
_MIN_FREE_TEXT_ALIAS = 5
_MAX_ALIAS_WORDS = 4
_HAN = re.compile(r"[぀-ヿ㐀-鿿가-힯]")


def _normalise(value: str) -> str:
    text = unicodedata.normalize("NFKD", value)
    text = "".join(char for char in text if not unicodedata.combining(char)).lower()
    text = re.sub(r"[’‘`´]", "'", text)
    return re.sub(r"\s+", " ", text).strip()


@lru_cache(maxsize=1)
def country_registry() -> dict[str, dict[str, Any]]:
    """slug -> entry (en, zh, iso2, iso3, aliases); {} if the file is missing."""
    try:
        source = resources.files("arch_competition_ops") / "data" / _REGISTRY_FILE
        return json.loads(source.read_text(encoding="utf-8"))["countries"]
    except (OSError, ValueError, KeyError):
        logger.warning("Country registry is unavailable; countries are not resolved")
        return {}


def normalize_slug(value: str | None) -> str | None:
    if not value:
        return None
    slug = re.sub(r"[\s-]+", "_", value.strip().lower())
    return slug or None


def is_generic_jurisdiction(value: str | None) -> bool:
    slug = normalize_slug(value)
    return slug is None or slug in GENERIC_JURISDICTIONS


def get_country_entry(value: str | None) -> dict[str, Any] | None:
    slug = normalize_slug(value)
    return country_registry().get(slug) if slug else None


@lru_cache(maxsize=1)
def _alias_index() -> tuple[dict[str, str], dict[str, str], list[tuple[str, str]], dict[str, str]]:
    owners: dict[str, set[str]] = {}
    for slug, entry in country_registry().items():
        for alias in entry.get("aliases", []):
            owners.setdefault(alias, set()).add(slug)
    words: dict[str, str] = {}
    whole: dict[str, str] = {}
    unspaced: list[tuple[str, str]] = []
    for alias, slugs in owners.items():
        # A name two countries share ("congo", "guinea") says nothing on its own.
        if len(slugs) != 1 or alias in _AMBIGUOUS_NAMES:
            continue
        (slug,) = slugs
        whole[alias] = slug
        if _HAN.search(alias):
            if len(alias) >= 2:
                unspaced.append((alias, slug))
        elif len(alias) >= _MIN_FREE_TEXT_ALIAS:
            words[alias] = slug
    unspaced.sort(key=lambda item: -len(item[0]))
    by_iso3 = {
        entry["iso3"]: slug for slug, entry in country_registry().items() if entry.get("iso3")
    }
    return words, whole, unspaced, by_iso3


def resolve_country_from_text(segment: str | None) -> str | None:
    """The country a short piece of text names, or None: whole-segment names, then whole words."""
    if not segment:
        return None
    words, whole, unspaced, _ = _alias_index()
    text = _normalise(segment)
    if not text:
        return None
    exact = whole.get(text.rstrip(".,;:() ").strip())
    if exact:
        return exact
    tokens = [token for token in re.split(r"[^\w']+", text) if token]
    for size in range(min(_MAX_ALIAS_WORDS, len(tokens)), 0, -1):
        for start in range(len(tokens) - size + 1):
            found = words.get(" ".join(tokens[start : start + size]))
            if found:
                return found
    if _HAN.search(text):
        for alias, slug in unspaced:
            if alias in text:
                return slug
    return None


def resolve_country_from_iso3(code: str | None) -> str | None:
    return _alias_index()[3].get(code.upper()) if code else None


_PLACE_OF_PERFORMANCE = re.compile(r'"placeOfPerformance"\s*:\s*\[([^\]]*)\]')
_COUNTRY_KEY = re.compile(r'"country"\s*:\s*"([^"]{2,80})"')
_COUNTRY_TEXT = re.compile(
    r"Place of performance\s+Country\s*:\s*(.{2,60}?)"
    r"(?:\s+(?:Additional information|Description|Region|City|Postal|Street|Address|NUTS)\b"
    r"|\s{2,}|$)",
    re.IGNORECASE | re.DOTALL,
)
_TITLE_LEAD = re.compile(r"^\s*([^–—]{2,40}?)\s+[–—]\s+")


def resolve_record_country(
    *,
    title: str | None = None,
    location_labels: list[str | None] | None = None,
    notice_text: str | None = None,
) -> str | None:
    """The country slug a notice states, from the most to the least reliable statement.

    1. TED's structured place of performance (ISO 3166-1 alpha-3 next to the NUTS codes);
    2. a ``country`` field in the listing (the Islamic Development Bank);
    3. "Place of performance Country : ..." in the notice text;
    4. the place names the record carries, last segment first (an address ends with its country);
    5. the "Country – " lead of the title (TED), and nothing else of the title.
    """
    text = notice_text or ""
    match = _PLACE_OF_PERFORMANCE.search(text)
    if match:
        for code in re.findall(r'"([A-Z]{3})"', match.group(1)):
            found = resolve_country_from_iso3(code)
            if found:
                return found
    match = _COUNTRY_KEY.search(text)
    if match:
        found = resolve_country_from_text(match.group(1))
        if found:
            return found
    match = _COUNTRY_TEXT.search(text)
    if match:
        found = resolve_country_from_text(match.group(1))
        if found:
            return found
    for label in location_labels or []:
        for segment in reversed(
            [part.strip() for part in (label or "").split(",") if part.strip()]
        ):
            found = resolve_country_from_text(segment)
            if found:
                return found
    lead = _TITLE_LEAD.match(title or "")
    return resolve_country_from_text(lead.group(1)) if lead else None
