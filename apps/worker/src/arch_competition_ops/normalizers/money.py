from __future__ import annotations

import re
from typing import Any


SPACE_LIKE_CHARACTERS = ("\u00a0", "\u202f")
SCIENTIFIC_NUMBER_PATTERN = re.compile(r"(\d+(?:\.\d+)?[eE][+-]?\d+)")
MONEY_NUMBER_PATTERN = re.compile(
    r"(?<!\d)(\d{1,3}(?:[.,\s\u00A0\u202F'’]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?)(?!\d)"
)


def normalize_money_text(raw_value: str | None) -> str | None:
    if raw_value is None:
        return None

    normalized = raw_value
    for character in SPACE_LIKE_CHARACTERS:
        normalized = normalized.replace(character, " ")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized or None


def _parse_number_token(token: str) -> float | None:
    cleaned = token.strip().replace("'", "").replace("’", "").replace(" ", "")
    for character in SPACE_LIKE_CHARACTERS:
        cleaned = cleaned.replace(character, "")

    if not cleaned:
        return None

    if SCIENTIFIC_NUMBER_PATTERN.fullmatch(cleaned):
        try:
            return float(cleaned)
        except ValueError:
            return None

    if "," in cleaned and "." in cleaned:
        if cleaned.rfind(",") > cleaned.rfind("."):
            cleaned = cleaned.replace(".", "").replace(",", ".")
        else:
            cleaned = cleaned.replace(",", "")
    elif cleaned.count(",") > 1:
        cleaned = cleaned.replace(",", "")
    elif cleaned.count(".") > 1:
        cleaned = cleaned.replace(".", "")
    elif "," in cleaned:
        integer_part, fractional_part = cleaned.rsplit(",", 1)
        if len(fractional_part) == 3 and integer_part:
            cleaned = cleaned.replace(",", "")
        else:
            cleaned = cleaned.replace(",", ".")
    elif "." in cleaned:
        integer_part, fractional_part = cleaned.rsplit(".", 1)
        if len(fractional_part) == 3 and integer_part:
            cleaned = cleaned.replace(".", "")

    try:
        return float(cleaned)
    except ValueError:
        return None


def parse_money_number(raw_value: Any) -> float | None:
    if raw_value is None:
        return None
    if isinstance(raw_value, (int, float)):
        return float(raw_value)

    normalized = normalize_money_text(str(raw_value))
    if not normalized:
        return None

    scientific_match = SCIENTIFIC_NUMBER_PATTERN.search(normalized)
    if scientific_match:
        parsed_scientific = _parse_number_token(scientific_match.group(1))
        if parsed_scientific is not None:
            return parsed_scientific

    match = MONEY_NUMBER_PATTERN.search(normalized)
    if not match:
        return None
    return _parse_number_token(match.group(1))


def format_money_text(
    *,
    amount: Any = None,
    currency: str | None = None,
    raw_text: str | None = None,
) -> str | None:
    normalized_raw_text = normalize_money_text(raw_text)
    if normalized_raw_text:
        return normalized_raw_text

    parsed_amount = parse_money_number(amount)
    if parsed_amount is None:
        return None

    if parsed_amount.is_integer():
        formatted_amount = f"{parsed_amount:,.0f}"
    else:
        formatted_amount = f"{parsed_amount:,.2f}"

    if currency:
        return f"{currency} {formatted_amount}"
    return formatted_amount
