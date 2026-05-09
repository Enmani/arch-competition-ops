from __future__ import annotations

import re
import unicodedata


COUNTRY_CODE_BY_JURISDICTION = {
    "austria": "at",
    "belgium": "be",
    "bulgaria": "bg",
    "canada": "ca",
    "china": "cn",
    "croatia": "hr",
    "czechia": "cz",
    "denmark": "dk",
    "estonia": "ee",
    "finland": "fi",
    "france": "fr",
    "germany": "de",
    "greece": "gr",
    "hungary": "hu",
    "ireland": "ie",
    "italy": "it",
    "latvia": "lv",
    "lithuania": "lt",
    "luxembourg": "lu",
    "netherlands": "nl",
    "new_zealand": "nz",
    "norway": "no",
    "poland": "pl",
    "portugal": "pt",
    "romania": "ro",
    "serbia": "rs",
    "slovakia": "sk",
    "slovenia": "si",
    "spain": "es",
    "sweden": "se",
    "switzerland": "ch",
    "united-kingdom": "gb",
    "united_kingdom": "gb",
}

COUNTRY_LABEL_BY_JURISDICTION = {
    "austria": "Austria",
    "belgium": "Belgium",
    "bulgaria": "Bulgaria",
    "canada": "Canada",
    "china": "China",
    "croatia": "Croatia",
    "czechia": "Czechia",
    "denmark": "Denmark",
    "estonia": "Estonia",
    "finland": "Finland",
    "france": "France",
    "germany": "Germany",
    "greece": "Greece",
    "hungary": "Hungary",
    "ireland": "Ireland",
    "italy": "Italy",
    "latvia": "Latvia",
    "lithuania": "Lithuania",
    "luxembourg": "Luxembourg",
    "netherlands": "Netherlands",
    "new_zealand": "New Zealand",
    "norway": "Norway",
    "poland": "Poland",
    "portugal": "Portugal",
    "romania": "Romania",
    "serbia": "Serbia",
    "slovakia": "Slovakia",
    "slovenia": "Slovenia",
    "spain": "Spain",
    "sweden": "Sweden",
    "switzerland": "Switzerland",
    "united-kingdom": "United Kingdom",
    "united_kingdom": "United Kingdom",
}

LOCATION_STOPWORDS = {
    "amt",
    "authority",
    "bauamt",
    "cabildo",
    "council",
    "department",
    "office",
    "procurement",
    "regierung",
}

PLACEHOLDER_LOCATION_MARKERS = {
    "beispiel",
    "demo",
    "example",
    "local",
    "sample",
    "test",
    "unknown",
}


def normalize_location_key(value: str | None) -> str:
    if not value:
        return ""
    normalized = unicodedata.normalize("NFKD", value)
    ascii_only = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^a-z0-9]+", " ", ascii_only.lower()).strip()


def clean_location_label(value: str | None) -> str | None:
    if not value:
        return None

    cleaned = re.sub(r"\s+", " ", value)
    cleaned = cleaned.strip(" ,;:.()[]{}")
    if not cleaned:
        return None

    words = cleaned.split()
    if len(words) > 5:
        return None

    normalized = normalize_location_key(cleaned)
    if not normalized:
        return None
    if any(marker in normalized.split() for marker in PLACEHOLDER_LOCATION_MARKERS):
        return None
    if any(stopword in normalized.split() for stopword in LOCATION_STOPWORDS):
        return None

    return cleaned


def infer_location_label(
    *,
    authority_name: str | None = None,
    title: str | None = None,
) -> str | None:
    for candidate in _title_location_candidates(title):
        cleaned = clean_location_label(candidate)
        if cleaned:
            return cleaned

    for candidate in _authority_location_candidates(authority_name):
        cleaned = clean_location_label(candidate)
        if cleaned:
            return cleaned

    return None


def normalize_jurisdiction_key(value: str | None) -> str | None:
    if not value:
        return None
    normalized = value.strip().lower().replace("-", "_")
    return normalized or None


def get_country_code_for_jurisdiction(value: str | None) -> str | None:
    jurisdiction = normalize_jurisdiction_key(value)
    if not jurisdiction:
        return None
    return COUNTRY_CODE_BY_JURISDICTION.get(jurisdiction)


def get_country_label_for_jurisdiction(value: str | None) -> str | None:
    jurisdiction = normalize_jurisdiction_key(value)
    if not jurisdiction:
        return None
    return COUNTRY_LABEL_BY_JURISDICTION.get(jurisdiction)


def _title_location_candidates(title: str | None) -> list[str]:
    if not title:
        return []

    candidates: list[str] = []
    postal_tail_match = re.search(
        r",\s*(?:\d{4,6}\s+)?([\wÀ-ž'’.\-]+(?:[\s-][\wÀ-ž'’.\-]+){0,3})\s*$",
        title,
        flags=re.UNICODE,
    )
    if postal_tail_match:
        candidates.append(postal_tail_match.group(1))

    municipal_match = re.search(
        r"\bt[eé]rmino municipal de\s+(.+?)(?:\s+de la provincia|\s*[.;,]|$)",
        title,
        flags=re.IGNORECASE,
    )
    if municipal_match:
        candidates.append(municipal_match.group(1))

    commune_match = re.search(
        r"\bcommune de\s+([A-ZÀ-Þ][\wÀ-ž'’.\-]+(?:[\s-][A-ZÀ-Þ][\wÀ-ž'’.\-]+){0,3})(?:\s*[.;,]|$)",
        title,
        flags=re.IGNORECASE | re.UNICODE,
    )
    if commune_match:
        candidates.append(commune_match.group(1))

    project_of_matches = re.findall(
        r"\bde\s+([A-ZÀ-Þ][\wÀ-ž'’.\-]+(?:[\s-][A-ZÀ-Þ][\wÀ-ž'’.\-]+){0,3})(?:\s*[.;,()]|$)",
        title,
        flags=re.UNICODE,
    )
    candidates.extend(reversed(project_of_matches))

    location_phrase_match = re.search(
        r"\b(?:in|at|à|a)\s+([A-ZÀ-Þ][\wÀ-ž'’.\-]+(?:[\s-][A-ZÀ-Þ][\wÀ-ž'’.\-]+){0,3})(?:\s*[.;,()]|$)",
        title,
        flags=re.UNICODE,
    )
    if location_phrase_match:
        candidates.append(location_phrase_match.group(1))

    return candidates


def _authority_location_candidates(authority_name: str | None) -> list[str]:
    if not authority_name:
        return []

    patterns = [
        r"\b(?:gemeindeverwaltung|gemeinde|commune de|ville de|city of|municipality of|ayuntamiento de|municipio de|comune(?: di)?|citt[aà] di|stadt)\s+(.+?)(?:\s*\(|\s+-|,|$)",
        r"^(.+?)\s+parish council\b",
        r"^(.+?)\s+district council\b",
    ]
    candidates: list[str] = []
    for pattern in patterns:
        match = re.search(pattern, authority_name, flags=re.IGNORECASE | re.UNICODE)
        if match:
            candidates.append(match.group(1))

    return candidates
