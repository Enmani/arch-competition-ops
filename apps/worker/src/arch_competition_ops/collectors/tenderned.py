from __future__ import annotations

import json

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
    has_built_environment_context,
    is_design_relevant,
    normalize_text,
    parse_date_string,
)
from arch_competition_ops.models import SourceDefinition


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


def _default_fetch_json(url: str) -> dict:
    return fetch_json_get(url, headers={"Accept": "application/json"})


def _build_list_url(base_url: str, page: int, page_size: int) -> str:
    return build_url(
        base_url,
        {
            "page": page,
            "size": page_size,
            "publicatieDatumPreset": "AF30",
        },
    )


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
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    page_size = max(limit * 8, 50)
    documents: list[CollectedSourceDocument] = []
    fetcher = fetch_json or _default_fetch_json

    for page in range(0, 6):
        list_payload = fetcher(_build_list_url(source.base_url, page, page_size))
        rows = list_payload.get("content", [])
        if not isinstance(rows, list) or not rows:
            break

        for row in rows:
            if not isinstance(row, dict):
                continue
            if row.get("typePublicatie", {}).get("code") != "AAO":
                continue
            if row.get("typeOpdracht", {}).get("code") != "D":
                continue
            if row.get("publicatiestatus", {}).get("code") != "PUB":
                continue
            if not row.get("sluitingsDatum"):
                continue

            title = str(row.get("aanbestedingNaam") or "").strip()
            description = str(row.get("opdrachtBeschrijving") or "").strip()
            publication_date = parse_date_string(str(row.get("publicatieDatum") or ""))
            if publication_date_from and publication_date and publication_date < publication_date_from:
                continue
            if not title or not _is_candidate_tenderned_notice(title, description):
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
            if not _is_relevant_tenderned_notice(title, description, cpv_codes):
                continue

            link_payload = row.get("link") if isinstance(row.get("link"), dict) else {}
            official_url = _resolve_site_url(publicatie_id, link_payload.get("href"))
            links_payload = detail_payload.get("links") if isinstance(detail_payload.get("links"), dict) else {}
            pdf_url = None
            if isinstance(links_payload.get("pdf"), dict):
                pdf_url = _resolve_href(links_payload.get("pdf", {}).get("href"))

            payload = json.dumps(
                {
                    "title": title,
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
                    "implementationPath": "service_contract_award_after_competitive_selection",
                    "evidenceLevel": "official_notice",
                    "evidenceNote": "Official TenderNed publication and detail API record.",
                    "publishedAt": publication_date,
                },
                ensure_ascii=False,
            )
            documents.append(CollectedSourceDocument(source_url=detail_url, payload=payload))
            if len(documents) >= limit:
                return documents

        if bool(list_payload.get("last")):
            break

    return documents
