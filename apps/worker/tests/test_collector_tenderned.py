from __future__ import annotations

import json
import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from support import build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import tenderned
from arch_competition_ops.collectors.tenderned import collect_tenderned_documents

BASE_URL = "https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties"


def _source():
    return build_source(
        "tenderned_contract_notices",
        name="TenderNed Contract Notices",
        jurisdiction="netherlands",
        base_url=BASE_URL,
        scan_method="api",
        extractor="generic_listing_html",
        collector="tenderned_publications_api",
        regions=["europe", "netherlands"],
        languages=["nl", "en"],
    )


def _day(offset: int) -> str:
    return (clock.today() - timedelta(days=offset)).isoformat()


def _row(publicatie_id: str, *, published: str | None = None, **fields) -> dict:
    return {
        "publicatieId": publicatie_id,
        "publicatieDatum": published or _day(1),
        "aanbestedingNaam": f"Publicatie {publicatie_id}",
        "typePublicatie": {"code": "AAO"},
        "publicatiecode": {"code": "EF16"},
        "typeOpdracht": {"code": "D"},
        "publicatiestatus": {"code": "PUB"},
        "sluitingsDatum": "2026-06-30T12:00:00",
        "link": {"href": f"https://www.tenderned.nl/aankondigingen/overzicht/{publicatie_id}"},
        **fields,
    }


class _FakeTenderNed:
    """Serves the CPV-scoped listing, the contract-notice listing and detail documents.

    The open works listing of AI mode (``cpvCodes=45000000-7``) is served from ``works`` and
    recorded in ``works_queries``; the other listings are recorded in ``list_queries``.
    """

    def __init__(
        self,
        scoped: list[dict],
        notices: list[dict] | None = None,
        details=None,
        works: list[dict] | None = None,
    ):
        self.scoped = scoped
        self.notices = notices or []
        self.works = works or []
        self.details = details or {}
        self.list_queries: list[dict[str, list[str]]] = []
        self.works_queries: list[dict[str, list[str]]] = []
        self.detail_ids: list[str] = []

    def __call__(self, url: str) -> dict:
        parts = urlsplit(url)
        if not parts.query:
            publicatie_id = parts.path.rsplit("/", 1)[-1]
            self.detail_ids.append(publicatie_id)
            return self.details.get(publicatie_id, {"cpvCodes": [{"code": "71200000-0"}]})
        query = parse_qs(parts.query)
        if query.get("cpvCodes") == ["45000000-7"]:
            self.works_queries.append(query)
            rows = self.works
        else:
            self.list_queries.append(query)
            rows = (
                self.notices
                if "typeOpdracht" in query
                else list(
                    {
                        r["publicatieId"]: r for r in [*self.scoped, *self.notices, *self.works]
                    }.values()
                )
            )
        page, size = int(query["page"][0]), int(query["size"][0])
        content = rows[page * size : (page + 1) * size]
        return {"content": content, "last": (page + 1) * size >= len(rows)}


def test_ai_mode_pages_the_default_window_with_the_server_side_cpv_scope():
    fake = _FakeTenderNed([_row(f"{i:03d}") for i in range(tenderned.PAGE_SIZE + 1)])

    documents = collect_tenderned_documents(_source(), limit=2000, fetch_json=fake)

    assert len(documents) == tenderned.PAGE_SIZE + 1
    scoped_queries = fake.list_queries
    assert [q["page"] for q in scoped_queries] == [["0"], ["1"]]
    query = scoped_queries[0]
    assert query["size"] == ["100"]
    assert query["publicatieDatumVanaf"] == [_day(7)]
    assert "cpvCodes" not in query and "publicatieType" not in query
    urls = [document.source_url for document in documents]
    assert len(set(urls)) == len(urls)
    assert urls[0] == f"{BASE_URL}/000"
    payload = json.loads(documents[0].payload)
    assert payload["rawNotice"]["listing"]["publicatieId"] == "000"
    assert payload["officialUrl"] == "https://www.tenderned.nl/aankondigingen/overzicht/000"


def test_paging_stops_at_the_first_row_older_than_the_window():
    rows = [_row(f"{i:03d}") for i in range(tenderned.PAGE_SIZE - 1)]
    rows += [_row("old", published=_day(10))] + [
        _row(f"x{i}", published=_day(11)) for i in range(5)
    ]
    fake = _FakeTenderNed(rows)

    documents = collect_tenderned_documents(
        _source(),
        limit=2000,
        publication_date_from=_day(3),
        fetch_json=fake,
    )

    assert len(documents) == tenderned.PAGE_SIZE - 1
    assert len(fake.list_queries) == 1
    assert "old" not in fake.detail_ids


def test_paging_stops_at_the_page_cap_with_a_warning(caplog):
    total = tenderned.PAGE_SIZE * (tenderned.MAX_PAGES + 1)
    fake = _FakeTenderNed([_row(f"{i:05d}") for i in range(total)])

    with caplog.at_level(logging.WARNING, logger=tenderned.__name__):
        documents = collect_tenderned_documents(_source(), limit=100_000, fetch_json=fake)

    assert len(fake.list_queries) == tenderned.MAX_PAGES
    assert len(documents) == tenderned.PAGE_SIZE * tenderned.MAX_PAGES
    assert "paging stopped after 50 pages" in caplog.text


