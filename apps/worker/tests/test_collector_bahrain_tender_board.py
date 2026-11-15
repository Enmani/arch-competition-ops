from __future__ import annotations

import json
import logging
from datetime import date
from urllib import parse

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import bahrain_tender_board as bahrain
from arch_competition_ops.collectors.bahrain_tender_board import (
    collect_bahrain_tender_board_documents,
)
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice
from arch_competition_ops.http import HttpStatusError


def _source():
    return _build_source(
        "bh_tender_board_published_tenders",
        name="Bahrain Tender Board Published Tenders",
        jurisdiction="bahrain",
        base_url="https://www.tenderboard.gov.bh/Tenders/PublicTenders/",
        scan_method="api",
        extractor="generic_listing_html",
        collector="bahrain_tender_board_published",
        regions=["middle_east", "bahrain"],
        languages=["en", "ar"],
    )


def _row(
    number: str,
    published: str,
    closing: str = "27 Dec,2026",
    *,
    title: str = "Design of a new clinic",
    prequalification: bool = False,
) -> str:
    flag = "<img src='/images/pre-qualification.png' class='prequalification' />"
    return (
        "<div data-type='External'  data-index='1' data-status='1' class=\"rows\">"
        '<div class="column" data-label="index">1</div>'
        '<div class="column" data-label="No./Tender Subject">'
        f'<a href="/TenderDetails/?id=558%2f2026%2fBTB+({number})"><span>'
        f"<img src='/images/new.png' />{flag if prequalification else ''}{number}</span>"
        f"{title}</a></div>"
        '<div class="column" data-label="Tender Type"><span title="x">External</span></div>'
        '<div class="column" data-label="Purchasing Authority">Ministry of Works</div>'
        f'<div class="column" data-label="Publish Date">{published}</div>'
        '<div class="column" data-label="Purchase Before"><span>29, Dec,2026</span></div>'
        f'<div class="column" data-label="Closing Date"><span>{closing}</span></div></div>'
    )


def _detail(cpv: str | None, description: str = "Consultancy for the design of a clinic.") -> str:
    classification = f"--&gt; {cpv} - Architectural services" if cpv else "--&gt;"
    return (
        "<html><body><h1>Tender Details</h1><p>Tender Description</p>"
        f"<p>{description}</p><p>Issued by Ministry of Works</p>"
        f"<p>Classification/CPV Codes {classification}</p><p>Initial Bond Not Applicable</p>"
        "<script>var x = 1;</script></body></html>"
    )


