from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime
from html import unescape
from typing import Any
from urllib import parse, request

from arch_competition_ops.normalizers.money import parse_money_number


DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}

CPV_PATTERN = re.compile(r"\b(\d{8})(?:-\d)?\b")
STRONG_POSITIVE_MARKERS = (
    "architect",
    "architecture",
    "architett",
    "architecte",
    "architectural",
    "progettazione",
    "maitrise d oeuvre",
    "maitrise d ouvrage",
    "maîtrise d'oeuvre",
    "masterplan",
    "urban design",
    "landscape",
    "planungswettbewerb",
    "projektwettbewerb",
    "design competition",
    "project competition",
    "concours",
    "competition",
    "design services",
)
NEGATIVE_MARKERS = (
    "student",
    "students",
    "workshop",
    "award",
    "poster",
    "logo",
    "photography",
    "graphic design",
    "stationery",
    "cancelleria",
    "printing",
    "stampa",
    "grafica",
    "sito web",
    "website",
    "bollettazione",
    "depurazione",
    "rilevazione incendi",
    "impianti elettrici",
    "wayfinding",
    "segnaletica",
    "testvergabe",
    "dies ist eine testvergabe",
    "bitte weder bewerben",
)
RELEVANT_CPV_PREFIXES = ("712", "7142")
BUILT_ENVIRONMENT_MARKERS = (
    "building",
    "civic",
    "library",
    "museum",
    "school",
    "college",
    "campus",
    "hospital",
    "housing",
    "public space",
    "urban",
    "waterfront",
    "landscape",
    "masterplan",
    "rehabilitation",
    "renovation",
    "extension",
    "biblioteca",
    "scuola",
    "museo",
    "ospedale",
    "edificio",
    "piazza",
    "urbanistica",
    "riqualificazione",
    "rigenerazione",
    "civico",
    "logement",
    "architecture",
)

MONTH_NAME_FORMATS = (
    "%a, %d %b %Y %H:%M:%S %z",
    "%d %B %Y",
    "%d %b %Y",
)


def build_url(base_url: str, params: dict[str, Any]) -> str:
    query = parse.urlencode(params, doseq=True)
    if not query:
        return base_url
    return f"{base_url}?{query}"


def fetch_json_get(url: str, *, headers: dict[str, str] | None = None) -> Any:
    http_request = request.Request(url, headers={**DEFAULT_HEADERS, **(headers or {})})
    with request.urlopen(http_request, timeout=30) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8-sig"))


def fetch_text_get(url: str, *, headers: dict[str, str] | None = None) -> str:
    http_request = request.Request(url, headers={**DEFAULT_HEADERS, **(headers or {})})
    with request.urlopen(http_request, timeout=30) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def fetch_text_post(
    url: str,
    data: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> str:
    encoded = parse.urlencode(data, doseq=True).encode("utf-8")
    http_request = request.Request(
        url,
        data=encoded,
        headers={
            **DEFAULT_HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            **(headers or {}),
        },
        method="POST",
    )
    with request.urlopen(http_request, timeout=30) as response:  # noqa: S310
        return response.read().decode("utf-8", errors="replace")


def fetch_json_post(
    url: str,
    data: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> Any:
    encoded = json.dumps(data).encode("utf-8")
    http_request = request.Request(
        url,
        data=encoded,
        headers={
            **DEFAULT_HEADERS,
            "Content-Type": "application/json; charset=utf-8",
            **(headers or {}),
        },
        method="POST",
    )
    with request.urlopen(http_request, timeout=30) as response:  # noqa: S310
        return json.loads(response.read().decode("utf-8-sig"))


def normalize_text(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    alphanumeric_only = "".join(char if char.isalnum() else " " for char in ascii_only.lower())
    return " ".join(alphanumeric_only.split())


def pick_localized_text(value: Any, preferred_languages: tuple[str, ...] = ("en", "eng", "fr", "de", "it")) -> str | None:
    if isinstance(value, str):
        return value.strip() or None
    if isinstance(value, list):
        for item in value:
            picked = pick_localized_text(item, preferred_languages=preferred_languages)
            if picked:
                return picked
        return None
    if isinstance(value, dict):
        for language in preferred_languages:
            if language in value:
                picked = pick_localized_text(value[language], preferred_languages=preferred_languages)
                if picked:
                    return picked
        for item in value.values():
            picked = pick_localized_text(item, preferred_languages=preferred_languages)
            if picked:
                return picked
    return None


def parse_date_string(raw_value: str | None) -> str | None:
    if not raw_value:
        return None

    cleaned = unescape(raw_value).strip()
    cleaned = re.sub(r"\s+", " ", cleaned)
    candidates = [
        cleaned,
        cleaned.replace("/", "-"),
        cleaned.split("T")[0],
        cleaned.split(" ")[0],
    ]

    for candidate in candidates:
        try:
            return date.fromisoformat(candidate).isoformat()
        except ValueError:
            continue

    try:
        return datetime.fromisoformat(cleaned).date().isoformat()
    except ValueError:
        pass

    for fmt in MONTH_NAME_FORMATS:
        try:
            return datetime.strptime(cleaned, fmt).date().isoformat()
        except ValueError:
            continue

    match = re.search(r"(\d{2}/\d{2}/\d{4})", cleaned)
    if match:
        try:
            return datetime.strptime(match.group(1), "%d/%m/%Y").date().isoformat()
        except ValueError:
            return None

    match = re.search(r"(\d{2}\.\d{2}\.\d{4})", cleaned)
    if match:
        try:
            return datetime.strptime(match.group(1), "%d.%m.%Y").date().isoformat()
        except ValueError:
            return None

    match = re.search(r"([A-Za-z]{3,9} \d{1,2}, \d{4})", cleaned)
    if match:
        for fmt in ("%B %d, %Y", "%b %d, %Y"):
            try:
                return datetime.strptime(match.group(1), fmt).date().isoformat()
            except ValueError:
                continue

    return None


def parse_money_value(raw_value: Any) -> float | None:
    return parse_money_number(raw_value)


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
            for code in CPV_PATTERN.findall(value):
                found.append(code)

    visit(payload)

    deduped: list[str] = []
    seen: set[str] = set()
    for code in found:
        if code in seen:
            continue
        seen.add(code)
        deduped.append(code)
    return deduped


def is_design_relevant(
    *chunks: str | None,
    cpv_codes: list[str] | None = None,
    categories: list[str] | None = None,
    require_professional_category: bool = False,
) -> bool:
    normalized_chunks = [normalize_text(chunk) for chunk in chunks if chunk]
    haystack = " ".join(normalized_chunks)

    normalized_categories = [normalize_text(category) for category in (categories or []) if category]
    if normalized_categories:
        has_professional_category = any("professional" in category for category in normalized_categories)
        if any("student" in category for category in normalized_categories) and not has_professional_category:
            return False
        if require_professional_category and not has_professional_category:
            return False

    if any(marker in haystack for marker in NEGATIVE_MARKERS):
        return False

    if any(marker in haystack for marker in STRONG_POSITIVE_MARKERS):
        return True

    return any(code.startswith(RELEVANT_CPV_PREFIXES) for code in (cpv_codes or []))


def has_built_environment_context(*chunks: str | None) -> bool:
    haystack = " ".join(normalize_text(chunk) for chunk in chunks if chunk)
    return any(marker in haystack for marker in BUILT_ENVIRONMENT_MARKERS)


def strip_html(value: str | None) -> str | None:
    if not value:
        return None
    without_tags = re.sub(r"<[^>]+>", " ", unescape(value))
    collapsed = re.sub(r"\s+", " ", without_tags)
    return collapsed.strip() or None
