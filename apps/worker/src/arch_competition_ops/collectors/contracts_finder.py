from __future__ import annotations

import json
from datetime import date

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import build_url, fetch_json_get, normalize_text
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.money import format_money_text


UK_RELEVANT_CPV_PREFIXES = (
    "712",
    "7142",
)
UK_DESIGN_MARKERS = (
    "architect",
    "architecture",
    "architectural",
    "landscape architecture",
    "planning",
    "urban design",
    "masterplan",
    "concept design",
    "detailed design",
    "design build",
    "design and build",
)
UK_BUILT_MARKERS = (
    "public realm",
    "campus",
    "school",
    "heritage",
    "library",
    "hospital",
    "housing",
    "civic",
    "pavilion",
    "refurbishment",
    "extension",
    "alterations",
    "car park",
    "kitchen",
    "site",
)
UK_NEGATIVE_MARKERS = (
    "digital ai",
    "skills building",
    "school uniform",
    "events management",
    "training programme",
)


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _resolve_search_window(publication_date_from: str | None) -> tuple[str, str]:
    published_from = publication_date_from or date.today().replace(day=1).isoformat()
    published_to = date.today().isoformat()
    return f"{published_from}T00:00:00", f"{published_to}T23:59:59"


def _is_relevant_contracts_finder_notice(title: str, description: str, cpv_code: str) -> bool:
    if cpv_code.startswith(UK_RELEVANT_CPV_PREFIXES):
        return True

    normalized = normalize_text(f"{title} {description}")
    if any(marker in normalized for marker in UK_NEGATIVE_MARKERS):
        return False
    if not any(marker in normalized for marker in UK_DESIGN_MARKERS):
        return False
    return any(marker in normalized for marker in UK_BUILT_MARKERS)


def _pick_buyer_name(release: dict) -> str | None:
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


def _pick_notice_url(tender: dict, fallback: str) -> str:
    for document in tender.get("documents", []):
        if not isinstance(document, dict):
            continue
        url = document.get("url")
        if isinstance(url, str) and url.strip():
            return url.strip()
    return fallback


def _pick_estimated_value(tender: dict) -> tuple[float | None, str | None]:
    for key in ("value", "minValue"):
        candidate = tender.get(key)
        if not isinstance(candidate, dict):
            continue

        amount = candidate.get("amount")
        currency = str(candidate.get("currency") or "").strip().upper() or None
        value_text = format_money_text(amount=amount, currency=currency)
        if currency == "EUR" and amount is not None:
            return float(amount), value_text
        if value_text:
            return None, value_text

    return None, None


def _pick_delivery_location(tender: dict) -> str | None:
    addresses = tender.get("deliveryAddresses")
    if not isinstance(addresses, list):
        return None

    for address in addresses:
        if not isinstance(address, dict):
            continue
        for key in ("locality", "region"):
            value = address.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()

    return None


def collect_contracts_finder_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    published_from, published_to = _resolve_search_window(publication_date_from)
    search_url = build_url(
        source.base_url,
        {
            "publishedFrom": published_from,
            "publishedTo": published_to,
            "stages": "tender",
            "limit": min(max(limit * 8, 50), 100),
        },
    )
    payload = (fetch_json or _default_fetch_json)(search_url)

    documents: list[CollectedSourceDocument] = []
    for release in payload.get("releases", []):
        if not isinstance(release, dict):
            continue

        tender = release.get("tender", {})
        if not isinstance(tender, dict):
            continue

        title = (tender.get("title") or "").strip()
        description = (tender.get("description") or "").strip()
        classification = tender.get("classification", {})
        cpv_code = classification.get("id", "").strip() if isinstance(classification, dict) else ""

        if not title or not _is_relevant_contracts_finder_notice(title, description, cpv_code):
            continue

        official_url = _pick_notice_url(tender, source.base_url)
        estimated_value_eur, estimated_value_text = _pick_estimated_value(tender)
        payload_row = json.dumps(
            {
                "title": title,
                "buyer": _pick_buyer_name(release),
                "noticeId": release.get("ocid"),
                "deadline": tender.get("tenderPeriod", {}).get("endDate"),
                "estimatedValueEur": estimated_value_eur,
                "estimatedValueText": estimated_value_text,
                "location": _pick_delivery_location(tender),
                "summary": description,
                "officialUrl": official_url,
                "cpv": [cpv_code] if cpv_code else [],
                "opportunityType": "public_design_services_procurement",
                "procedureType": tender.get("procurementMethodDetails") or tender.get("procurementMethod"),
                "implementationPath": "service_contract_award_after_competitive_selection",
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official UK Contracts Finder OCDS tender release.",
                "publishedAt": tender.get("datePublished") or release.get("date"),
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=official_url, payload=payload_row))
        if len(documents) >= limit:
            break

    return documents