class FakeBoard:
    """Ten rows a page like the real list; ``details`` maps a tender number to its detail page."""

    def __init__(self, rows: list[str], details: dict[str, str | Exception] | None = None) -> None:
        self.rows = rows
        self.details = details or {}
        self.calls: list[tuple[str, dict]] = []
        self.detail_urls: list[str] = []

    def post_json(self, method: str, payload: dict[str, str]) -> dict:
        self.calls.append((method, payload))
        if method == "GetCurrentPublicTenderPageCount":
            return {"d": -(-len(self.rows) // 10)}
        page = int(payload["Page"])
        return {
            "d": "<div class='table-head'></div>" + "".join(self.rows[(page - 1) * 10 : page * 10])
        }

    def fetch_text(self, url: str) -> str:
        self.detail_urls.append(url)
        number = parse.unquote_plus(url).rsplit("(", 1)[1].rstrip(")")
        detail = self.details.get(number, _detail("71000000-8"))
        if isinstance(detail, Exception):
            raise detail
        return detail

    def pages(self) -> list[int]:
        return [int(p["Page"]) for m, p in self.calls if m == "GetCurrentPublicTenderByPage"]


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def _collect(board: FakeBoard, **kwargs):
    kwargs.setdefault("include_unclassified", True)
    kwargs.setdefault("limit", 1000)
    return collect_bahrain_tender_board_documents(
        _source(), post_json=board.post_json, fetch_text=board.fetch_text, **kwargs
    )


def test_family_is_registered() -> None:
    assert COLLECTORS["bahrain_tender_board_published"] is collect_bahrain_tender_board_documents


def test_asks_the_page_count_then_pages_with_the_pages_own_filters() -> None:
    board = FakeBoard([_row(f"T{i}", "14, Nov,2026") for i in range(25)])

    documents = _collect(board)

    method, payload = board.calls[0]
    assert method == "GetCurrentPublicTenderPageCount"
    assert payload["Page"] == "-1"
    assert payload["publicTenderOnly"] == "true"
    assert payload["sortingType"] == "0"
    assert board.pages() == [1, 2, 3]
    assert len(documents) == 25


def test_stops_after_a_page_that_is_entirely_older_than_the_window() -> None:
    rows = [_row(f"A{i}", "14, Nov,2026") for i in range(10)]
    rows += [_row(f"B{i}", "01, Oct,2026") for i in range(10)]
    rows += [_row(f"C{i}", "01, Sep,2026") for i in range(10)]
    board = FakeBoard(rows)

    documents = _collect(board)

    assert len(documents) == 10
    assert board.pages() == [1, 2]
    assert len(board.detail_urls) == 10


def test_page_cap_limits_a_long_list_with_a_warning(caplog) -> None:
    board = FakeBoard([_row(f"T{i}", "14, Nov,2026") for i in range(10 * (bahrain.MAX_PAGES + 5))])

    with caplog.at_level(logging.WARNING, logger=bahrain.logger.name):
        documents = _collect(board)

    assert board.pages() == list(range(1, bahrain.MAX_PAGES + 1))
    assert len(documents) == 10 * bahrain.MAX_PAGES
    assert "only the first" in caplog.text


def test_skips_closed_and_undated_tenders_without_reading_their_detail() -> None:
    board = FakeBoard(
        [
            _row("OPEN", "14, Nov,2026"),
            _row("SHUT", "14, Nov,2026", closing="10 Nov,2026"),
            _row("NODATE", "soon"),
        ]
    )

    documents = _collect(board)

    assert [json.loads(d.payload)["tenderNumber"] for d in documents] == ["OPEN"]
    assert len(board.detail_urls) == 1


def test_cpv_scope_in_ai_mode() -> None:
    board = FakeBoard(
        [
            _row("DESIGN", "14, Nov,2026", title="Supply of cables"),
            _row("NOCPV", "14, Nov,2026"),
            _row("SUPPLY", "14, Nov,2026"),
            _row("WORKS", "14, Nov,2026", title="Road maintenance"),
            _row("DB", "14, Nov,2026", title="Design and build of a school"),
            _row("FAIL", "14, Nov,2026"),
        ],
        {
            "DESIGN": _detail("71000000-8"),
            "NOCPV": _detail(None),
            "SUPPLY": _detail("30000000-9"),
            "WORKS": _detail("45000000-7"),
            "DB": _detail("45000000-7"),
            "FAIL": HttpStatusError("Unexpected HTTP status 500", url="u", status_code=500),
        },
    )

    documents = _collect(board)

    assert sorted(json.loads(d.payload)["tenderNumber"] for d in documents) == [
        "DB",
        "DESIGN",
        "FAIL",
        "NOCPV",
    ]


def test_plain_mode_needs_a_cpv_code_and_design_relevance() -> None:
    board = FakeBoard(
        [
            _row("DESIGN", "14, Nov,2026", title="Architectural design of a clinic"),
            _row("NOCPV", "14, Nov,2026", title="Architectural design of a clinic"),
            _row("SUPPLY", "14, Nov,2026", title="Supply of cables"),
        ],
        {
            "DESIGN": _detail("71000000-8"),
            "NOCPV": _detail(None),
            "SUPPLY": _detail("30000000-9"),
        },
    )

    documents = _collect(board, include_unclassified=False)

    assert [json.loads(d.payload)["tenderNumber"] for d in documents] == ["DESIGN"]
    assert "rawNotice" not in json.loads(documents[0].payload)


def test_limit_stops_paging_and_detail_reads() -> None:
    board = FakeBoard([_row(f"T{i}", "14, Nov,2026") for i in range(40)])

    documents = _collect(board, limit=12)

    assert len(documents) == 12
    assert board.pages() == [1, 2]
    assert len(board.detail_urls) == 12


def test_every_tender_has_its_own_page_written_as_the_list_writes_it() -> None:
    board = FakeBoard([_row("A1", "14, Nov,2026"), _row("A2", "13, Nov,2026")])

    documents = _collect(board)

    assert [d.source_url for d in documents] == [
        "https://www.tenderboard.gov.bh/TenderDetails/?id=558%2f2026%2fBTB+(A1)",
        "https://www.tenderboard.gov.bh/TenderDetails/?id=558%2f2026%2fBTB+(A2)",
    ]
    assert board.detail_urls == [d.source_url for d in documents]


def test_payload_carries_explicit_facts() -> None:
    board = FakeBoard(
        [_row("BE1", "14, Nov,2026", "27 Dec,2026", prequalification=True)],
        {"BE1": _detail("71000000-8", "Prequalify consultants for design.")},
    )

    [document] = _collect(board)
    payload = json.loads(document.payload)

    assert payload["title"] == "Design of a new clinic"
    assert payload["buyer"] == "Ministry of Works"
    assert payload["tenderNumber"] == "BE1"
    assert payload["noticeId"] == "558/2026/BTB (BE1)"
    assert payload["deadline"] == "2026-12-27"
    assert payload["publishedAt"] == "2026-11-14"
    assert payload["cpv"] == ["71000000"]
    assert payload["procedureType"] == "Pre-qualification"
    assert payload["summary"] == "Prequalify consultants for design."
    assert payload["rawNoticeHtml"] == "Prequalify consultants for design."
    assert payload["country"] == "Bahrain"
    assert "var x" not in json.dumps(payload)

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.deadline_at == date(2026, 12, 27)
    assert record.cpv_codes == ["71000000"]
