from __future__ import annotations

import json
import logging
from datetime import timedelta

from support import build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import doffin
from arch_competition_ops.collectors.doffin import collect_doffin_documents

DETAIL_PREFIX = "https://api.doffin.no/webclient/api/v2/notices-api/notices/"


def _source():
    return build_source(
        "doffin_notices",
        name="Doffin Notices",
        jurisdiction="norway",
        base_url="https://api.doffin.no/webclient/api/v2/search-api/search",
        scan_method="api",
        extractor="generic_listing_html",
        collector="doffin_search_api",
        regions=["europe", "norway"],
        languages=["no", "en"],
    )


def _day(offset: int) -> str:
    return (clock.today() - timedelta(days=offset)).isoformat()


def _hit(notice_id: str, *, published: str | None = None, **fields) -> dict:
    return {
        "id": notice_id,
        "heading": f"Notice {notice_id}",
        "type": "ANNOUNCEMENT_OF_COMPETITION",
        "status": "ACTIVE",
        "publicationDate": published or _day(1),
        **fields,
    }


class _FakeDoffin:
    """Serves search pages from a list of hits and a detail document per notice.

    The open works search of AI mode (CPV facet ``45000000``) is served from ``works`` and
    recorded in ``works_bodies``; every other search from ``hits`` into ``bodies``.
    """

    def __init__(
        self,
        hits: list[dict],
        details: dict[str, dict] | None = None,
        total=None,
        works: list[dict] | None = None,
    ):
        self.hits = hits
        self.works = works or []
        self.details = details or {}
        self.total = total
        self.bodies: list[dict] = []
        self.works_bodies: list[dict] = []
        self.detail_urls: list[str] = []

    def search(self, _url: str, body: dict) -> dict:
        is_works = body["facets"]["cpvCodesId"]["checkedItems"] == ["45000000"]
        (self.works_bodies if is_works else self.bodies).append(body)
        rows = self.works if is_works else self.hits
        size, page = body["numHitsPerPage"], body["page"]
        response = {"hits": rows[(page - 1) * size : page * size]}
        if self.total is not None:
            response.update(numHitsTotal=self.total, numHitsAccessible=1000)
        return response

    def detail(self, url: str) -> dict:
        self.detail_urls.append(url)
        notice_id = url.removeprefix(DETAIL_PREFIX)
        return self.details.get(notice_id, {"allCpvCodes": ["71200000"]})


def _collect(fake: _FakeDoffin, **kwargs):
    return collect_doffin_documents(
        _source(),
        fetch_search_json=fake.search,
        fetch_detail_json=fake.detail,
        include_unclassified=kwargs.pop("include_unclassified", True),
        **kwargs,
    )


def test_ai_mode_pages_through_the_default_window_with_the_design_scope():
    fake = _FakeDoffin([_hit(f"n{i:03d}") for i in range(doffin.PAGE_SIZE + 1)])

    documents = _collect(fake, limit=2000)

    assert len(documents) == doffin.PAGE_SIZE + 1
    assert [body["page"] for body in fake.bodies] == [1, 2]
    body = fake.bodies[0]
    assert body["numHitsPerPage"] == 100
    assert body["sortBy"] == "PUBLICATION_DATE_DESC"
    assert body["facets"]["publicationDate"] == {"from": _day(7), "to": None}
    assert body["facets"]["cpvCodesId"]["checkedItems"] == ["71000000", "79930000"]
    assert "ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT" not in body["facets"]["type"]["checkedItems"]
    assert body["facets"]["type"]["checkedItems"] == doffin.AI_OPEN_NOTICE_TYPES
    assert body["facets"]["contractNature"]["checkedItems"] == []
    urls = [document.source_url for document in documents]
    assert len(set(urls)) == len(urls)
    assert urls[0] == f"{DETAIL_PREFIX}n000"
    payload = json.loads(documents[0].payload)
    assert payload["rawNotice"]["listing"]["id"] == "n000"
    assert payload["officialUrl"] == "https://www.doffin.no/notices/n000"


def test_paging_stops_at_the_first_notice_older_than_the_window():
    hits = [_hit(f"n{i:03d}", published=_day(1)) for i in range(doffin.PAGE_SIZE - 1)]
    hits += [_hit("old", published=_day(10)), _hit("older", published=_day(11))]
    fake = _FakeDoffin(hits)

    documents = _collect(fake, limit=2000, publication_date_from=_day(3))

    assert len(documents) == doffin.PAGE_SIZE - 1
    assert len(fake.bodies) == 1
    assert fake.bodies[0]["facets"]["publicationDate"]["from"] == _day(3)
    assert not any(url.endswith(("/old", "/older")) for url in fake.detail_urls)


def test_paging_stops_at_the_page_cap_with_a_warning(caplog):
    fake = _FakeDoffin(
        [_hit(f"n{i:04d}") for i in range(doffin.PAGE_SIZE * (doffin.MAX_PAGES + 2))],
        total=5000,
    )

    with caplog.at_level(logging.WARNING, logger=doffin.__name__):
        documents = _collect(fake, limit=100_000)

    assert len(fake.bodies) == doffin.MAX_PAGES
    assert len(documents) == doffin.PAGE_SIZE * doffin.MAX_PAGES
    assert "serves only 1000" in caplog.text
    assert "paging stopped after 10 pages" in caplog.text


