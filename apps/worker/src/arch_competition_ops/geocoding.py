from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import requests

from arch_competition_ops.location import (
    clean_location_label,
    get_country_code_for_jurisdiction,
    get_country_label_for_jurisdiction,
    infer_location_label,
    normalize_jurisdiction_key,
    normalize_location_key,
)
from arch_competition_ops.models import CompetitionRecord

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "arch-competition-ops/0.1 geocoding-cache"
GEOCODE_CACHE_VERSION = 1


@dataclass(frozen=True)
class GeocodeResult:
    confidence: float
    label: str
    lat: float
    lng: float
    provider: str


def enrich_record_geocode(
    record: CompetitionRecord,
    *,
    cache_path: Path,
    geocoder: "NominatimGeocoder | None" = None,
) -> CompetitionRecord:
    if _has_valid_coordinates(record):
        if record.location_label is None:
            record.location_label = infer_location_label(
                authority_name=record.authority_name,
                title=record.title,
            )
        return record

    location_label = record.location_label or infer_location_label(
        authority_name=record.authority_name,
        title=record.title,
    )
    location_label = clean_location_label(location_label)
    if not location_label:
        return record

    country_label = get_country_label_for_jurisdiction(record.jurisdiction)
    if not country_label:
        return record

    resolver = geocoder or NominatimGeocoder(cache_path=cache_path)
    try:
        result = resolver.geocode(
            location_label=location_label,
            jurisdiction=record.jurisdiction,
        )
    except (OSError, requests.RequestException):
        record.location_label = location_label
        return record
    if not result:
        record.location_label = location_label
        return record

    record.location_label = result.label
    record.geo_lat = result.lat
    record.geo_lng = result.lng
    record.geo_source = result.provider
    record.geo_confidence = result.confidence
    return record


def enrich_records_geocode(
    records: list[CompetitionRecord],
    *,
    cache_path: Path,
    geocoder: "NominatimGeocoder | None" = None,
) -> list[CompetitionRecord]:
    resolver = geocoder or NominatimGeocoder(cache_path=cache_path)
    return [
        enrich_record_geocode(record, cache_path=cache_path, geocoder=resolver)
        for record in records
    ]


class NominatimGeocoder:
    def __init__(
        self,
        *,
        cache_path: Path,
        min_interval_seconds: float = 1.1,
        search_url: str = NOMINATIM_SEARCH_URL,
        session: requests.Session | None = None,
        user_agent: str = NOMINATIM_USER_AGENT,
    ) -> None:
        self.cache_path = cache_path
        self.min_interval_seconds = min_interval_seconds
        self.search_url = search_url
        self.session = session or requests.Session()
        self.user_agent = user_agent
        self._last_request_at = 0.0
        self._cache = self._load_cache()

    def geocode(
        self,
        *,
        location_label: str,
        jurisdiction: str | None,
    ) -> GeocodeResult | None:
        country_label = get_country_label_for_jurisdiction(jurisdiction)
        if not country_label:
            return None

        cleaned_location = clean_location_label(location_label)
        if not cleaned_location:
            return None

        cache_key = _build_cache_key(cleaned_location, jurisdiction)
        if cache_key in self._cache:
            return _result_from_cache_entry(self._cache[cache_key])

        result = self._fetch_geocode(
            location_label=cleaned_location,
            jurisdiction=jurisdiction,
            country_label=country_label,
        )
        self._cache[cache_key] = _cache_entry_from_result(result)
        self._save_cache()
        return result

    def _fetch_geocode(
        self,
        *,
        location_label: str,
        jurisdiction: str | None,
        country_label: str,
    ) -> GeocodeResult | None:
        country_code = get_country_code_for_jurisdiction(jurisdiction)
        params = {
            "addressdetails": "1",
            "format": "jsonv2",
            "limit": "1",
            "q": f"{location_label}, {country_label}",
        }
        if country_code:
            params["countrycodes"] = country_code

        self._wait_for_rate_limit()
        response = self.session.get(
            f"{self.search_url}?{urlencode(params)}",
            headers={
                "Accept": "application/json",
                "User-Agent": self.user_agent,
            },
            timeout=15,
        )
        self._last_request_at = time.monotonic()
        response.raise_for_status()

        try:
            payload = response.json()
        except ValueError:
            return None

        if not isinstance(payload, list) or not payload:
            return None

        first = payload[0]
        if not isinstance(first, dict):
            return None

        return _parse_nominatim_result(
            first,
            fallback_label=location_label,
            jurisdiction=jurisdiction,
        )

    def _wait_for_rate_limit(self) -> None:
        elapsed = time.monotonic() - self._last_request_at
        remaining = self.min_interval_seconds - elapsed
        if remaining > 0:
            time.sleep(remaining)

    def _load_cache(self) -> dict[str, dict[str, Any] | None]:
        if not self.cache_path.exists():
            return {}

        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return {}

        if not isinstance(payload, dict) or payload.get("version") != GEOCODE_CACHE_VERSION:
            return {}

        entries = payload.get("entries")
        if not isinstance(entries, dict):
            return {}

        return {
            str(key): value if isinstance(value, dict) or value is None else None
            for key, value in entries.items()
        }

    def _save_cache(self) -> None:
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "entries": self._cache,
            "version": GEOCODE_CACHE_VERSION,
        }
        self.cache_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )


