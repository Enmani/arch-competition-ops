"""BOAMP (French official bulletin of public procurement notices), OpenDataSoft explore API v2.1.

Fields used (checked against the live dataset in 2026-11):

* ``nature``: ``APPEL_OFFRE`` (contract notice), ``RECTIFICATIF`` (correction of a contract
  notice; every one sampled links to an ``APPEL_OFFRE`` in ``annonce_lie``), ``PRE-INFORMATION``
  (with ``sousnature`` ``MISE_EN_CONCURRENCE`` when it is a call for competition), and the closed
  kinds ``ATTRIBUTION``, ``ANNULATION``, ``MODIFICATION`` and ``EX_ANTE_VOLONTAIRE``;
* ``etat``: ``ANNULATION`` also marks a cancelled contract notice;
* ``sousnature`` ``CONCOURS``: a design contest;
* ``donnees``: the notice as a JSON string in one of three schemas. CPV codes sit under
  ``codeCPV``/``CPV`` keys (``FNSimple``, ``MAPA`` corrections) or in eForms
  ``cbc:ItemClassificationCode`` elements with ``@listName`` ``cpv``. Notices of the ``MAPA``
  schema (contracts under 90 k EUR) carry no CPV at all.

``where`` filters the publication window and the open kinds server-side. ``donnees`` is only
full-text indexed (``like "71*"`` also matches 71xxx postcodes and phone numbers) and a notice
without CPV cannot be selected there, so the AI design scope (``collectors.design_scope``) is
applied locally.
"""

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
from arch_competition_ops.collectors.design_scope import has_design_cpv, is_design_and_build
from arch_competition_ops.collectors.relevance import (
    has_built_environment_context,
    is_design_relevant,
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
OPEN_NATURES = ("APPEL_OFFRE", "RECTIFICATIF")
CALL_FOR_COMPETITION = ("PRE-INFORMATION", "MISE_EN_CONCURRENCE")
CANCELLED_ETAT = "ANNULATION"
DESIGN_CONTEST_SOUSNATURE = "CONCOURS"


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


def _open_participation_where(window_start: date) -> str:
    natures = ", ".join(f"'{nature}'" for nature in OPEN_NATURES)
    nature, sousnature = CALL_FOR_COMPETITION
    return (
        f"dateparution >= date'{window_start.isoformat()}'"
        f" and (nature in ({natures})"
        f" or (nature = '{nature}' and sousnature = '{sousnature}'))"
        f" and (etat is null or etat != '{CANCELLED_ETAT}')"
    )


def _search_url(window_start: date, page: int) -> str:
    return build_url(
        BOAMP_SEARCH_URL,
        {
            "where": _open_participation_where(window_start),
            # ``idweb`` breaks ties within a day so offset paging neither repeats nor skips rows.
            "order_by": "dateparution desc, idweb desc",
            "limit": PAGE_SIZE,
            "offset": page * PAGE_SIZE,
        },
    )


def _opens_participation(item: dict[str, Any]) -> bool:
    # The same rule as the server-side ``where``; it guards against a page that ignores it.
    nature = str(item.get("nature") or "")
    if str(item.get("etat") or "") == CANCELLED_ETAT:
        return False
    if not nature:
        # Unknown kind: only the label can still say it is a result.
        label = str(item.get("nature_libelle") or "").lower()
        return "résultat" not in label and "resultat" not in label
    return nature in OPEN_NATURES or (
        (nature, str(item.get("sousnature") or "")) == CALL_FOR_COMPETITION
    )


def _in_ai_scope(item: dict[str, Any], cpv_codes: list[str], title: str, descriptors: str) -> bool:
    """A design contest, a design-scope CPV, no CPV at all (unknown is not out of scope), or a
    design-and-build contract whatever its CPV (``conception-réalisation`` carries ``45*``)."""
    if str(item.get("sousnature") or "").upper() == DESIGN_CONTEST_SOUSNATURE:
        return True
    if not cpv_codes or has_design_cpv(cpv_codes):
        return True
    return is_design_and_build(title, descriptors)


def _passes_keyword_gates(title: str, descriptors: str) -> bool:
    if not title or not is_design_relevant(title, descriptors):
        return False
    normalized_title = title.lower()
    return has_built_environment_context(title, descriptors) or any(
        marker in normalized_title
        for marker in ("architect", "architett", "maitrise d'oeuvre", "maîtrise d'oeuvre")
    )


def _build_document(
    source: SourceDefinition,
    item: dict[str, Any],
    publication_date: str | None,
    *,
    include_unclassified: bool,
) -> CollectedSourceDocument | None:
    if not _opens_participation(item):
        return None
    title = str(item.get("objet") or "").strip()
    descriptors = " ".join(
        str(entry).strip() for entry in item.get("descripteur_libelle") or [] if str(entry).strip()
    )
    nested_payload = _parse_nested_json(item.get("donnees"))
    cpv_codes = _notice_cpv_codes(nested_payload or {})
    if include_unclassified:
        if not _in_ai_scope(item, cpv_codes, title, descriptors):
            return None
    elif not _passes_keyword_gates(title, descriptors):
        return None

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
    include_unclassified: bool = False,
) -> list[CollectedSourceDocument]:
    """Open notices published since ``publication_date_from`` (default: the last 7 days).

    With ``include_unclassified`` (AI screening) a notice is kept when it is in the design scope
    of ``collectors.design_scope``: a design contest, a CPV code under ``71`` or ``7993``, no CPV
    at all, or a design-and-build title. Without it the keyword gates decide.
    """
    get_json = fetch_json or _default_fetch_json
    window_start = _window_start(publication_date_from)
    documents: list[CollectedSourceDocument] = []

    for page in range(MAX_PAGES):
        response = get_json(_search_url(window_start, page))
        results = response.get("results", []) if isinstance(response, dict) else []
        if not isinstance(results, list) or not results:
            return documents

        for item in results:
            if not isinstance(item, dict):
                continue
            publication_date = parse_date_string(str(item.get("dateparution") or ""))
            if publication_date and date.fromisoformat(publication_date) < window_start:
                # Newest first: every later row is older than the window too.
                return documents
            document = _build_document(
                source, item, publication_date, include_unclassified=include_unclassified
            )
            if document is None:
                continue
            documents.append(document)
            if len(documents) >= limit:
                return documents

        if len(results) < PAGE_SIZE:
            return documents

    logger.warning(
        "BOAMP: stopped after %d pages of %d notices before reaching %s; older ones are not read",
        MAX_PAGES,
        PAGE_SIZE,
        window_start.isoformat(),
    )
    return documents