def test_paging_stops_when_the_limit_is_reached():
    fake = _FakeTenderNed([_row(f"{i:03d}") for i in range(tenderned.PAGE_SIZE * 3)])

    documents = collect_tenderned_documents(_source(), limit=5, fetch_json=fake)

    assert len(documents) == 5
    # Each listing is read only as far as the merged newest-first stream is consumed.
    assert [q["page"] for q in fake.list_queries + fake.works_queries] == [["0"]]
    assert len(fake.detail_ids) == 5


def test_ai_scope_keeps_open_design_or_unclassified_notices_and_drops_the_rest():
    scoped = [
        _row("design"),
        _row("correction", typePublicatie={"code": "REC"}),
        _row("pin-cfc", typePublicatie={"code": "VAK"}, publicatiecode={"code": "EF10"}),
        _row("national", publicatiecode={"code": "EFE3"}, typeOpdracht={"code": "W"}),
        _row("unclassified"),
        _row("off-scope"),
        _row("award", typePublicatie={"code": "AGO"}, publicatiecode={"code": "EF29"}),
        _row("award-fix", typePublicatie={"code": "REC"}, publicatiecode={"code": "EF29"}),
        _row("modification", typePublicatie={"code": "AAW"}, publicatiecode={"code": "EF38"}),
        _row("terminated", typePublicatie={"code": "VBE"}),
        _row("pin-only", typePublicatie={"code": "VAK"}, publicatiecode={"code": "EF04"}),
        _row("consultation", typePublicatie={"code": "MAC"}, publicatiecode={"code": "EFE1"}),
    ]
    notices = [
        _row("design"),  # already read from the scoped listing
        _row("contest", publicatiecode={"code": "EF23"}),
        _row("works", typeOpdracht={"code": "W"}),
    ]
    details = {
        "unclassified": {"cpvCodes": []},
        "off-scope": {"cpvCodes": [{"code": "45000000-7"}]},
        "contest": {"cpvCodes": [{"code": "90700000-4"}]},
        "national": {"cpvCodes": [{"code": "45000000-7"}, {"code": "79932000-6"}]},
    }
    fake = _FakeTenderNed(scoped, notices, details)

    documents = collect_tenderned_documents(_source(), limit=50, fetch_json=fake)

    kept = [json.loads(document.payload)["noticeId"] for document in documents]
    assert kept == list(dict.fromkeys(r["publicatieId"] for r in scoped + notices))
    assert fake.detail_ids == kept


def test_unclassified_publications_use_the_default_window():
    fake = _FakeTenderNed([], [_row("421000", aanbestedingNaam="Brokerdienstverlening")])

    assert len(collect_tenderned_documents(_source(), fetch_json=fake)) == 1

    query = fake.list_queries[0]
    assert query["publicatieDatumVanaf"] == [_day(7)]
    assert "publicatieType" not in query
    assert "typeOpdracht" not in query
    assert "cpvCodes" not in query
    assert len(fake.detail_ids) == 1


def test_ai_mode_adds_design_and_build_works_publications_from_the_works_listing():
    scoped = [_row("design", published=_day(3))]
    works = [
        _row(
            "ikc-oost",
            published=_day(1),
            aanbestedingNaam="Bouwkundig aannemer bouwteam realisatie IKC Oost te Brunssum",
            typeOpdracht={"code": "W"},
            typePublicatie={"code": "REC"},
            publicatiecode={"code": "EFE3"},
        ),
        _row(
            "schenkel",
            published=_day(2),
            aanbestedingNaam="Sport- en beweegcentrum Schenkel",
            opdrachtBeschrijving="Design & Build opdracht voor een nieuw sportcentrum.",
            typeOpdracht={"code": "W"},
        ),
        _row(
            "sloop",
            published=_day(2),
            aanbestedingNaam="Circulaire sloop Stadskantoor",
            typeOpdracht={"code": "W"},
        ),
        _row(
            "award",
            published=_day(2),
            aanbestedingNaam="Bouwteam Rivierenbuurt",
            typePublicatie={"code": "AGO"},
            publicatiecode={"code": "EF29"},
        ),
    ]
    works_detail = {"cpvCodes": [{"code": "45214200-2"}]}
    details = {"ikc-oost": works_detail, "schenkel": works_detail}
    fake = _FakeTenderNed(scoped, details=details, works=works)

    documents = collect_tenderned_documents(
        _source(),
        limit=50,
        publication_date_from=_day(7),
        fetch_json=fake,
    )

    assert [json.loads(d.payload)["noticeId"] for d in documents] == [
        r["publicatieId"] for r in scoped + works
    ]
    assert fake.works_queries == []


def test_ai_mode_keeps_a_plain_works_publication_in_the_scoped_listing():
    scoped = [_row("plain", aanbestedingNaam="Renovatie sportaccommodatie Scharn")]
    fake = _FakeTenderNed(scoped, details={"plain": {"cpvCodes": [{"code": "45212200-8"}]}})

    documents = collect_tenderned_documents(_source(), limit=50, fetch_json=fake)
    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["plain"]