def _has_valid_coordinates(record: CompetitionRecord) -> bool:
    return (
        record.geo_lat is not None
        and record.geo_lng is not None
        and -90 <= record.geo_lat <= 90
        and -180 <= record.geo_lng <= 180
    )


def _build_cache_key(location_label: str, jurisdiction: str | None) -> str:
    jurisdiction_key = normalize_jurisdiction_key(jurisdiction) or "unknown"
    return f"{jurisdiction_key}:{normalize_location_key(location_label)}"


def _parse_nominatim_result(
    value: dict[str, Any],
    *,
    fallback_label: str,
    jurisdiction: str | None,
) -> GeocodeResult | None:
    try:
        lat = float(value.get("lat"))
        lng = float(value.get("lon"))
    except (TypeError, ValueError):
        return None

    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        return None

    address = value.get("address")
    label = _pick_address_label(address if isinstance(address, dict) else {}, fallback_label)
    confidence = _estimate_confidence(value, jurisdiction=jurisdiction)
    return GeocodeResult(
        confidence=confidence,
        label=label,
        lat=lat,
        lng=lng,
        provider="nominatim",
    )


def _pick_address_label(address: dict[str, Any], fallback_label: str) -> str:
    for key in ("city", "town", "village", "municipality", "hamlet", "suburb"):
        value = address.get(key)
        if isinstance(value, str):
            cleaned = clean_location_label(value)
            if cleaned:
                return cleaned
    return fallback_label


def _estimate_confidence(value: dict[str, Any], *, jurisdiction: str | None) -> float:
    class_name = str(value.get("class") or "")
    type_name = str(value.get("type") or "")
    importance = value.get("importance")
    try:
        importance_value = float(importance)
    except (TypeError, ValueError):
        importance_value = 0.5

    confidence = 0.68
    if class_name == "place":
        confidence += 0.14
    if type_name in {"city", "town", "village", "municipality"}:
        confidence += 0.1
    if get_country_code_for_jurisdiction(jurisdiction):
        confidence += 0.04
    confidence += max(0.0, min(0.08, (importance_value - 0.4) * 0.16))
    return round(min(confidence, 0.96), 2)


def _cache_entry_from_result(result: GeocodeResult | None) -> dict[str, Any] | None:
    if result is None:
        return None
    return {
        "confidence": result.confidence,
        "label": result.label,
        "lat": result.lat,
        "lng": result.lng,
        "provider": result.provider,
    }


def _result_from_cache_entry(value: dict[str, Any] | None) -> GeocodeResult | None:
    if value is None:
        return None
    try:
        return GeocodeResult(
            confidence=float(value["confidence"]),
            label=str(value["label"]),
            lat=float(value["lat"]),
            lng=float(value["lng"]),
            provider=str(value["provider"]),
        )
    except (KeyError, TypeError, ValueError):
        return None
