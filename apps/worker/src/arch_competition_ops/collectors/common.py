"""Fetch helpers and small parsing utilities shared by collectors.

All network access goes through ``arch_competition_ops.http`` (timeouts, retries, rate limits,
size caps, SSRF guards). This module only adds collector-specific headers and decoding.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any
from urllib import parse

from arch_competition_ops.http import get_default_client
from arch_competition_ops.normalizers.money import parse_money_number

# Several public portals reject unidentified clients, so collectors keep the browser-style
# User-Agent they have always sent. The shared client's own default is honest and is used by
# everything else (geocoding, verifier robots/sitemap fetches).
DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0 Safari/537.36"
    ),
    "Accept": "application/json, text/plain, */*",
}


def build_url(base_url: str, params: dict[str, Any]) -> str:
    query = parse.urlencode(params, doseq=True)
    if not query:
        return base_url
    return f"{base_url}?{query}"


def _headers(extra: dict[str, str] | None) -> dict[str, str]:
    return {**DEFAULT_HEADERS, **(extra or {})}


def fetch_json_get(url: str, *, headers: dict[str, str] | None = None) -> Any:
    return get_default_client().get_json(url, headers=_headers(headers))


def fetch_text_get(
    url: str,
    *,
    headers: dict[str, str] | None = None,
    archive_dir: Path | None = None,
) -> str:
    """GET ``url`` as text; with ``archive_dir`` the raw response is kept there as evidence."""
    return get_default_client().get_text(
        url, headers=_headers(headers), archive=archive_dir or False
    )


def fetch_text_post(
    url: str,
    data: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> str:
    return get_default_client().post_text(
        url,
        data=parse.urlencode(data, doseq=True),
        headers=_headers(
            {"Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", **(headers or {})}
        ),
    )


def fetch_json_post(
    url: str,
    data: dict[str, Any],
    *,
    headers: dict[str, str] | None = None,
) -> Any:
    return get_default_client().post_json(url, json=data, headers=_headers(headers))


def pick_localized_text(
    value: Any, preferred_languages: tuple[str, ...] = ("en", "eng", "fr", "de", "it")
) -> str | None:
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
                picked = pick_localized_text(
                    value[language], preferred_languages=preferred_languages
                )
                if picked:
                    return picked
        for item in value.values():
            picked = pick_localized_text(item, preferred_languages=preferred_languages)
            if picked:
                return picked
    return None


def parse_money_value(raw_value: Any) -> float | None:
    return parse_money_number(raw_value)
