from __future__ import annotations

import json

from support import build_source as _build_source

from arch_competition_ops.collectors.ted import collect_ted_documents


def test_ted_ai_query_asks_only_for_notices_that_open_participation() -> None:
    source = _build_source(
        "ted_design_notices",
        collector="ted_search_api",
        name="TED Design and Procurement Notices",
        jurisdiction="eu",
        base_url="https://ted.europa.eu/",
        scan_method="api",
        extractor="ted_notice_parser",
    )
    queries = []
    collect_ted_documents(
        source,
        publication_date_from="2026-01-01",
        fetch_json=lambda _url, body: queries.append(body["query"]) or {"notices": []},
    )
    # The listing fixture includes award results as well as open notices.
    assert queries == ["publication-date >= 20260101"]


def test_ted_ai_mode_merges_confirmed_design_and_build_works_notices_newest_first() -> None:
    source = _build_source(
        "ted_design_notices",
        collector="ted_search_api",
        name="TED Design and Procurement Notices",
        jurisdiction="eu",
        base_url="https://ted.europa.eu/",
        scan_method="api",
        extractor="ted_notice_parser",
    )

    def notice(number: str, published: str, title: str, cpv: str, description: str = "") -> dict:
        return {
            "publication-number": number,
            "publication-date": f"{published}+01:00",
            "classification-cpv": [cpv],
            "notice-title": {"eng": title},
            "description-proc": {"fra": description} if description else {},
            "links": {"htmlDirect": {"ENG": f"https://ted.europa.eu/en/notice/{number}/html"}},
        }

    scoped = [
        notice(
            "3-2026",
            "2026-11-13",
            "France – Architectural services – Maîtrise d'oeuvre",
            "71200000",
        ),
        notice(
            "1-2026", "2026-11-10", "Spain – Engineering services – Asistencia técnica", "71300000"
        ),
    ]
    works = [
        notice(
            "4-2026",
            "2026-11-14",
            "France – Construction work – Hôpital Jean Verdier",
            "45000000",
            "Marché public global sectoriel de conception-réalisation du Nouvel Hôpital.",
        ),
        # A full-text hit deeper in the notice, not confirmed on the title and description.
        notice(
            "2-2026",
            "2026-11-12",
            "Spain – Construction work – Ejecución de las obras del Proyecto Básico y de Ejecución",
            "45000000",
        ),
        # Also in the design scope: kept once.
        notice(
            "3-2026",
            "2026-11-13",
            "France – Architectural services – Maîtrise d'oeuvre et appalto integrato",
            "71200000",
        ),
    ]

    def fetch(_url, body):
        return {"notices": scoped + works}

    documents = collect_ted_documents(
        source,
        limit=2000,
        publication_date_from="2026-11-08",
        fetch_json=fetch,
    )

    assert [d.source_url.rsplit("/", 2)[-2] for d in documents] == [
        "4-2026",
        "3-2026",
        "2-2026",
        "1-2026",
    ]
    assert json.loads(documents[1].payload)["title"].endswith("Maîtrise d'oeuvre")


def test_ted_source_search_query_skips_the_design_and_build_pass() -> None:
    source = _build_source(
        "ted_custom",
        collector="ted_search_api",
        name="TED custom scope",
        jurisdiction="eu",
        base_url="https://ted.europa.eu/",
        scan_method="api",
        extractor="ted_notice_parser",
    ).model_copy(update={"search_query": "classification-cpv = 71220000"})
    queries = []
    collect_ted_documents(
        source,
        publication_date_from="2026-01-01",
        fetch_json=lambda _url, body: queries.append(body["query"]) or {"notices": []},
    )
    assert queries == ["publication-date >= 20260101"]
