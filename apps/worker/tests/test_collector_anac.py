from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import anac
from arch_competition_ops.collectors.anac import collect_anac_documents


def _source():
    return _build_source(
        "anac_bdncp_contracts",
        collector="anac_legal_publicity_api",
        name="ANAC BDNCP",
        jurisdiction="italy",
        base_url="https://pubblicitalegale.anticorruzione.it/",
        scan_method="html",
        extractor="bdncp_notice_parser",
        languages=["it"],
    )


def _day(offset: int) -> str:
    return (clock.today() - timedelta(days=offset)).isoformat()


def _notice(
    notice_id: str,
    *,
    cpv: tuple[str, ...] = (),
    scheda: str = "P1_16",
    day: int = 1,
    eform: str | None = None,
    title: str = "Procedura aperta",
) -> dict[str, Any]:
    # The list endpoint names each lot's CPV by its Italian label only.
    lots = [{"tipo_oggetto": "lotto", "descrizione": title, "cpv": label} for label in cpv]
    return {
        "idAvviso": notice_id,
        "codiceScheda": scheda,
        "codiceEform": eform,
        "tipo": "avviso",
        "dataPubblicazione": f"{_day(day)}T07:00:00.000+00:00",
        "templates": [
            {
                "template": {
                    "metadata": {"titolo": title, "descrizione": title},
                    "sections": [{"name": "SEZ. C - Oggetto", "items": lots}],
                }
            }
        ],
    }


def _pages(*pages: list[dict[str, Any]]):
    requests: list[dict[str, list[str]]] = []

    def fetch(url: str) -> dict[str, Any]:
        query = parse_qs(urlsplit(url).query)
        requests.append(query)
        index = int(query["page"][0])
        content = pages[index] if index < len(pages) else []
        return {"content": content, "last": index >= len(pages) - 1}

    return fetch, requests


def _ids(documents) -> list[str]:
    return [json.loads(document.payload)["officialNoticeId"] for document in documents]


def test_ai_mode_reads_the_open_groups_and_keeps_design_cpv_contests_and_unknown_cpv() -> None:
    fetch, requests = _pages(
        [
            _notice("design", cpv=("Lavori di costruzione", "Servizi di progettazione di edifici")),
            _notice("urban", cpv=("Servizi di urbanistica e architettura paesaggistica",)),
            _notice("works", cpv=("Lavori di costruzione",)),
            _notice("unknown"),
            _notice("contest", cpv=("Lavori di costruzione",), scheda="P2_23"),
            _notice("eu-contest", cpv=("Lavori di costruzione",), scheda="P1_24", eform="24"),
            # The detail format writes ``<code>_<label>``.
            _notice(
                "detail", cpv=("71240000_Servizi architettonici, di ingegneria e pianificazione",)
            ),
            _notice("award", cpv=("Servizi di progettazione di edifici",), scheda="AD3"),
            _notice("modification", cpv=("Servizi di ingegneria",), scheda="M2"),
        ]
    )

    documents = collect_anac_documents(
        _source(), limit=2000, include_unclassified=True, fetch_json=fetch
    )

    assert _ids(documents) == ["design", "urban", "unknown", "contest", "eu-contest", "detail"]
    assert json.loads(documents[0].payload)["rawNotice"]["idAvviso"] == "design"
    query = requests[0]
    assert query["codiceScheda"] == ["2,3,4,5a,5b,6"]
    assert query["dataPubblicazioneStart"] == [
        (clock.today() - timedelta(days=7)).strftime("%d/%m/%Y")
    ]
    assert query["size"] == ["100"]
    assert query["sortField"] == ["dataPubblicazione"]
    assert query["sortDirection"] == ["desc"]


def test_pages_with_a_fixed_size_until_the_last_page() -> None:
    fetch, requests = _pages(
        [_notice(f"a{index}") for index in range(100)],
        [_notice(f"b{index}") for index in range(100)],
        [_notice("c0")],
    )

    documents = collect_anac_documents(
        _source(), limit=2000, include_unclassified=True, fetch_json=fetch
    )

    assert len(documents) == 201
    assert [query["page"] for query in requests] == [["0"], ["1"], ["2"]]
    assert {query["size"][0] for query in requests} == {"100"}


def test_stops_at_the_first_notice_older_than_the_window() -> None:
    page = [_notice("new", day=2), _notice("old", day=4)]
    fetch, requests = _pages(page + [_notice(f"x{i}", day=5) for i in range(98)], page)

    documents = collect_anac_documents(
        _source(),
        limit=2000,
        publication_date_from=_day(3),
        include_unclassified=True,
        fetch_json=fetch,
    )

    assert _ids(documents) == ["new"]
    assert len(requests) == 1


def test_page_cap_stops_a_runaway_window_with_a_warning(monkeypatch, caplog) -> None:
    monkeypatch.setattr(anac, "MAX_PAGES", 2)
    fetch, requests = _pages(
        *[
            [_notice(f"p{page}-{i}", cpv=("Lavori di costruzione",)) for i in range(100)]
            for page in range(4)
        ]
    )

    with caplog.at_level(logging.WARNING, logger=anac.__name__):
        documents = collect_anac_documents(
            _source(), limit=2000, include_unclassified=True, fetch_json=fetch
        )

    assert documents == []
    assert len(requests) == 2
    assert "stopped after 2 pages" in caplog.text


def test_without_ai_the_whole_feed_is_read_through_the_keyword_gates() -> None:
    fetch, requests = _pages(
        [
            _notice(
                "direct-award",
                scheda="AD3",
                title="Affidamento diretto dei servizi di progettazione esecutiva per il museo",
            ),
            _notice("supplies", title="Fornitura di cancelleria"),
        ]
    )

    documents = collect_anac_documents(_source(), limit=20, fetch_json=fetch)

    assert _ids(documents) == ["direct-award"]
    assert "codiceScheda" not in requests[0]


def test_ai_mode_keeps_design_and_build_works_notices_by_title() -> None:
    fetch, _requests = _pages(
        [
            _notice(
                "integrato",
                cpv=("Lavori di costruzione",),
                title="Appalto integrato: progettazione esecutiva ed esecuzione dei lavori",
            ),
            _notice("works", cpv=("Lavori di costruzione",), title="Lavori di manutenzione"),
        ]
    )

    documents = collect_anac_documents(
        _source(), limit=2000, include_unclassified=True, fetch_json=fetch
    )

    assert _ids(documents) == ["integrato"]
