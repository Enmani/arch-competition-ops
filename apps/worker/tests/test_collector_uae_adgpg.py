from __future__ import annotations

import json
import logging
from datetime import date
from typing import Any

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import adgpg
from arch_competition_ops.collectors.adgpg import collect_adgpg_documents
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice
from arch_competition_ops.http import HttpStatusError

PAGE = "https://supplier.adgpg.gov.ae/pages/tender-detail.html?tenderid="


def _source():
    return _build_source(
        "uae_adgpg_public_tenders",
        name="Abu Dhabi Government Procurement Gate Public Tenders",
        jurisdiction="united_arab_emirates",
        base_url="https://supplier.adgpg.gov.ae/pages/tender-list.html",
        scan_method="api",
        extractor="generic_listing_html",
        collector="adgpg_public_tenders",
        regions=["middle_east", "united_arab_emirates"],
        languages=["en", "ar"],
    )


def _row(
    tender_id: int,
    *,
    name: str = "RFQ-Consultancy Services for Public Realm Studies",
    due: str = "2026-12-09T00:00:00Z",
    details: str = "Studies for the public realm.",
    entity: str = "ADPIC - Department of Municipalities and Transport (DMT)",
) -> dict:
    return {
        "TenderID": tender_id,
        "TenderName": name,
        "TenderNumber": f"66{tender_id}",
        "EntityName": entity,
        "InternalStatus": "OPEN",
        "DueDate": due,
        "TenderDetails": details,
        "BiddingOpenDate": None,
    }


def _detail(
    row: dict, *, opened: str = "2026-11-13", categories: list[int] | None = None, **extra: Any
) -> dict:
    return {
        "TenderDetails": {
            **row,
            "BiddingOpenDate": f"{opened}T00:00:00Z",
            "EventType": "RFQ",
            "categoryId": [80000000] if categories is None else categories,
            "CategoryDescriptionEn": "Management and Business Professionals - Consulting",
            "Attachments": [],
            "EstimatedValue": "AED 0 - 0",
            **extra,
        },
        "ResponseStatus": 200,
    }


class FakeGate:
    """Serves the open list newest first by ``offset``/``limit`` and a detail per tender."""

    def __init__(self, rows: list[dict], details: dict[int, dict] | None = None) -> None:
        self.rows = rows
        self.details = details or {}
        self.forms: list[dict[str, Any]] = []
        self.detail_calls: list[int] = []

    def fetch_list(self, form: dict[str, Any]) -> dict:
        self.forms.append(form)
        offset, limit = int(form["offset"]), int(form["limit"])
        return {
            "TenderList": self.rows[offset : offset + limit],
            "TenderCount": len(self.rows),
            "ResponseStatus": 200,
        }

    def fetch_detail(self, tender_id: int) -> dict:
        self.detail_calls.append(tender_id)
        if tender_id in self.details:
            return self.details[tender_id]
        row = next(r for r in self.rows if r["TenderID"] == tender_id)
        return _detail(row)

    def run(self, **kwargs: Any) -> list:
        kwargs.setdefault("limit", 1000)
        return collect_adgpg_documents(
            _source(), fetch_list=self.fetch_list, fetch_detail=self.fetch_detail, **kwargs
        )


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def _ids(documents: list) -> list[str]:
    return [d.source_url.removeprefix(PAGE) for d in documents]


def test_family_is_registered() -> None:
    assert COLLECTORS["adgpg_public_tenders"] is collect_adgpg_documents


def test_asks_for_the_open_list_newest_first() -> None:
    gate = FakeGate([_row(1)])
    gate.run()

    assert gate.forms[0] == {
        "status": "OPEN",
        "offset": 0,
        "limit": adgpg.LIST_PAGE_SIZE,
        "Category": "",
        "Entity": "",
        "Sorting": "LAST_CREATED",
        "DueDate": "",
        "Name": "",
    }


def test_pages_the_list_by_offset_and_each_notice_has_its_own_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(adgpg, "LIST_PAGE_SIZE", 4)
    gate = FakeGate([_row(100 + index) for index in range(10)])

    documents = gate.run()

    assert [form["offset"] for form in gate.forms] == [0, 4, 8]
    assert _ids(documents) == [str(100 + index) for index in range(10)]
    assert len({d.source_url for d in documents}) == 10


def test_page_cap_stops_an_endless_list_and_logs_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(adgpg, "LIST_PAGE_SIZE", 2)
    monkeypatch.setattr(adgpg, "MAX_LIST_PAGES", 2)
    gate = FakeGate([_row(100 + index) for index in range(10)])

    with caplog.at_level(logging.WARNING, logger=adgpg.logger.name):
        documents = gate.run()

    assert len(gate.forms) == 2
    assert _ids(documents) == ["100", "101", "102", "103"]
    assert "not fully read" in caplog.text


def test_window_ends_after_three_tenders_in_a_row_opened_before_it() -> None:
    rows = [_row(index) for index in range(10, 0, -1)]
    openings = {
        10: "2026-11-13",
        9: "2026-11-12",
        8: "2026-11-06",  # one stray old tender does not end the read
        7: "2026-11-11",
        6: "2026-11-07",
        5: "2026-11-01",
        4: "2026-10-01",  # the third old one in a row: the read ends here
    }
    details = {row["TenderID"]: _detail(row, opened=openings[row["TenderID"]]) for row in rows[:7]}
    gate = FakeGate(rows, details)

    documents = gate.run()

    assert _ids(documents) == ["10", "9", "7"]
    assert gate.detail_calls == [10, 9, 8, 7, 6, 5, 4]


