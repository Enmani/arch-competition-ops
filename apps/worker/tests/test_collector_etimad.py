from __future__ import annotations

import json
import logging
from datetime import date
from urllib import parse

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import etimad
from arch_competition_ops.collectors.etimad import collect_etimad_documents
from arch_competition_ops.collectors.mideast_common import PortalChallengeError, raise_if_challenged
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice
from arch_competition_ops.http import HttpStatusError


def _source():
    return _build_source(
        "sa_etimad_visitor_tenders",
        name="Etimad Visitor Tender List",
        jurisdiction="saudi_arabia",
        base_url="https://tenders.etimad.sa/Tender/AllTendersForVisitor",
        scan_method="api",
        extractor="generic_listing_html",
        collector="etimad_visitor_tenders",
        regions=["middle_east", "saudi_arabia"],
        languages=["ar"],
    )


def _row(
    tender_id: int,
    published: str,
    *,
    deadline: str = "2026-12-01",
    name: str = "تصميم مبنى إداري",
    activity_id: int = 1610,
    ugrp: bool = False,
    type_id: int = 1,
    id_string: str | None = None,
) -> dict:
    return {
        "tenderId": tender_id,
        "referenceNumber": f"26113900{tender_id}",
        "tenderNumber": f"T-{tender_id}",
        "tenderName": name,
        "agencyName": "وزارة البلديات",
        "tenderIdString": f"id{tender_id}==" if id_string is None else id_string,
        "tenderTypeId": type_id,
        "tenderTypeName": "منافسة عامة",
        "tenderActivityId": activity_id,
        "tenderActivityName": "انشطة الاستشارات الهندسية - تصميم",
        "submitionDate": f"{published}T10:00:00",
        "lastOfferPresentationDate": f"{deadline}T10:00:00",
        "isUGRP": ugrp,
    }


class FakePortal:
    """Serves rows per activity, 24 a page, and HTTP 400 past the end like the real endpoint."""

    page_size = 24

    def __init__(self, rows_by_activity: dict[int, list[dict]]) -> None:
        self.rows_by_activity = rows_by_activity
        self.urls: list[str] = []

    def __call__(self, url: str) -> dict:
        self.urls.append(url)
        query = dict(parse.parse_qsl(parse.urlsplit(url).query))
        rows = self.rows_by_activity.get(int(query["TenderActivityId"]), [])
        page = int(query["PageNumber"])
        chunk = rows[(page - 1) * self.page_size : page * self.page_size]
        if page > 1 and not chunk:
            raise HttpStatusError("Unexpected HTTP status 400", url=url, status_code=400)
        return {"data": chunk, "totalCount": len(rows)}

    def pages_of(self, activity: int) -> list[int]:
        pages = []
        for url in self.urls:
            query = dict(parse.parse_qsl(parse.urlsplit(url).query))
            if int(query["TenderActivityId"]) == activity:
                pages.append(int(query["PageNumber"]))
        return pages


DETAIL = (
    "<html><body>المعلومات الأساسية اسم المنافسة تصميم مبنى الغرض من المنافسة إعداد التصاميم "
    "الرجوع الى جميع المنافسات<script>var x = 1;</script></body></html>"
)


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def _collect(portal, **kwargs):
    details: list[str] = []

    def fetch_text(url: str) -> str:
        details.append(url)
        return DETAIL

    kwargs.setdefault("include_unclassified", True)
    kwargs.setdefault("limit", 1000)
    documents = collect_etimad_documents(
        _source(), fetch_json=portal, fetch_text=fetch_text, **kwargs
    )
    return documents, details


def test_family_is_registered() -> None:
    assert COLLECTORS["etimad_visitor_tenders"] is collect_etimad_documents


def test_reads_consulting_then_contracting_for_the_last_week() -> None:
    portal = FakePortal({16: [_row(1, "2026-11-14")], 2: []})

    _collect(portal)

    first = dict(parse.parse_qsl(parse.urlsplit(portal.urls[0]).query))
    assert first["TenderActivityId"] == "16"
    assert first["PublishDateId"] == "3"
    assert (first["Sort"], first["SortDirection"]) == ("SubmitionDate", "DESC")
    assert portal.pages_of(2)[0] == 1