def test_paging_stops_when_the_limit_is_reached():
    fake = _FakeDoffin([_hit(f"n{i:03d}") for i in range(doffin.PAGE_SIZE * 3)])

    documents = _collect(fake, limit=5)

    assert len(documents) == 5
    assert len(fake.bodies) == 1
    assert len(fake.works_bodies) == 1
    assert len(fake.detail_urls) == 5


def test_ai_scope_keeps_open_design_or_unclassified_notices_and_drops_the_rest():
    hits = [
        _hit("design", heading="Rammeavtale arkitekttjenester"),
        _hit("interior"),
        _hit("unclassified"),
        _hit("works-only"),
        _hit("pin-cfc", type="PRE_ANNOUNCEMENT", status=None),
        _hit("award", type="ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT", status=None),
        _hit("intent", type="ANNOUNCEMENT_OF_INTENT", status=None),
        _hit("expired", status="EXPIRED"),
        _hit("cancelled", status="CANCELLED"),
    ]
    details = {
        "design": {"heading": "Rammeavtale arkitekttjenester", "allCpvCodes": ["71240000"]},
        "interior": {"allCpvCodes": ["39100000", "79932000"]},
        "unclassified": {"allCpvCodes": []},
        "works-only": {"allCpvCodes": ["45000000", "45210000"]},
        "pin-cfc": {"allCpvCodes": ["71000000"]},
    }
    fake = _FakeDoffin(hits, details)

    documents = _collect(fake, limit=50)

    kept = [json.loads(document.payload)["noticeId"] for document in documents]
    assert kept == ["design", "interior", "unclassified", "pin-cfc"]
    # Result and closed notices are dropped from the listing, before any detail request.
    fetched = {url.removeprefix(DETAIL_PREFIX) for url in fake.detail_urls}
    assert fetched == {"design", "interior", "unclassified", "works-only", "pin-cfc"}


def test_keyword_mode_keeps_its_filters_and_reads_without_a_default_window():
    fake = _FakeDoffin(
        [_hit("plan", heading="Rammeavtale planfagleg rådgjevingsteneste"), _hit("other")],
        {
            "plan": {
                "heading": "Rammeavtale planfagleg rådgjevingsteneste",
                "description": "Rådgjeving innan planlegging og reguleringsplanar.",
                "allCpvCodes": ["71240000", "71410000"],
            },
            "other": {"heading": "Naturtypekartlegging", "allCpvCodes": ["73200000"]},
        },
    )

    documents = _collect(fake, limit=5, include_unclassified=False)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["plan"]
    facets = fake.bodies[0]["facets"]
    assert facets["publicationDate"]["from"] is None
    assert facets["status"]["checkedItems"] == ["ACTIVE"]
    assert facets["contractNature"]["checkedItems"] == ["SERVICES"]
    assert "rawNotice" not in json.loads(documents[0].payload)


def test_ai_mode_adds_design_and_build_works_notices_from_one_works_search():
    scoped = [_hit("design", published=_day(3)), _hit("also-works", published=_day(2))]
    works = [
        _hit(
            "heer",
            published=_day(1),
            heading="26278 Heer barnehage - Ombygging, nytt bygg, totalentreprise",
        ),
        _hit("riving", published=_day(2), heading="Riving og miljøsanering av formålsbygg"),
        _hit(
            "also-works",
            published=_day(2),
            heading="NTNU Campussamling - K206 - Samspillsentreprise",
        ),
        _hit("old", published=_day(10), heading="Totalentreprise Dombås helsehus"),
    ]
    details = {
        "heer": {
            "heading": "26278 Heer barnehage - Ombygging, nytt bygg, totalentreprise",
            "allCpvCodes": ["45000000", "45214100"],
        },
        "also-works": {
            "heading": "NTNU Campussamling - K206 - Samspillsentreprise",
            "allCpvCodes": ["45000000", "71000000"],
        },
    }
    fake = _FakeDoffin(scoped, details, works=works)

    documents = _collect(fake, limit=50, publication_date_from=_day(7))

    assert [json.loads(d.payload)["noticeId"] for d in documents] == [
        "heer",
        "also-works",
        "design",
    ]
    assert len(fake.works_bodies) == 1
    works_body = fake.works_bodies[0]
    assert works_body["facets"]["type"]["checkedItems"] == doffin.AI_OPEN_NOTICE_TYPES
    assert works_body["facets"]["publicationDate"]["from"] == _day(7)
    # A works notice that names no design-and-build model never costs a detail request.
    fetched = [url.removeprefix(DETAIL_PREFIX) for url in fake.detail_urls]
    assert sorted(fetched) == ["also-works", "design", "heer"]


def test_ai_mode_drops_a_plain_works_notice_whose_detail_names_no_design_and_build_model():
    hits = [_hit("plain", heading="Rehabilitering av svømmebasseng")]
    details = {"plain": {"heading": "Rehabilitering av svømmebasseng", "allCpvCodes": ["45212212"]}}
    fake = _FakeDoffin(hits, details)

    assert _collect(fake, limit=50) == []
