"""Norway's national notice database, Doffin (doffin.no), via its public search and detail APIs.

Search API behaviour checked against the live service in 2026-11:

* ``numHitsPerPage`` above 1000 answers HTTP 400, and so does any page past ``numHitsAccessible``
  (1,000 hits), even when ``numHitsTotal`` is larger.
* ``sortBy: PUBLICATION_DATE_DESC`` sorts newest first; ``facets.publicationDate.from`` is an
  inclusive ISO day.
* ``facets.cpvCodesId`` matches a code and all its descendants, across main and additional CPV
  codes, and several codes combine with OR (in one week ``71000000`` matched 44 notices and
  ``71200000`` 13).
* Search hits carry ``type``, ``status``, ``publicationDate``, ``heading`` and ``description``
  but no CPV codes; those are only in the notice detail (``allCpvCodes``).

The AI design scope is defined in ``collectors.design_scope``. Design-and-build works contracts
(``totalentreprise``, ``samspillsentreprise``) carry only ``45*`` codes, so AI mode also lists
the open ``45000000`` notices of the window (one page: 71 in a 2026-11 week, 11 of them named a
design-and-build model) and fetches the detail only of those whose heading or description does.
"""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Iterator
from datetime import timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_json_get,
    fetch_json_post,
    merge_newest_first,
)
from arch_competition_ops.collectors.design_scope import (
    SCOPE_CPV_ROOT_CODES,
    WORKS_CPV_ROOT_CODE,
    has_design_cpv,
    is_design_and_build,
)
from arch_competition_ops.collectors.relevance import (
    has_built_environment_context,
    is_design_relevant,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.money import format_money_text
from arch_competition_ops.normalizers.text import normalize_text

logger = logging.getLogger(__name__)

DETAIL_URL = "https://api.doffin.no/webclient/api/v2/notices-api/notices/{notice_id}"
PAGE_SIZE = 100
# Ten pages of 100 reach every hit the API serves for one query (``numHitsAccessible`` = 1,000).
MAX_PAGES = 10
AI_DEFAULT_LOOKBACK_DAYS = 7

# AI scope (``collectors.design_scope``) as a server-side CPV facet. Every Doffin notice carries a
# CPV code (161,416 of 161,416 in 2026-11), so the server-side CPV filter drops no unclassified
# notice. Doffin has no design-contest facet; design contests are found through their CPV codes,
# which in practice are 71*.
AI_SCOPE_CPV_FACET = list(SCOPE_CPV_ROOT_CODES)
# Notice types that still open participation. PRE_ANNOUNCEMENT is a prior-information notice used
# as a call for competition (its form reads "brukes som en oppfordring til konkurranse");
# ADVISORY_NOTICE is information only (none of 492 in three months had a deadline). Result types
# (ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT, ANNOUNCEMENT_OF_INTENT, CANCELLED_...) are left out.
AI_OPEN_NOTICE_TYPES = [
    "ANNOUNCEMENT_OF_COMPETITION",
    "DYNAMIC_PURCHASING_SCHEME",
    "QUALIFICATION_SCHEME",
    "PRE_ANNOUNCEMENT",
]
# A competition in one of these states no longer takes requests to participate.
CLOSED_STATUSES = frozenset({"EXPIRED", "CANCELLED", "AWARDED"})

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

FetchSearch = Callable[[str, dict[str, Any]], dict[str, Any]]


def _default_fetch_search_json(url: str, body: dict) -> dict:
    return fetch_json_post(url, body, headers={"Accept": "application/json"})


def _default_fetch_detail_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _build_search_body(
    page: int,
    *,
    include_unclassified: bool,
    window_from: str | None,
    ai_cpv_facet: list[str] = AI_SCOPE_CPV_FACET,
) -> dict:
    if include_unclassified:
        scope = {
            "cpvCodesId": {"checkedItems": list(ai_cpv_facet)},
            "type": {"checkedItems": AI_OPEN_NOTICE_TYPES},
            # Status is checked per hit: prior-information notices have no status at all.
            "status": {"checkedItems": []},
            "contractNature": {"checkedItems": []},
        }
    else:
        scope = {
            "cpvCodesId": {"checkedItems": DOFFIN_DESIGN_CPV_CODES},
            "type": {"checkedItems": ["ANNOUNCEMENT_OF_COMPETITION"]},
            "status": {"checkedItems": ["ACTIVE"]},
            "contractNature": {"checkedItems": ["SERVICES"]},
        }
    return {
        "numHitsPerPage": PAGE_SIZE,
        "page": page,
        "searchString": "",
        "sortBy": "PUBLICATION_DATE_DESC",
        "facets": {
            "cpvCodesLabel": {"checkedItems": []},
            **scope,
            "procurementStrategicLabels": {"checkedItems": []},
            "publicationDate": {"from": window_from, "to": None},
            "location": {"checkedItems": []},
            "buyer": {"checkedItems": []},
            "winner": {"checkedItems": []},
        },
    }


def _search_hits(
    fetch: FetchSearch,
    url: str,
    *,
    include_unclassified: bool,
    window_from: str | None,
    ai_cpv_facet: list[str] = AI_SCOPE_CPV_FACET,
) -> Iterator[dict[str, Any]]:
    """Hits newest first, page by page, until the window, the results or the page cap end."""
    for page in range(1, MAX_PAGES + 1):
        body = _build_search_body(
            page,
            include_unclassified=include_unclassified,
            window_from=window_from,
            ai_cpv_facet=ai_cpv_facet,
        )
        response = fetch(url, body)
        hits = response.get("hits") if isinstance(response, dict) else None
        if not isinstance(hits, list) or not hits:
            return
        if page == 1:
            total, accessible = response.get("numHitsTotal"), response.get("numHitsAccessible")
            if isinstance(total, int) and isinstance(accessible, int) and total > accessible:
                logger.warning(
                    "Doffin search matched %d notices but serves only %d; later ones are not read",
                    total,
                    accessible,
                )
        for hit in hits:
            if not isinstance(hit, dict):
                continue
            published = parse_date_string(str(hit.get("publicationDate") or ""))
            if window_from and published and published < window_from:
                return
            yield hit
        if len(hits) < PAGE_SIZE:
            return
    logger.warning("Doffin paging stopped after %d pages; later notices were not read", MAX_PAGES)


def _ai_candidate_hits(
    fetch: FetchSearch, url: str, window_from: str | None
) -> Iterator[dict[str, Any]]:
    """Design-scope hits and design-and-build works hits, one per notice, newest first."""
    scoped = _search_hits(fetch, url, include_unclassified=True, window_from=window_from)
    works = (
        hit
        for hit in _search_hits(
            fetch,
            url,
            include_unclassified=True,
            window_from=window_from,
            ai_cpv_facet=[WORKS_CPV_ROOT_CODE],
        )
        if is_design_and_build(str(hit.get("heading") or ""), str(hit.get("description") or ""))
    )
    return merge_newest_first(
        scoped,
        works,
        date_of=lambda hit: parse_date_string(str(hit.get("publicationDate") or "")) or "",
        key_of=lambda hit: str(hit.get("id") or "").strip(),
    )


def _opens_participation(hit: dict[str, Any]) -> bool:
    notice_type = hit.get("type")
    if notice_type and notice_type not in AI_OPEN_NOTICE_TYPES:
        return False
    return hit.get("status") not in CLOSED_STATUSES


def _in_ai_scope(cpv_codes: list[str], title: str, description: str) -> bool:
    """A design-scope CPV or a design-and-build contract; a notice without any CPV code is kept
    for the screening to judge."""
    return not cpv_codes or has_design_cpv(cpv_codes) or is_design_and_build(title, description)


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
    fetch_search_json: FetchSearch | None = None,
    fetch_detail_json: Callable[[str], dict[str, Any]] | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    # AI mode reads a bounded publication window; the keyword path keeps reading every active
    # competition, as before, when no window is given.
    window_from = publication_date_from or (
        (clock.today() - timedelta(days=AI_DEFAULT_LOOKBACK_DAYS)).isoformat()
        if include_unclassified
        else None
    )
    fetch_detail = fetch_detail_json or _default_fetch_detail_json
    documents: list[CollectedSourceDocument] = []

    fetch_search = fetch_search_json or _default_fetch_search_json
    hits = (
        _ai_candidate_hits(fetch_search, source.base_url, window_from)
        if include_unclassified
        else _search_hits(
            fetch_search,
            source.base_url,
            include_unclassified=include_unclassified,
            window_from=window_from,
        )
    )
    for hit in hits:
        notice_id = str(hit.get("id") or "").strip()
        if not notice_id:
            continue
        if include_unclassified and not _opens_participation(hit):
            continue

        detail_url = DETAIL_URL.format(notice_id=notice_id)
        detail_payload = fetch_detail(detail_url)
        title = str(detail_payload.get("heading") or hit.get("heading") or "").strip()
        description = str(detail_payload.get("description") or hit.get("description") or "").strip()
        publication_date = parse_date_string(
            str(detail_payload.get("publicationDate") or hit.get("publicationDate") or "")
        )
        cpv_codes = [
            str(code).strip() for code in detail_payload.get("allCpvCodes", []) if str(code).strip()
        ]

        if include_unclassified and not _in_ai_scope(cpv_codes, title, description):
            continue
        if not include_unclassified and (
            not title or not _is_relevant_doffin_notice(title, description, cpv_codes)
        ):
            continue

        page_url = f"https://www.doffin.no/notices/{notice_id}"
        estimated_value_eur, estimated_value_text = _pick_estimated_value(detail_payload)
        payload = json.dumps(
            {
                "title": title,
                **(
                    {"rawNotice": {"listing": hit, "detail": detail_payload}}
                    if include_unclassified
                    else {}
                ),
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
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official Doffin search and notice-detail API record.",
                "publishedAt": publication_date,
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
        if len(documents) >= limit:
            break

    return documents