def test_default_window_is_seven_days_and_an_explicit_start_overrides_it() -> None:
    rows = [_row(2), _row(1)]
    details = {2: _detail(rows[0], opened="2026-11-10"), 1: _detail(rows[1], opened="2026-11-05")}

    assert _ids(FakeGate(rows, details).run()) == ["2"]
    assert _ids(FakeGate(rows, details).run(publication_date_from="2026-11-01")) == ["2", "1"]


def test_category_scope_in_ai_mode() -> None:
    rows = [_row(index) for index in range(1, 8)]
    rows[4] = _row(5, name="RFQ-Design and Build of the visitor centre")
    categories = {
        1: [80000000],  # management and business professional services: in
        2: [43000000],  # IT hardware, a product: out
        3: [72000000],  # building construction and maintenance, plain works: out
        4: [],  # no category: unknown, kept
        5: [72000000],  # works, but the title names the design-and-build model: in
        6: [81000000, 43000000],  # a service among the categories: in
        7: [95000000],  # land and buildings: in
    }
    details = {i: _detail(rows[i - 1], categories=categories[i]) for i in categories}

    documents = FakeGate(rows, details).run()

    assert _ids(documents) == [str(i) for i in range(1, 8)]


def test_design_and_build_rescues_a_works_only_tender_from_its_summary() -> None:
    row = _row(1, name="RFQ-Road works", details="Design and construction of a local road.")

    works_only = FakeGate([row], {1: _detail(row, categories=[72000000])}).run()
    plain_works = _row(2, name="RFQ-Road works", details="Resurfacing of a local road.")
    dropped = FakeGate([plain_works], {2: _detail(plain_works, categories=[72000000])}).run()

    assert _ids(works_only) == ["1"]
    assert _ids(dropped) == ["2"]


def test_collection_preserves_unclassified_source_material() -> None:
    rows = [
        _row(2, name="RFQ-Architectural design of a school", details="A new school building."),
        _row(1, name="RFQ-Office stationery supply", details="Paper and pens."),
    ]

    documents = FakeGate(rows).run()

    assert _ids(documents) == ["2", "1"]
    assert "rawNotice" in json.loads(documents[0].payload)


def test_limit_stops_the_read_and_the_detail_requests() -> None:
    gate = FakeGate([_row(index) for index in range(10, 0, -1)])

    documents = gate.run(limit=3)

    assert len(documents) == 3
    assert gate.detail_calls == [10, 9, 8]


def test_closed_and_duplicate_tenders_are_dropped_before_any_detail_request() -> None:
    gate = FakeGate(
        [
            _row(4),
            _row(3, due="2026-11-14T00:00:00Z"),
            _row(4),
            _row(2, due="2026-11-15T00:00:00Z"),
        ]
    )

    documents = gate.run()

    assert _ids(documents) == ["4", "3", "2"]
    assert gate.detail_calls == [4, 3, 2]


def test_unreadable_detail_keeps_the_tender_from_the_list(
    caplog: pytest.LogCaptureFixture,
) -> None:
    rows = [_row(2), _row(1)]
    gate = FakeGate(rows)

    def flaky(tender_id: int) -> dict:
        if tender_id == 2:
            raise HttpStatusError("boom", url="https://x", status_code=500)
        return gate.fetch_detail(tender_id)

    with caplog.at_level(logging.WARNING, logger=adgpg.logger.name):
        documents = collect_adgpg_documents(
            _source(),
            limit=10,
            fetch_list=gate.fetch_list,
            fetch_detail=flaky,
        )

    assert _ids(documents) == ["2", "1"]
    payload = json.loads(documents[0].payload)
    assert payload["publishedAt"] is None
    assert payload["rawNotice"]["detail"] is None
    assert "detail unreadable" in caplog.text


def test_payload_carries_explicit_facts_and_its_own_notice_page() -> None:
    row = _row(1442429, name="RFQ-DMT-RFP-26-131 Bus Bays Enhancement", due="2026-12-10T00:00:00Z")
    row["EntityName"] = "Abu Dhabi Heritage Authority-"
    gate = FakeGate(
        [row], {1442429: _detail(row, opened="2026-11-12", EstimatedValue="AED 1,000 - 2,000")}
    )

    [document] = gate.run()
    payload = json.loads(document.payload)

    assert document.source_url == PAGE + "1442429"
    assert payload["officialUrl"] == PAGE + "1442429"
    assert payload["title"] == "DMT-RFP-26-131 Bus Bays Enhancement"
    assert payload["buyer"] == "Abu Dhabi Heritage Authority"
    assert payload["noticeId"] == "661442429"
    assert payload["deadline"] == "2026-12-10"
    assert payload["publishedAt"] == "2026-11-12"
    assert payload["noticeType"] == "RFQ"
    assert payload["procedureType"] == "Request for Quotation"
    assert payload["summary"] == "Studies for the public realm."
    assert payload["category"] == "Management and Business Professionals - Consulting"
    assert payload["estimatedValueText"] == "AED 1,000 - 2,000"
    assert payload["country"] == "United Arab Emirates"
    assert payload["location"] == "Abu Dhabi"
    assert payload["rawNoticeHtml"] == ""
    assert payload["rawNotice"]["list"]["TenderID"] == 1442429

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.title == "DMT-RFP-26-131 Bus Bays Enhancement"
    assert record.official_url == PAGE + "1442429"
    assert record.deadline_at == date(2026, 12, 10)


def test_zero_value_placeholder_and_unprefixed_arabic_titles() -> None:
    row = _row(5, name="أعمال مهرجان سوق الظفرة", details="")

    [document] = FakeGate([row]).run()
    payload = json.loads(document.payload)

    assert payload["title"] == "أعمال مهرجان سوق الظفرة"
    assert payload["noticeType"] == "RFQ"  # from the detail's EventType
    assert payload["estimatedValueText"] is None
    assert payload["summary"] is None
