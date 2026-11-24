"""OCDS releases from Contracts Finder and Find a Tender."""

from __future__ import annotations

import logging
from collections.abc import Callable, Iterator
from typing import Any
from urllib.parse import urlsplit

from arch_competition_ops.collectors.pagination import page_limit, unfinished_page
from arch_competition_ops.normalizers.money import format_money_text

logger = logging.getLogger(__name__)

# Find a Tender documents 100 as its maximum page size (a request for 500 returned an empty page);
# Contracts Finder is read at the same size, which it has always accepted.
OCDS_PAGE_SIZE = 100
# Runaway guard only: a normal week is ~23 Find a Tender pages and one Contracts Finder page.
OCDS_MAX_PAGES = 500


def iter_ocds_releases(
    first_url: str, fetch_json: Callable[[str], Any]
) -> Iterator[dict[str, Any]]:
    """Yield every release of a paged OCDS release-package search, page by page.

    Both services page with an opaque cursor carried in ``links.next`` (OCDS pagination
    extension); the last page has no ``links.next``. Pages are fetched lazily, so a consumer that
    stops early (enough documents kept) makes no further requests. A next link pointing at another
    host, a repeated link or more than ``OCDS_MAX_PAGES`` pages stops the walk with a warning.
    """
    host = urlsplit(first_url).netloc
    seen: set[str] = set()
    url: str | None = first_url
    while url:
        if url in seen or urlsplit(url).netloc != host or len(seen) >= page_limit(OCDS_MAX_PAGES):
            unfinished_page()
            logger.warning(
                "Stopped OCDS paging after %d pages at %s (repeated, foreign or over cap)",
                len(seen),
                url,
            )
            return
        seen.add(url)
        payload = fetch_json(url)
        if not isinstance(payload, dict):
            return
        for release in payload.get("releases") or []:
            if isinstance(release, dict):
                yield release
        links = payload.get("links")
        next_url = links.get("next") if isinstance(links, dict) else None
        url = next_url if isinstance(next_url, str) and next_url.strip() else None


def pick_buyer_name(release: dict) -> str | None:
    buyer = release.get("buyer")
    if isinstance(buyer, dict):
        name = buyer.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()

    for party in release.get("parties", []):
        if not isinstance(party, dict):
            continue
        roles = party.get("roles", [])
        if "buyer" not in roles:
            continue
        name = party.get("name")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def pick_estimated_value(tender: dict) -> tuple[float | None, str | None]:
    """``(euro amount, display text)``; the euro field is filled only for an explicit EUR value.

    Find a Tender sometimes states only ``amountGross`` (VAT included); that figure is kept as
    display text and labelled, never passed off as the net amount.
    """
    for key in ("value", "minValue"):
        candidate = tender.get(key)
        if not isinstance(candidate, dict):
            continue

        currency = str(candidate.get("currency") or "").strip().upper() or None
        amount = candidate.get("amount")
        if amount is None and candidate.get("amountGross") is not None:
            gross_text = format_money_text(amount=candidate.get("amountGross"), currency=currency)
            if gross_text:
                return None, f"{gross_text} (including VAT)"
            continue

        value_text = format_money_text(amount=amount, currency=currency)
        if currency == "EUR" and amount is not None:
            return float(amount), value_text
        if value_text:
            return None, value_text

    return None, None


def pick_delivery_location(tender: dict) -> str | None:
    """First locality or region of the tender's (or its items') delivery addresses."""
    address_lists = [tender.get("deliveryAddresses")]
    items = tender.get("items")
    if isinstance(items, list):
        address_lists += [item.get("deliveryAddresses") for item in items if isinstance(item, dict)]

    for addresses in address_lists:
        if not isinstance(addresses, list):
            continue
        for address in addresses:
            if not isinstance(address, dict):
                continue
            for key in ("locality", "region"):
                value = address.get(key)
                if isinstance(value, str) and value.strip():
                    return value.strip()

    return None