def test_wider_windows_pick_the_wider_server_bucket() -> None:
    portal = FakePortal({16: [], 2: []})

    _collect(portal, publication_date_from="2026-10-20")

    assert "PublishDateId=4" in portal.urls[0]


def test_pages_until_a_page_has_nothing_new_or_the_server_ends() -> None:
    rows = [_row(i, "2026-11-14") for i in range(1, 60)]
    portal = FakePortal({16: rows, 2: []})

    documents, _ = _collect(portal)

    assert len(documents) == 59
    # Pages 1 to 3 hold the rows; page 4 is past the end (HTTP 400) and ends the walk quietly.
    assert portal.pages_of(16) == [1, 2, 3, 4]


def test_a_failing_first_page_is_an_error() -> None:
    def broken(url: str) -> dict:
        raise HttpStatusError("Unexpected HTTP status 500", url=url, status_code=500)

    with pytest.raises(HttpStatusError):
        collect_etimad_documents(_source(), fetch_json=broken, fetch_text=lambda url: DETAIL)


def test_stops_on_the_first_page_that_is_entirely_older_than_the_window() -> None:
    rows = [_row(i, "2026-11-14") for i in range(1, 25)]
    rows += [_row(i, "2026-10-01") for i in range(25, 49)]
    rows += [_row(i, "2026-09-01") for i in range(49, 73)]
    portal = FakePortal({16: rows, 2: []})

    documents, _ = _collect(portal)

    assert len(documents) == 24
    assert portal.pages_of(16) == [1, 2]


def test_page_cap_stops_a_runaway_listing_with_a_warning(caplog) -> None:
    class Endless(FakePortal):
        def __call__(self, url: str) -> dict:
            self.urls.append(url)
            page = int(dict(parse.parse_qsl(parse.urlsplit(url).query))["PageNumber"])
            if "TenderActivityId=2&" in url:
                return {"data": []}
            return {"data": [_row(page * 100 + n, "2026-11-14") for n in range(24)]}

    portal = Endless({})
    with caplog.at_level(logging.WARNING, logger=etimad.logger.name):
        documents, _ = _collect(portal)

    assert portal.pages_of(16) == list(range(1, etimad.MAX_PAGES_PER_SCOPE + 1))
    assert len(documents) == 24 * etimad.MAX_PAGES_PER_SCOPE
    assert "page cap" in caplog.text


def test_drops_closed_new_system_and_duplicate_tenders() -> None:
    portal = FakePortal(
        {
            16: [
                _row(1, "2026-11-14"),
                _row(2, "2026-11-14", deadline="2026-11-10"),
                _row(3, "2026-11-14", ugrp=True, activity_id=0),
                _row(4, "2026-11-14", id_string=""),
                _row(1, "2026-11-14"),
            ],
            2: [],
        }
    )

    documents, _ = _collect(portal)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["261139001"]


def test_ai_mode_keeps_unclassified_consulting_rows_but_only_design_and_build_works() -> None:
    portal = FakePortal(
        {
            16: [
                _row(1, "2026-11-14", name="خدمات استشارية للموارد البشرية", activity_id=1603),
                _row(2, "2026-11-14", name="استشارات", activity_id=0),
            ],
            2: [
                _row(3, "2026-11-14", name="Design and build of a depot", activity_id=205),
                _row(4, "2026-11-14", name="Resurfacing of roads", activity_id=204),
            ],
        }
    )

    documents, _ = _collect(portal)

    assert sorted(json.loads(d.payload)["tenderNumber"] for d in documents) == [
        "T-1",
        "T-2",
        "T-3",
    ]


