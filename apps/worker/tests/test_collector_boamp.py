from __future__ import annotations

import json
import logging
from datetime import timedelta
from typing import Any
from urllib.parse import parse_qs, urlsplit

from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import boamp
from arch_competition_ops.collectors.boamp import collect_boamp_documents


def _source():
    return _build_source(
        "boamp_design_notices",
        collector="boamp_opendatasoft",
        name="BOAMP Design and Public Procurement Notices",
        jurisdiction="france",
        base_url="https://www.boamp.fr/",
        scan_method="api",
        extractor="boamp_notice_parser",
        languages=["fr"],
    )


def _day(offset: int) -> str:
    return (clock.today() - timedelta(days=offset)).isoformat()


def _eforms(*codes: str, amount: str | None = None) -> dict[str, Any]:
    project: dict[str, Any] = {
        "cac:MainCommodityClassification": {
            "cbc:ItemClassificationCode": {"@listName": "cpv", "#text": codes[0]}
        },
        "cac:AdditionalCommodityClassification": [
            {"cbc:ItemClassificationCode": {"@listName": "cpv", "#text": code}}
            for code in codes[1:]
        ],
    }
    if amount:
        project["cac:RequestedTenderTotal"] = {
            "cbc:EstimatedOverallContractAmount": {"@currencyID": "EUR", "#text": amount}
        }
    return {"EFORMS": {"ContractNotice": {"cac:ProcurementProject": project}}}


def _fnsimple(code: str) -> dict[str, Any]:
    return {
        "FNSimple": {
            "initial": {"natureMarche": {"codeCPV": {"objetPrincipal": {"classPrincipale": code}}}}
        }
    }


def _notice(
    idweb: str,
    *,
    donnees: dict[str, Any] | None = None,
    day: int = 1,
    nature: str = "APPEL_OFFRE",
    sousnature: str | None = None,
    etat: str = "INITIAL",
    title: str = "Prestations diverses",
) -> dict[str, Any]:
    return {
        "idweb": idweb,
        "id": idweb.replace("-", "_"),
        "url_avis": f"https://www.boamp.fr/pages/avis/?q=idweb:{idweb}",
        "objet": title,
        "dateparution": _day(day),
        "nature": nature,
        "sousnature": sousnature,
        "etat": etat,
        "descripteur_libelle": [],
        # The MAPA schema (contracts under 90 k EUR) has no CPV field at all.
        "donnees": json.dumps(donnees if donnees is not None else {"MAPA": {"initial": {}}}),
    }


def _pages(*pages: list[dict[str, Any]]):
    requests: list[dict[str, list[str]]] = []

    def fetch(url: str) -> dict[str, Any]:
        query = parse_qs(urlsplit(url).query)
        requests.append(query)
        index = int(query["offset"][0]) // int(query["limit"][0])
        return {"results": pages[index] if index < len(pages) else []}

    return fetch, requests


def _ids(documents) -> list[str]:
    return [json.loads(document.payload)["officialNoticeId"] for document in documents]


def test_ai_mode_scopes_to_design_cpv_contests_and_notices_without_cpv() -> None:
    fetch, requests = _pages(
        [
            _notice("1", donnees=_eforms("45000000", "71240000")),
            _notice("2", donnees=_fnsimple("79932000")),
            _notice("3", donnees=_eforms("45210000")),
            # An 8-digit amount outside a CPV field is not a CPV code.
            _notice("4", donnees=_eforms("45210000", amount="71000000")),
            _notice("5"),
            _notice("6", donnees=_eforms("45210000"), sousnature="CONCOURS"),
            _notice("7", donnees=_eforms("71240000"), nature="ATTRIBUTION"),
            _notice("8", donnees=_eforms("71240000"), etat="ANNULATION"),
        ]
    )

    documents = collect_boamp_documents(_source(), limit=2000, fetch_json=fetch)

    assert _ids(documents) == [str(i) for i in range(1, 9)]
    payloads = [json.loads(document.payload) for document in documents]
    assert payloads[0]["cpv"] == ["45000000", "71240000"]
    assert payloads[4]["cpv"] == []
    assert payloads[0]["rawNotice"]["idweb"] == "1"
    assert documents[0].source_url == "https://www.boamp.fr/pages/avis/?q=idweb:1"
    where = requests[0]["where"][0]
    assert f"dateparution >= date'{_day(7)}'" in where
    assert requests[0]["order_by"] == ["dateparution desc, idweb desc"]


def test_pages_through_the_window_with_fixed_pages_until_the_api_runs_out() -> None:
    full_page = [_notice(f"a{index}") for index in range(100)]
    fetch, requests = _pages(full_page, [_notice("b0"), _notice("b1")])

    documents = collect_boamp_documents(_source(), limit=2000, fetch_json=fetch)

    assert len(documents) == 102
    assert [query["offset"] for query in requests] == [["0"], ["100"]]
    assert {query["limit"][0] for query in requests} == {"100"}


def test_stops_at_the_first_notice_older_than_the_window() -> None:
    page = [_notice("new", day=2), _notice("old", day=4), _notice("older", day=5)]
    fetch, requests = _pages(page + [_notice(f"x{i}", day=6) for i in range(97)], page)

    documents = collect_boamp_documents(
        _source(),
        limit=2000,
        publication_date_from=_day(3),
        fetch_json=fetch,
    )

    assert _ids(documents) == ["new"]
    assert len(requests) == 1


def test_stops_when_limit_documents_are_kept() -> None:
    fetch, requests = _pages([_notice(f"a{index}") for index in range(100)])

    documents = collect_boamp_documents(_source(), limit=3, fetch_json=fetch)

    assert _ids(documents) == ["a0", "a1", "a2"]
    assert len(requests) == 1


def test_page_cap_stops_a_runaway_window_with_a_warning(monkeypatch, caplog) -> None:
    monkeypatch.setattr(boamp, "MAX_PAGES", 3)
    out_of_scope = [_notice(f"n{index}", donnees=_eforms("45000000")) for index in range(100)]
    fetch, requests = _pages(*[out_of_scope] * 5)

    with caplog.at_level(logging.WARNING, logger=boamp.__name__):
        documents = collect_boamp_documents(_source(), limit=2000, fetch_json=fetch)

    assert len(documents) == 3 * boamp.PAGE_SIZE
    assert len(requests) == 3
    assert "stopped after 3 pages" in caplog.text


def test_collection_preserves_unclassified_source_material() -> None:
    title = "Mission de maîtrise d'oeuvre pour la réhabilitation d'une école"
    fetch, _requests = _pages(
        [
            _notice("1", title=title, donnees=_eforms("45000000")),
            _notice("2", title="Fourniture de papier", donnees=_eforms("71240000")),
            _notice("3", title=title, nature="ATTRIBUTION"),
        ]
    )

    documents = collect_boamp_documents(_source(), limit=20, fetch_json=fetch)

    assert _ids(documents) == ["1", "2", "3"]


def test_ai_mode_keeps_design_and_build_works_notices_by_title() -> None:
    fetch, _requests = _pages(
        [
            _notice(
                "dnb",
                donnees=_eforms("45000000"),
                title="Marché global sectoriel de conception-réalisation du Nouvel Hôpital",
            ),
            _notice("works", donnees=_eforms("45210000"), title="Travaux de réfection de voirie"),
        ]
    )

    documents = collect_boamp_documents(_source(), limit=2000, fetch_json=fetch)

    assert _ids(documents) == ["dnb", "works"]
