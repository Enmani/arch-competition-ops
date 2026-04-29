from __future__ import annotations

import json

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_json_get,
    fetch_json_post,
    has_built_environment_context,
    is_design_relevant,
    normalize_text,
    parse_date_string,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.money import format_money_text


DOFFIN_DESIGN_CPV_CODES = [
    "71200000",
    "71210000",
    "71220000",
    "71221000",
    "71222000",
    "71240000",
    "71241000",
    "71242000",
    "71243000",
    "71244000",
    "71245000",
    "71246000",
    "71247000",
    "71248000",
    "71250000",
    "71251000",
    "71410000",
    "71420000",
]
DOFFIN_EXTRA_MARKERS = (
    "plan",
    "planfagleg",
    "planlegging",
    "reguleringsplan",
    "byggesak",
    "byggesaker",
    "landskap",
    "arkitekt",
)


def _default_fetch_search_json(url: str, body: dict) -> dict:
    return fetch_json_post(url, body, headers={"Accept": "application/json"})


def _default_fetch_detail_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _build_search_body(page: int, page_size: int) -> dict:
    return {
        "numHitsPerPage": page_size,
        "page": page,
        "searchString": "",
        "sortBy": "RELEVANCE",
        "facets": {
            "cpvCodesLabel": {"checkedItems": []},
            "cpvCodesId": {"checkedItems": DOFFIN_DESIGN_CPV_CODES},
            "type": {"checkedItems": ["ANNOUNCEMENT_OF_COMPETITION"]},
            "status": {"checkedItems": ["ACTIVE"]},
            "contractNature": {"checkedItems": ["SERVICES"]},
            "procurementStrategicLabels": {"checkedItems": []},
            "publicationDate": {"from": None, "to": None},
            "location": {"checkedItems": []},
            "buyer": {"checkedItems": []},
            "winner": {"checkedItems": []},
        },
    }


def _pick_buyer_name(payload: dict, fallback: dict) -> str | None:
    for candidate in (payload.get("buyer"), fallback.get("buyer")):
        if not isinstance(candidate, list) or not candidate:
            continue
        first = candidate[0]
        if isinstance(first, dict):
            name = str(first.get("name") or "").strip()
            if name:
                return name
    return None


def _is_relevant_doffin_notice(title: str, description: str, cpv_codes: list[str]) -> bool:
    if not is_design_relevant(title, description, cpv_codes=cpv_codes):
        return False
    if has_built_environment_context(title, description):
        return True

    normalized = normalize_text(f"{title} {description}")
    return any(marker in normalized for marker in DOFFIN_EXTRA_MARKERS)


def _pick_estimated_value(detail_payload: dict) -> tuple[float | None, str | None]:
    core = detail_payload.get("core")
    if not isinstance(core, dict):
        return None, None

    estimated_value = core.get("estimatedValue")
    if not isinstance(estimated_value, dict):
        return None, None

    amount = estimated_value.get("amount")
    currency = str(estimated_value.get("code") or "").strip().upper() or None
    value_text = format_money_text(
        amount=amount,
        currency=currency,
        raw_text=estimated_value.get("fullLocalizedText"),
    )
    if currency == "EUR" and amount is not None:
        return float(amount), value_text
    return None, value_text


def collect_doffin_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_search_json: callable | None = None,
    fetch_detail_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    page_size = max(limit * 3, 20)
    documents: list[CollectedSourceDocument] = []

    for page in range(1, 6):
        search_payload = (fetch_search_json or _default_fetch_search_json)(
            source.base_url,
            _build_search_body(page, page_size),
        )
        hits = search_payload.get("hits", [])
        if not isinstance(hits, list) or not hits:
            break

        for hit in hits:
            if not isinstance(hit, dict):
                continue

            notice_id = str(hit.get("id") or "").strip()
            if not notice_id:
                continue

            detail_url = f"https://api.doffin.no/webclient/api/v2/notices-api/notices/{notice_id}"
            detail_payload = (fetch_detail_json or _default_fetch_detail_json)(detail_url)
            title = str(detail_payload.get("heading") or hit.get("heading") or "").strip()
            description = str(
                detail_payload.get("description") or hit.get("description") or ""
            ).strip()
            publication_date = parse_date_string(
                str(detail_payload.get("publicationDate") or hit.get("publicationDate") or "")
            )
            cpv_codes = [
                str(code).strip()
                for code in detail_payload.get("allCpvCodes", [])
                if str(code).strip()
            ]

            if publication_date_from and publication_date and publication_date < publication_date_from:
                continue
            if not title or not _is_relevant_doffin_notice(title, description, cpv_codes):
                continue

            page_url = f"https://www.doffin.no/notices/{notice_id}"
            estimated_value_eur, estimated_value_text = _pick_estimated_value(detail_payload)
            payload = json.dumps(
                {
                    "title": title,
                    "buyer": _pick_buyer_name(detail_payload, hit),
                    "noticeId": notice_id,
                    "deadline": parse_date_string(
                        str(detail_payload.get("deadline") or hit.get("deadline") or "")
                    ),
                    "estimatedValueEur": estimated_value_eur,
                    "estimatedValueText": estimated_value_text,
                    "summary": description,
                    "officialUrl": page_url,
                    "cpv": cpv_codes,
                    "opportunityType": "public_design_services_procurement",
                    "procedureType": detail_payload.get("noticeType") or hit.get("type"),
                    "implementationPath": "service_contract_award_after_competitive_selection",
                    "evidenceLevel": "official_notice",
                    "evidenceNote": "Official Doffin search and notice-detail API record.",
                    "publishedAt": publication_date,
                },
                ensure_ascii=False,
            )
            documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
            if len(documents) >= limit:
                return documents

        if len(hits) < page_size:
            break

    return documents
