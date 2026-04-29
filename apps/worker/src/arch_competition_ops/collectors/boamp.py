from __future__ import annotations

import json
from datetime import date
from typing import Any

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    build_url,
    extract_cpv_codes,
    fetch_json_get,
    has_built_environment_context,
    is_design_relevant,
    parse_date_string,
)
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.normalizers.money import format_money_text, parse_money_number


BOAMP_SEARCH_URL = "https://boamp-datadila.opendatasoft.com/api/explore/v2.1/catalog/datasets/boamp/records"
VALUE_KEY_MARKERS = ("amount", "montant", "value", "valeur", "prix", "price")


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
            currency = str(value.get("@currencyID") or value.get("currency") or "").strip().upper() or None
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


def collect_boamp_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_json: callable | None = None,
) -> list[CollectedSourceDocument]:
    query_limit = 100
    url = build_url(
        BOAMP_SEARCH_URL,
        {
            "limit": query_limit,
            "order_by": "dateparution desc",
        },
    )
    response = (fetch_json or _default_fetch_json)(url)
    results = response.get("results", []) if isinstance(response, dict) else []
    min_publication_date = date.fromisoformat(publication_date_from) if publication_date_from else None

    documents: list[CollectedSourceDocument] = []
    for item in results:
        if not isinstance(item, dict):
            continue

        publication_date = parse_date_string(str(item.get("dateparution") or ""))
        if min_publication_date and publication_date:
            if date.fromisoformat(publication_date) < min_publication_date:
                continue

        title = str(item.get("objet") or "").strip()
        buyer = str(item.get("nomacheteur") or "").strip() or None
        descriptors = " ".join(
            str(entry).strip() for entry in item.get("descripteur_libelle", []) if str(entry).strip()
        )
        nested_payload = _parse_nested_json(item.get("donnees"))
        cpv_codes = extract_cpv_codes(nested_payload or {})
        estimated_value_eur, estimated_value_text = _pick_estimated_value(nested_payload or {})
        nature_label = str(item.get("nature_libelle") or "").lower()

        normalized_title = title.lower()
        if "résultat" in nature_label or "resultat" in nature_label:
            continue
        if not title or not is_design_relevant(title, descriptors):
            continue
        if not has_built_environment_context(title, descriptors) and not any(
            marker in normalized_title
            for marker in ("architect", "architett", "maitrise d'oeuvre", "maîtrise d'oeuvre")
        ):
            continue

        payload = json.dumps(
            {
                "officialNoticeId": item.get("id") or item.get("idweb"),
                "title": title,
                "buyer": buyer,
                "procedureType": item.get("procedure_libelle"),
                "deadline": parse_date_string(str(item.get("datelimitereponse") or "")),
                "publicationDate": publication_date,
                "estimatedValueEur": estimated_value_eur,
                "estimatedValueText": estimated_value_text,
                "cpv": cpv_codes,
                "summary": descriptors or None,
                "url": item.get("url") or source.base_url,
            },
            ensure_ascii=False,
        )
        documents.append(
            CollectedSourceDocument(
                source_url=str(item.get("url") or source.base_url),
                payload=payload,
            )
        )
        if len(documents) >= limit:
            break

    return documents
