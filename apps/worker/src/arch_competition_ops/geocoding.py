"""Nominatim geocoding with a persistent JSON cache.

Cache policy: entries are only written for definitive answers (a result, or an empty result set).
Transport errors and non-2xx responses raise out of ``geocode`` and are never cached, so a rate
limit cannot turn into a permanent "not found". The file is written atomically (temp file +
``os.replace``) and at most once per ``save_every`` new entries plus once on ``flush()``; a corrupt
file is moved aside with a warning instead of being silently discarded.
"""

from __future__ import annotations

import json
import logging
import os
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

from arch_competition_ops.http import HttpClient, HttpError, get_default_client
from arch_competition_ops.location import (
    clean_location_label,
    get_country_code_for_jurisdiction,
    get_country_label_for_jurisdiction,
    infer_location_label,
    normalize_jurisdiction_key,
    normalize_location_key,
)
from arch_competition_ops.models import CompetitionRecord

logger = logging.getLogger(__name__)

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_USER_AGENT = "arch-competition-ops/0.1 geocoding-cache"
GEOCODE_CACHE_VERSION = 1
GEOCODE_TIMEOUT_SECONDS = 15.0


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
    geocoder: NominatimGeocoder | None = None,
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
    except (OSError, HttpError) as exc:
        logger.warning("Geocoding %r failed: %s", location_label, exc)
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


class NominatimGeocoder:
    def __init__(
        self,
        *,
        cache_path: Path,
        search_url: str = NOMINATIM_SEARCH_URL,
        client: HttpClient | None = None,
        user_agent: str = NOMINATIM_USER_AGENT,
        save_every: int = 20,
    ) -> None:
        self.cache_path = cache_path
        self.search_url = search_url
        # Request pacing (1 request/second for Nominatim) is enforced by the shared client.
        self.client = client or get_default_client()
        self.user_agent = user_agent
        self.save_every = max(1, save_every)
        self._unsaved = 0
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
        self._unsaved += 1
        if self._unsaved >= self.save_every:
            self.flush()
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

        response = self.client.get(
            f"{self.search_url}?{urlencode(params)}",
            headers={"Accept": "application/json", "User-Agent": self.user_agent},
            timeout=GEOCODE_TIMEOUT_SECONDS,
        )

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

    def _load_cache(self) -> dict[str, dict[str, Any] | None]:
        if not self.cache_path.exists():
            return {}

        try:
            payload = json.loads(self.cache_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            self._quarantine_cache(f"unreadable ({exc})")
            return {}

        if not isinstance(payload, dict) or payload.get("version") != GEOCODE_CACHE_VERSION:
            self._quarantine_cache("has an unexpected structure or version")
            return {}

        entries = payload.get("entries")
        if not isinstance(entries, dict):
            self._quarantine_cache("has no entries mapping")
            return {}

        return {
            str(key): value if isinstance(value, dict) or value is None else None
            for key, value in entries.items()
        }

    def _quarantine_cache(self, reason: str) -> None:
        """Keep the unusable file next to the cache so it can be inspected, and say so."""
        quarantine_path = self.cache_path.with_name(self.cache_path.name + ".corrupt")
        logger.warning(
            "Geocode cache %s is %s; starting with an empty cache and keeping the old file as %s",
            self.cache_path,
            reason,
            quarantine_path,
        )
        try:
            os.replace(self.cache_path, quarantine_path)
        except OSError as exc:
            logger.warning("Could not move aside %s: %s", self.cache_path, exc)

    def flush(self) -> None:
        """Persist the cache atomically if anything changed since the last write."""
        if self._unsaved == 0:
            return
        self.cache_path.parent.mkdir(parents=True, exist_ok=True)
        document = json.dumps(
            {"entries": self._cache, "version": GEOCODE_CACHE_VERSION},
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        handle, temporary_name = tempfile.mkstemp(
            dir=self.cache_path.parent, prefix=self.cache_path.name, suffix=".tmp"
        )
        try:
            with os.fdopen(handle, "w", encoding="utf-8", newline="\n") as temporary_file:
                temporary_file.write(document + "\n")
            os.replace(temporary_name, self.cache_path)
        except BaseException:
            Path(temporary_name).unlink(missing_ok=True)
            raise
        self._unsaved = 0


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
