"""The Dutch national procurement platform TenderNed, via its public publications API (papi).

List API behaviour checked against the live service in 2026-11:

* ``size`` above 100 answers HTTP 400, and so does any page past the first 10,000 rows.
* Rows come newest first by ``publicatieDatum``; ``publicatieDatumVanaf`` is an inclusive ISO day.
* ``cpvCodes`` takes codes with their check digit (``71000000-8``), matches a code and all its
  descendants across main and additional CPV codes, and repeats combine with OR.
* ``publicatieType`` (``AAO``, ``REC``, ...) and ``typeOpdracht`` (``D`` services, ``W`` works)
  filter too, repeats combine with OR; there is no filter on the eForms form (``publicatiecode``).
* List rows carry ``typePublicatie``, ``publicatiecode`` (the eForms notice subtype, ``EF16``),
  ``publicatieDatum``, ``aanbestedingNaam`` and ``opdrachtBeschrijving`` but no CPV codes; those
  are only in the detail document (``cpvCodes``).

The AI design scope is defined in ``collectors.design_scope``. Design-and-build works contracts
(``bouwteam``, ``UAV-GC``, ``Design & Build``) carry only ``45*`` codes, so AI mode also lists the
open ``45000000-7`` publications of the window (108 rows, two requests, in a 2026-11 week) and
fetches the detail only of those whose title or description names a design-and-build model.
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
    build_url,
    fetch_json_get,
    merge_newest_first,
)
from arch_competition_ops.collectors.design_scope import (
    SCOPE_CPV_ROOT_CODES_WITH_CHECK_DIGIT,
    WORKS_CPV_ROOT_CODE_WITH_CHECK_DIGIT,
    has_design_cpv,
    is_design_and_build,
)
from arch_competition_ops.collectors.relevance import (
    has_built_environment_context,
    is_design_relevant,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.text import normalize_text

logger = logging.getLogger(__name__)

PAGE_SIZE = 100
# 5,000 rows per query: far above any window read here (a week has about 575 publications in all)
# and inside the API's 10,000-row reach.
MAX_PAGES = 50
AI_DEFAULT_LOOKBACK_DAYS = 7
# The keyword path used the API's "last 30 days" preset (AF30) before it read dated windows.
KEYWORD_DEFAULT_LOOKBACK_DAYS = 30

# AI scope (``collectors.design_scope``) as a server-side CPV filter. Only 4 of 146,918 TenderNed
# publications have no CPV code at all (none since 2025), so the server-side CPV filter drops
# practically no unclassified notice.
AI_SCOPE_CPV_FILTER = list(SCOPE_CPV_ROOT_CODES_WITH_CHECK_DIGIT)
# eForms notice subtypes that still open participation: prior-information notices used as a call
# for competition (10-14), qualification systems (15), contract and concession notices (16-22) and
# design contests (23-24), plus the Dutch voluntary contract notice (E3). Award, VEAT,
# modification, information-only and market-consultation forms are left out.
OPEN_FORMS = frozenset({f"EF{subtype}" for subtype in range(10, 25)} | {"EFE3"})
# Design contests are kept whatever their CPV codes (some carry 9*, 73* or 90*).
DESIGN_CONTEST_FORMS = frozenset({"EF23", "EF24"})
# Award notices, contract modifications and early terminations close participation even when
# their form is a contract-notice form (an early termination repeats EF16).
CLOSED_PUBLICATION_TYPES = frozenset({"AGO", "AAW", "VBE"})

TENDERNED_DESIGN_MARKERS = (
    "architect",
    "architectenselectie",
    "architecton",
    "ontwerp",
    "landschap",
    "stedenbouw",
    "masterplan",
    "planstudie",
    "ruimtelijke",
)
TENDERNED_BUILT_MARKERS = (
    "school",
    "campus",
    "sporthal",
    "bibliotheek",
    "museum",
    "wijk",
    "park",
    "plein",
    "openbare ruimte",
    "gebouw",
    "brug",
    "station",
)
TENDERNED_NEGATIVE_MARKERS = (
    "brokerdienstverlening",
    "uitzendkrachten",
    "accountantsdiensten",
    "ict",
    "loopbaan",
    "outplacement",
)

FetchJson = Callable[[str], dict[str, Any]]


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _code(row: dict[str, Any], field: str) -> str | None:
    value = row.get(field)
    return value.get("code") if isinstance(value, dict) else None


def _list_rows(
    fetch: FetchJson, base_url: str, filters: dict[str, Any], window_from: str
) -> Iterator[dict[str, Any]]:
    """Rows newest first, page by page, until the window, the results or the page cap end."""
    for page in range(MAX_PAGES):
        list_payload = fetch(
            build_url(
                base_url,
                {"page": page, "size": PAGE_SIZE, "publicatieDatumVanaf": window_from, **filters},
            )
        )
        rows = list_payload.get("content") if isinstance(list_payload, dict) else None
        if not isinstance(rows, list) or not rows:
            return
        for row in rows:
            if not isinstance(row, dict):
                continue
            published = parse_date_string(str(row.get("publicatieDatum") or ""))
            if published and published < window_from:
                return
            yield row
        if bool(list_payload.get("last")) or len(rows) < PAGE_SIZE:
            return
    logger.warning(
        "TenderNed paging stopped after %d pages; later publications were not read", MAX_PAGES
    )


def _ai_candidate_rows(fetch: FetchJson, base_url: str, window_from: str) -> Iterator[dict]:
    """Publications with a CPV code in scope, design contests outside that scope and
    design-and-build works publications, one per publication, newest first."""
    scoped = _list_rows(fetch, base_url, {"cpvCodes": AI_SCOPE_CPV_FILTER}, window_from)
    # The API cannot filter on the form, so the design contests come from the contract-notice
    # listing (about 200 rows a week); only the matching rows fetch a detail document.
    contests = (
        row
        for row in _list_rows(fetch, base_url, {"publicatieType": "AAO"}, window_from)
        if _code(row, "publicatiecode") in DESIGN_CONTEST_FORMS
    )
    works = (
        row
        for row in _list_rows(
            fetch, base_url, {"cpvCodes": [WORKS_CPV_ROOT_CODE_WITH_CHECK_DIGIT]}, window_from
        )
        if is_design_and_build(
            str(row.get("aanbestedingNaam") or ""), str(row.get("opdrachtBeschrijving") or "")
        )
    )
    return merge_newest_first(
        scoped,
        contests,
        works,
        date_of=lambda row: parse_date_string(str(row.get("publicatieDatum") or "")) or "",
        key_of=lambda row: str(row.get("publicatieId") or ""),
    )


def _opens_participation(row: dict[str, Any]) -> bool:
    if row.get("isVroegtijdigeBeeindiging"):
        return False
    if _code(row, "typePublicatie") in CLOSED_PUBLICATION_TYPES:
        return False
    form = _code(row, "publicatiecode")
    return not form or form in OPEN_FORMS


def _in_ai_scope(row: dict[str, Any], cpv_codes: list[str], title: str, description: str) -> bool:
    """A design-scope CPV, a design contest or a design-and-build contract; a notice without CPV
    codes is kept."""
    if not cpv_codes or _code(row, "publicatiecode") in DESIGN_CONTEST_FORMS:
        return True
    return has_design_cpv(cpv_codes) or is_design_and_build(title, description)


def _is_candidate_tenderned_notice(title: str, description: str) -> bool:
    normalized = normalize_text(f"{title} {description}")
    if any(marker in normalized for marker in TENDERNED_NEGATIVE_MARKERS):
        return False
    return any(marker in normalized for marker in TENDERNED_DESIGN_MARKERS)


def _is_relevant_tenderned_notice(title: str, description: str, cpv_codes: list[str]) -> bool:
    if not is_design_relevant(title, description, cpv_codes=cpv_codes):
        return False
    if has_built_environment_context(title, description):
        return True

    normalized = normalize_text(f"{title} {description}")
    return any(marker in normalized for marker in TENDERNED_BUILT_MARKERS)


def _resolve_site_url(publicatie_id: str, raw_url: str | None) -> str:
    if raw_url and raw_url.strip():
        return raw_url.strip()
    return f"https://www.tenderned.nl/aankondigingen/overzicht/{publicatie_id}"


def _resolve_href(href: str | None) -> str | None:
    if not href:
        return None
    if href.startswith("http://") or href.startswith("https://"):
        return href
    return f"https://www.tenderned.nl{href}"


def collect_tenderned_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: FetchJson | None = None,
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    lookback_days = (
        AI_DEFAULT_LOOKBACK_DAYS if include_unclassified else KEYWORD_DEFAULT_LOOKBACK_DAYS
    )
    window_from = (
        publication_date_from or (clock.today() - timedelta(days=lookback_days)).isoformat()
    )
    documents: list[CollectedSourceDocument] = []
    fetcher = fetch_json or _default_fetch_json
    rows = (
        _ai_candidate_rows(fetcher, source.base_url, window_from)
        if include_unclassified
        else _list_rows(
            fetcher, source.base_url, {"publicatieType": "AAO", "typeOpdracht": "D"}, window_from
        )
    )

    for row in rows:
        if row.get("publicatiestatus", {}).get("code") != "PUB":
            continue
        if include_unclassified and not _opens_participation(row):
            continue
        if not include_unclassified and (
            _code(row, "typePublicatie") != "AAO"
            or _code(row, "typeOpdracht") != "D"
            or not row.get("sluitingsDatum")
        ):
            continue

        title = str(row.get("aanbestedingNaam") or "").strip()
        description = str(row.get("opdrachtBeschrijving") or "").strip()
        publication_date = parse_date_string(str(row.get("publicatieDatum") or ""))
        if not title or (
            not include_unclassified and not _is_candidate_tenderned_notice(title, description)
        ):
            continue

        publicatie_id = str(row.get("publicatieId") or "").strip()
        if not publicatie_id:
            continue

        detail_url = f"{source.base_url}/{publicatie_id}"
        detail_payload = fetcher(detail_url)
        cpv_codes = [
            str(code.get("code") or "").split("-")[0].strip()
            for code in detail_payload.get("cpvCodes", [])
            if isinstance(code, dict) and str(code.get("code") or "").strip()
        ]
        title = str(detail_payload.get("aanbestedingNaam") or title).strip()
        description = str(detail_payload.get("opdrachtBeschrijving") or description).strip()
        if include_unclassified and not _in_ai_scope(row, cpv_codes, title, description):
            continue
        if not include_unclassified and (
            not _is_relevant_tenderned_notice(title, description, cpv_codes)
        ):
            continue

        link_payload = row.get("link") if isinstance(row.get("link"), dict) else {}
        official_url = _resolve_site_url(publicatie_id, link_payload.get("href"))
        links_payload = (
            detail_payload.get("links") if isinstance(detail_payload.get("links"), dict) else {}
        )
        pdf_url = None
        if isinstance(links_payload.get("pdf"), dict):
            pdf_url = _resolve_href(links_payload.get("pdf", {}).get("href"))

        payload = json.dumps(
            {
                "title": title,
                **(
                    {"rawNotice": {"listing": row, "detail": detail_payload}}
                    if include_unclassified
                    else {}
                ),
                "buyer": str(
                    detail_payload.get("opdrachtgeverNaam") or row.get("opdrachtgeverNaam") or ""
                ).strip()
                or None,
                "noticeId": publicatie_id,
                "deadline": parse_date_string(
                    str(detail_payload.get("sluitingsDatum") or row.get("sluitingsDatum") or "")
                ),
                "summary": description,
                "officialUrl": official_url,
                "briefPdfUrl": pdf_url,
                "cpv": cpv_codes,
                "opportunityType": "public_design_services_procurement",
                "procedureType": (
                    detail_payload.get("procedureCode", {}).get("omschrijving")
                    if isinstance(detail_payload.get("procedureCode"), dict)
                    else None
                )
                or (
                    row.get("procedure", {}).get("omschrijving")
                    if isinstance(row.get("procedure"), dict)
                    else None
                ),
                "evidenceLevel": "official_notice",
                "evidenceNote": "Official TenderNed publication and detail API record.",
                "publishedAt": publication_date,
            },
            ensure_ascii=False,
        )
        documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
        if len(documents) >= limit:
            break

    return documents
