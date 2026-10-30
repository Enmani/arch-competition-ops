"""Rule-based title cleanup: the free first stage of display-title derivation.

It only removes what is demonstrably not part of the project's name (platform prefixes, reference
numbers, stray punctuation) and fixes typography. It never rewrites words, so the result is always
a faithful excerpt of the source title; condensing or translating is the AI stage's job.
"""

from __future__ import annotations

import re
import unicodedata

CLEANER_VERSION = "rules-1"

# A card shows two lines of the 1.25rem face: about 60 Latin letters, or 30 CJK characters.
MAX_PLAIN_WIDTH = 60

_DASH = " – "
# TED notices read "<Country> – <service category> – <title>"; both prefixes duplicate card fields.
_TED_PREFIX = re.compile(r"^[A-Z][A-Za-z.' ]{2,30} – [A-Z][^–]{3,90} – (?=\S)")
# UK Contracts Finder reads "GB-Colchester: <title>".
_PLACE_PREFIX = re.compile(r"^[A-Z]{2}-[^:–]{2,40}: (?=\S)")
# A reference number and separator: "323443 - ", "CON00003990-2026 - ", "1-W-26: ".
_REFERENCE_WITH_SEPARATOR = re.compile(
    r"^(?=[^\s]*\d)[A-Za-z0-9][A-Za-z0-9._/#]*(?:-[A-Za-z0-9ÄÖÜäöü._/]+)*\s*[-–:]\s+(?=\S)"
)
# A reference number that is only separated by a space: "EW699-260375C-NWT Multidisciplinary",
# "BW-12571-GÜ-26 Generalübernehmerleistungen", "01686-270048 Orchard". Only ID-shaped tokens
# qualify (every hyphen segment holds a digit), so "Haus 1", "Los 2" or "M-54 Parking Lot" stay.
_ID_SEGMENT = r"[A-Z]*\d[A-Z0-9]*"
_REFERENCE_SPACE_ONLY = re.compile(
    rf"^(?:[A-Z]{{1,6}}\d[\w./]*(?:-{_ID_SEGMENT})*"
    rf"|\d{{3,}}(?:-{_ID_SEGMENT})+"
    rf"|[A-Z]{{1,4}}-\d{{3,}}(?:-[A-ZÄÖÜ]{{1,3}})?(?:-{_ID_SEGMENT})*)"
    r"(?:\s+|-(?=[A-Z]))(?=[A-Za-zÀ-ÿ])"
)
_MAX_REFERENCE_PASSES = 3
_MIN_REMAINDER = 8

_TRAILING_JUNK = re.compile(r"[\s\-–—.,;:/]+$")
_UNDERSCORE_BETWEEN_LETTERS = re.compile(r"(?<=[^\W\d_])_(?=[^\W\d_])")
_SPACED_HYPHEN = re.compile(r"\s[-—]\s")
_QUOTE_PAIRS = (("„", "“"), ("“", "”"), ("«", "»"), ("‚", "‘"), ("‘", "’"))
# Words that stay upper case when an all-caps title is converted to sentence case.
_KEEP_UPPER = frozenset(
    "HOAI LPH SHA BHO GC RFP RFI RFQ RFSO ITT SSI CPT APS APD DAO EU UK USA NZ BKP KU UIS PPP BIM "
    "HVAC MEP WC TED CPV ESPD GMP VOB SIA".split()
)
_ROMAN_NUMERALS = frozenset("II III IV VI VII VIII IX XI XII".split())
_CJK = re.compile(r"[⺀-鿿豈-﫿＀-￯]")


def display_width(text: str) -> int:
    """Width in Latin-letter units: a CJK or fullwidth character counts as two."""
    return sum(2 if _CJK.match(character) else 1 for character in text)


def _is_all_caps(text: str) -> bool:
    letters = [character for character in text if character.isalpha()]
    if len(letters) < 12:
        return False
    return sum(character.isupper() for character in letters) / len(letters) >= 0.85


def _sentence_case(text: str) -> str:
    def convert(match: re.Match[str]) -> str:
        word = match.group(0)
        if word in _KEEP_UPPER or word in _ROMAN_NUMERALS or any(c.isdigit() for c in word):
            return word
        return word.lower()

    lowered = re.sub(r"[^\W_]+", convert, text)
    for index, character in enumerate(lowered):
        if character.isalpha():
            return lowered[:index] + character.upper() + lowered[index + 1 :]
    return lowered


def _drop_unbalanced_closing_quote(text: str) -> str:
    """A scraped title sometimes keeps a closing quote whose opening half was cut off."""
    if text and text[-1] in "“”’»‘":
        for opening, closing in _QUOTE_PAIRS:
            if text[-1] == closing and opening not in text:
                return text[:-1].rstrip()
    return text


def _strip_prefixes(text: str) -> str:
    for pattern in (_TED_PREFIX, _PLACE_PREFIX):
        stripped = pattern.sub("", text, count=1)
        if len(stripped) >= _MIN_REMAINDER:
            text = stripped
    for _ in range(_MAX_REFERENCE_PASSES):
        for pattern in (_REFERENCE_WITH_SEPARATOR, _REFERENCE_SPACE_ONLY):
            stripped = pattern.sub("", text, count=1)
            if stripped != text and len(stripped) >= _MIN_REMAINDER:
                text = stripped
                break
        else:
            break
    return text


def clean_title(title: str) -> str:
    """The title without platform prefixes, reference numbers and typographic noise."""
    text = unicodedata.normalize("NFC", title).replace(" ", " ")
    text = re.sub(r"\s+", " ", text).strip()
    if not text:
        return text

    text = _strip_prefixes(text)
    text = _UNDERSCORE_BETWEEN_LETTERS.sub(_DASH, text)
    text = _SPACED_HYPHEN.sub(_DASH, text)
    text = _TRAILING_JUNK.sub("", text)
    text = _drop_unbalanced_closing_quote(text)
    if _is_all_caps(text):
        text = _sentence_case(text)
    text = text.strip()
    return text if len(text) >= 4 else re.sub(r"\s+", " ", title).strip()


def needs_condensing(source_title: str, cleaned_title: str) -> bool:
    """Whether the cleaned title still needs the AI stage.

    Too long for a two-line card, or an all-caps title whose lower-casing lost its proper nouns.
    """
    return display_width(cleaned_title) > MAX_PLAIN_WIDTH or _is_all_caps(source_title)