def test_plain_mode_needs_a_design_sub_activity_or_an_arabic_design_word() -> None:
    portal = FakePortal(
        {
            16: [
                _row(1, "2026-11-14", name="خدمات الحراسة والأمن", activity_id=1603),
                _row(2, "2026-11-14", name="أعمال مساحية", activity_id=1610),
                _row(3, "2026-11-14", name="تصميم واجهات", activity_id=1609),
            ],
            2: [],
        }
    )

    documents, details = _collect(portal, include_unclassified=False)

    assert sorted(json.loads(d.payload)["tenderNumber"] for d in documents) == ["T-2", "T-3"]
    assert details == []
    assert "rawNotice" not in json.loads(documents[0].payload)


def test_every_notice_has_its_own_address_with_the_portal_id_kept_as_written() -> None:
    portal = FakePortal(
        {
            16: [
                _row(1, "2026-11-14", id_string="a*@@**b=="),
                _row(2, "2026-11-14", id_string="c d=="),
                _row(3, "2026-11-14", type_id=15, id_string="e=="),
            ],
            2: [],
        }
    )

    documents, _ = _collect(portal)

    assert {d.source_url for d in documents} == {
        "https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId=a*@@**b%3D%3D",
        "https://tenders.etimad.sa/Tender/DetailsForVisitor?STenderId=c%20d%3D%3D",
        "https://tenders.etimad.sa/Tender/DetailsTenderAnnouncement?STenderId=e%3D%3D",
    }
    assert all(json.loads(d.payload)["officialUrl"] == d.source_url for d in documents)


def test_limit_applies_before_detail_pages_are_fetched_newest_first() -> None:
    rows = [_row(i, f"2026-11-{14 - i % 5:02d}") for i in range(1, 11)]
    portal = FakePortal({16: rows, 2: []})

    documents, details = _collect(portal, limit=3)

    assert len(documents) == len(details) == 3
    published = [json.loads(d.payload)["publishedAt"] for d in documents]
    assert published == sorted(published, reverse=True)
    assert _collect(portal, limit=0)[0] == []


def test_payload_carries_explicit_facts_and_the_detail_text() -> None:
    portal = FakePortal({16: [_row(7, "2026-11-14", deadline="2026-12-03")], 2: []})

    [document], _ = _collect(portal)
    payload = json.loads(document.payload)

    assert payload["title"] == "تصميم مبنى إداري"
    assert payload["buyer"] == "وزارة البلديات"
    assert payload["deadline"] == "2026-12-03"
    assert payload["publishedAt"] == "2026-11-14"
    assert payload["country"] == "Saudi Arabia"
    assert payload["rawNotice"]["tenderId"] == 7
    # Script bodies and text after the page's own end marker are not evidence.
    assert payload["rawNoticeHtml"] == payload["summary"]
    assert payload["summary"].startswith("المعلومات الأساسية اسم المنافسة تصميم مبنى")
    assert "var x" not in payload["summary"]

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == document.source_url
    assert record.deadline_at == date(2026, 12, 3)


def test_a_detail_page_that_fails_keeps_the_notice_with_an_empty_raw_html() -> None:
    portal = FakePortal({16: [_row(1, "2026-11-14")], 2: []})

    def broken(url: str) -> str:
        raise HttpStatusError("Unexpected HTTP status 500", url=url, status_code=500)

    [document] = collect_etimad_documents(
        _source(), fetch_json=portal, fetch_text=broken, include_unclassified=True
    )

    assert json.loads(document.payload)["rawNoticeHtml"] == ""


def test_a_bot_challenge_is_a_hard_stop() -> None:
    with pytest.raises(PortalChallengeError):
        raise_if_challenged(
            "<html>What code is in the image? Your support ID is: 1</html>", portal="Etimad"
        )
    raise_if_challenged(DETAIL, portal="Etimad")

    def challenged(url: str) -> str:
        raise PortalChallengeError("challenge")

    portal = FakePortal({16: [_row(1, "2026-11-14")], 2: []})
    with pytest.raises(PortalChallengeError):
        collect_etimad_documents(
            _source(), fetch_json=portal, fetch_text=challenged, include_unclassified=True
        )
