from __future__ import annotations

import csv
import io
import json
from datetime import date

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import (
    fetch_text_get,
    has_built_environment_context,
    is_design_relevant,
    normalize_text,
    parse_date_string,
)
from arch_competition_ops.models import SourceDefinition


SCP_AVVISI_CSV_URL = "https://dati.mit.gov.it/scp/v_od_avvisi.csv"

# AI maintenance note:
# - Extend Italy city targeting through config/source_lists/italy_city_authorities.txt.
# - Keep this collector generic; do not fork it per city unless the upstream feed shape truly changes.
# - If a future country needs a similar buyer-name filter, prefer reusing this pattern over adding ad hoc code paths.


def _default_fetch_text(url: str) -> str:
    return fetch_text_get(url, headers={"Accept": "text/csv, text/plain;q=0.9, */*;q=0.8"})


def _matches_buyer_allowlist(buyer: str | None, buyer_allowlist: list[str]) -> bool:
    if not buyer_allowlist:
        return True

    normalized_buyer = normalize_text(buyer)
    return any(normalized_pattern in normalized_buyer for normalized_pattern in buyer_allowlist)


def collect_scp_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_text: callable | None = None,
) -> list[CollectedSourceDocument]:
    csv_text = (fetch_text or _default_fetch_text)(SCP_AVVISI_CSV_URL)
    reader = csv.DictReader(io.StringIO(csv_text))
    min_publication_date = date.fromisoformat(publication_date_from) if publication_date_from else None
    buyer_allowlist = [normalize_text(pattern) for pattern in source.buyer_allowlist if pattern.strip()]

    rows: list[tuple[str | None, CollectedSourceDocument]] = []
    for row in reader:
        title = (row.get("descrizione_avviso") or "").strip()
        buyer = (row.get("denominazione_stazione_appaltante") or "").strip()
        if not title or not is_design_relevant(
            title,
            row.get("tipo_avviso"),
            buyer,
        ):
            continue
        if not _matches_buyer_allowlist(buyer, buyer_allowlist):
            continue
        normalized_title = normalize_text(title)
        if not has_built_environment_context(title) and not any(
            marker in normalized_title for marker in ("architett", "progettazione", "maitrise d oeuvre")
        ):
            continue

        publication_date = parse_date_string(row.get("data_pubblicazione_scp"))
        if min_publication_date and publication_date:
            if date.fromisoformat(publication_date) < min_publication_date:
                continue

        payload = json.dumps(
            {
                "officialNoticeId": row.get("id_avviso"),
                "title": title,
                "buyer": buyer,
                "procedureType": row.get("tipo_avviso"),
                "deadline": parse_date_string(row.get("scadenza_avviso")),
                "publicationDate": publication_date,
                "summary": row.get("tipo_avviso"),
                "url": row.get("url_avviso") or source.base_url,
                "sourceDataset": "scp_avvisi_csv",
            },
            ensure_ascii=False,
        )
        rows.append(
            (
                publication_date,
                CollectedSourceDocument(
                    source_url=row.get("url_avviso") or source.base_url,
                    payload=payload,
                ),
            )
        )

    rows.sort(key=lambda item: item[0] or "0000-00-00", reverse=True)
    return [document for _publication_date, document in rows[:limit]]
