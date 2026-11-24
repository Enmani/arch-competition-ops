"""BOAMP (French official bulletin of public procurement notices), OpenDataSoft explore API v2.1."""

from __future__ import annotations

import json
import logging
from datetime import date, timedelta
from typing import Any

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    fetch_json_get,
)
from arch_competition_ops.collectors.pagination import (
    bounded_pages,
    current_pages,
    observe_page,
    page_limit,
    unfinished_page,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.dates import parse_date_string
from arch_competition_ops.normalizers.money import format_money_text, parse_money_number
from arch_competition_ops.normalizers.text import CPV_PATTERN

logger = logging.getLogger(__name__)

BOAMP_SEARCH_URL = (
    "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records"
)
VALUE_KEY_MARKERS = ("amount", "montant", "value", "valeur", "prix", "price")
DEFAULT_LOOKBACK_DAYS = 7
# The records endpoint returns at most 100 rows per request (about 1.5 MB, at most ~4 MB).
PAGE_SIZE = 100
# The records endpoint refuses ``offset + limit`` above 10,000. A week of open notices is about
# 15 pages, so the cap only stops a window far longer than the daily run reads.
MAX_PAGES = 90


def _default_fetch_json(url: str) -> Any:
    return fetch_json_get(url)


def _parse_nested_json(raw_value: Any) -> Any:
    if not isinstance(raw_value, str) or not raw_value.strip():
        return None
    try:
        return json.loads(raw_value)
    except json.JSONDecodeError:
        return None


def _pick_estimated_value(payload: Any) -> tuple[float | None, str | None]:
    def visit(value: Any, path: str = "root") -> tuple[float | None, str | None]:
        if isinstance(value, dict):
            currency = (
                str(value.get("@currencyID") or value.get("currency") or "").strip().upper() or None
            )
            amount_candidate = value.get("#text")
            if amount_candidate is None and "amount" in value:
                amount_candidate = value.get("amount")
            if amount_candidate is not None and (
                currency or any(marker in path.lower() for marker in VALUE_KEY_MARKERS)
            ):
                value_text = format_money_text(amount=amount_candidate, currency=currency)
                if currency == "EUR":
                    return parse_money_number(amount_candidate), value_text
                return None, value_text

            for key, nested_value in value.items():
                picked = visit(nested_value, f"{path}.{key}")
                if picked != (None, None):
                    return picked
            return None, None

        if isinstance(value, list):
            for index, item in enumerate(value):
                picked = visit(item, f"{path}[{index}]")
                if picked != (None, None):
                    return picked
            return None, None

        if any(marker in path.lower() for marker in VALUE_KEY_MARKERS):
            parsed_amount = parse_money_number(value)
            if parsed_amount is not None:
                return parsed_amount, format_money_text(amount=parsed_amount, currency="EUR")

        return None, None

    return visit(payload)


def _notice_cpv_codes(payload: Any) -> list[str]:
    """CPV codes (main and additional, every lot) from the structured CPV fields only.

    Scanning every string would also take 8-digit amounts and identifiers for CPV codes.
    """
    codes: list[str] = []

    def visit(value: Any, in_cpv_field: bool) -> None:
        if isinstance(value, dict):
            is_cpv_code = str(value.get("@listName") or "").lower() == "cpv"
            for key, nested in value.items():
                visit(
                    nested, in_cpv_field or "cpv" in key.lower() or (is_cpv_code and key == "#text")
                )
        elif isinstance(value, list):
            for nested in value:
                visit(nested, in_cpv_field)
        elif in_cpv_field and isinstance(value, str):
            for code in CPV_PATTERN.findall(value):
                if code not in codes:
                    codes.append(code)

    visit(payload, False)
    return codes


def _window_start(publication_date_from: str | None) -> date:
    if publication_date_from:
        return date.fromisoformat(publication_date_from)
    return clock.today() - timedelta(days=DEFAULT_LOOKBACK_DAYS)


def _search_url(window_start: date, page: int) -> str:
    window = current_pages()
    where = f"dateparution >= date'{window_start.isoformat()}'"
    if window and window.end:
        where += f" AND dateparution <= date'{window.end}'"
        if window.cursor:
            published, notice_id = json.loads(window.cursor)
            literal = json.dumps(notice_id)
            where += (
                f" AND (dateparution < date'{published}' OR "
                f"(dateparution = date'{published}' AND idweb < {literal}))"
            )
    return build_url(
        BOAMP_SEARCH_URL,
        {
            "where": where,
            # ``idweb`` breaks ties within a day so offset paging neither repeats nor skips rows.
            "order_by": "dateparution desc, idweb desc",
            "limit": PAGE_SIZE,
            "offset": 0 if window and window.end else page * PAGE_SIZE,
        },
    )


def _build_document(
    source: SourceDefinition,
    item: dict[str, Any],
    publication_date: str | None,
) -> CollectedSourceDocument | None:
    title = str(item.get("objet") or "").strip()
    descriptors = " ".join(
        str(entry).strip() for entry in item.get("descripteur_libelle") or [] if str(entry).strip()
    )
    nested_payload = _parse_nested_json(item.get("donnees"))
    cpv_codes = _notice_cpv_codes(nested_payload or {})

    estimated_value_eur, estimated_value_text = _pick_estimated_value(nested_payload or {})
    # The search API names the public notice page ``url_avis``; never fall back to the
    # site root, which is not a notice and collides across every BOAMP record.
    notice_url = item.get("url_avis") or item.get("url")
    payload = json.dumps(
        {
            "officialNoticeId": item.get("id") or item.get("idweb"),
            "title": title,
            "buyer": str(item.get("nomacheteur") or "").strip() or None,
            "procedureType": item.get("procedure_libelle"),
            "deadline": parse_date_string(str(item.get("datelimitereponse") or "")),
            "publicationDate": publication_date,
            "estimatedValueEur": estimated_value_eur,
            "estimatedValueText": estimated_value_text,
            "cpv": cpv_codes,
            "summary": descriptors or None,
            "officialUrl": notice_url,
            "rawNotice": item,
        },
        ensure_ascii=False,
    )
    return CollectedSourceDocument(source_url=str(notice_url or source.base_url), payload=payload)


def collect_boamp_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    """Collect public notices in the requested publication window."""
    get_json = fetch_json or _default_fetch_json
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []

    for page in bounded_pages(range(page_limit(MAX_PAGES))):
        response = get_json(_search_url(window_start, page))
        results = response.get("results", []) if isinstance(response, dict) else []
        if not isinstance(results, list) or not results:
            return documents

        if not observe_page(
            item.get("idweb") or item for item in results if isinstance(item, dict)
        ):
            break
        for item in results:
            if not isinstance(item, dict):
                continue
            publication_date = parse_date_string(str(item.get("dateparution") or ""))
            if publication_date and date.fromisoformat(publication_date) < window_start:
                # Newest first: every later row is older than the window too.
                return documents
            window = current_pages()
            if window and publication_date and item.get("idweb"):
                window.cursor = json.dumps([publication_date, item["idweb"]])
            document = _build_document(source, item, publication_date)
            if document is None:
                continue
            documents.append(document)
            if window:
                window.rows = len(documents)
            if len(documents) >= limit:
                unfinished_page()
                return documents

        if len(results) < PAGE_SIZE:
            return documents

    unfinished_page()
    logger.warning(
        "BOAMP: stopped after %d pages of %d notices before reaching %s; older ones are not read",
        MAX_PAGES,
        PAGE_SIZE,
        window_start.isoformat(),
    )
    return documents
