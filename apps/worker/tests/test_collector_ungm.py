from __future__ import annotations

import json
import logging
from datetime import date
from pathlib import Path
from typing import Any

import pytest
from http_fakes import Reply, make_client
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import ungm
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.collectors.ungm import (
    MAX_PAGES,
    PAGE_PAUSE_SECONDS,
    PAGE_SIZE,
    collect_ungm_documents,
    make_default_fetch_search,
    parse_notice_rows,
)
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice
from arch_competition_ops.http import HttpStatusError, set_default_client

NOTICE_PAGE = "https://www.ungm.org/Public/Notice/"
FIXTURE = Path(__file__).parent / "fixtures" / "ungm-search-fragment.html"
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _source():
    return _build_source(
        "ungm_public_notices",
        name="UN Global Marketplace Procurement Notices",
        jurisdiction="global",
        base_url="https://www.ungm.org/Public/Notice",
        scan_method="html",
        extractor="generic_listing_html",
        collector="ungm_notice_search",
        regions=["global"],
        languages=["en", "fr", "es"],
    )


def _day(day: date) -> str:
    return f"{day.day:02d}-{MONTHS[day.month - 1]}-{day.year}"


def _row(notice_id: int, published: date, *, title: str = "Rehabilitation of a school") -> str:
    """One ``role="row"`` block in the live shape, reduced to the markup the parser reads."""
    return f"""
<div role="row" tabindex="0" data-noticeid="{notice_id}" class="tableRow dataRow notice-table">
  <div role="cell" class="tableCell editable intendbuttonsHeader resultOptions">
    <div class="ungm-flex-row"><span class='info-tooltip'>Subscribe to UNGM Pro</span>
      <div class="table-cell-eoi"><input type="button" value='Express Interest' /></div></div>
  </div>
  <div role="cell" class="tableCell resultTitle">
    <div class="ungm-flex-row"><div class="ungm-flex-row">
      <span class="ungm-title ungm-title--small">{title}</span></div>
      <a target='_blank' href='/Public/Notice/{notice_id}'><svg><title>Open in a new window</title></svg></a>
    </div>
  </div>
  <div role="cell" class="tableCell resultInfo1 deadline">
    <span>{_day(date(2026, 12, 1))} 13:00 (GMT 3.00)</span>
    <span class="remainingDaysToDeadline" style="display:none">12.5</span>
  </div>
  <div role="cell" class="tableCell"><span>{_day(published)}</span></div>
  <div role="cell" class="tableCell resultAgency"><span>UNDP</span></div>
  <div role="cell" class="tableCell"><span><label>Request for proposal</label></span></div>
  <div role="cell" class="tableCell resultInfo1"><span>REF-{notice_id}</span></div>
  <div role="cell" class="tableCell"><span>Jordan</span></div>
</div>
<script>var deadlineCells = document.querySelectorAll('.tableCell');</script>
"""


class FakeSearch:
    """Serves ``rows`` (newest first) fifteen at a time by ``PageIndex``; records each body."""

    def __init__(self, rows: list[str]) -> None:
        self.rows = rows
        self.bodies: list[dict[str, Any]] = []

    def __call__(self, body: dict[str, Any]) -> str:
        self.bodies.append(body)
        start = body["PageIndex"] * PAGE_SIZE
        return "\n".join(self.rows[start : start + PAGE_SIZE])

    def pages(self) -> list[int]:
        return [body["PageIndex"] for body in self.bodies]


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def test_ungm_family_is_registered() -> None:
    assert COLLECTORS["ungm_notice_search"] is ungm.collect_ungm_documents


def test_parses_the_live_fragment_rows() -> None:
    row_count, notices = parse_notice_rows(FIXTURE.read_text(encoding="utf-8"))

    assert row_count == 3
    assert [notice["noticeId"] for notice in notices] == ["322612", "322608", "322591"]
    first = notices[0]
    assert (
        first["title"] == "Provision of Hepatitis B Vaccine (For Local Jordanian Suppliers – ONLY)"
    )
    assert first["deadline"] == "2026-11-19"
    assert first["publishedAt"] == "2026-11-15"
    assert first["agency"] == "UNRWA"
    assert first["noticeType"] == "Request for quotation"
    assert first["reference"] == "RFQG 3126001168 (YB)"
    assert first["country"] == "Jordan"
    # Character references decode and the icon's "Open in a new window" text is not content.
    assert notices[1]["title"].endswith("Café located UNOCA Compound, Kabul, Afghanistan")
    assert all("Open in a new window" not in str(notice) for notice in notices)


def test_a_row_without_the_eight_columns_is_dropped_but_counted() -> None:
    broken = '<div role="row" data-noticeid="9"><div role="cell">x</div></div>'

    row_count, notices = parse_notice_rows(broken + _row(1, date(2026, 11, 14)))

    assert row_count == 2
    assert [notice["noticeId"] for notice in notices] == ["1"]


def test_search_body_asks_for_open_design_scope_notices_newest_first() -> None:
    api = FakeSearch([])
    collect_ungm_documents(_source(), fetch_search=api)

    body = api.bodies[0]
    assert body["PageIndex"] == 0
    assert body["PageSize"] == 15
    assert body["PublishedFrom"] == "08-Nov-2026"  # seven days before the pinned today
    assert body["UNSPSCs"] == []
    assert (body["SortField"], body["SortAscending"]) == ("DatePublished", False)
    assert body["IsActive"] is False


def test_explicit_window_start_is_sent_as_the_page_date_format() -> None:
    api = FakeSearch([])
    collect_ungm_documents(_source(), publication_date_from="2026-10-03", fetch_search=api)

    assert api.bodies[0]["PublishedFrom"] == "03-Oct-2026"


def test_pages_until_a_short_page_and_gives_every_notice_its_own_url() -> None:
    rows = [_row(1000 + index, date(2026, 11, 14)) for index in range(40)]
    api = FakeSearch(rows)

    documents = collect_ungm_documents(_source(), limit=10_000, fetch_search=api)

    assert len(documents) == 40
    assert api.pages() == [0, 1, 2]
    urls = [document.source_url for document in documents]
    assert urls[0] == f"{NOTICE_PAGE}1000"
    assert len(set(urls)) == 40


def test_stops_at_the_first_notice_older_than_the_window() -> None:
    rows = [_row(1, date(2026, 11, 14)), _row(2, date(2026, 11, 8)), _row(3, date(2026, 11, 7))]
    rows += [_row(4 + index, date(2026, 11, 6)) for index in range(40)]
    api = FakeSearch(rows)

    documents = collect_ungm_documents(_source(), limit=100, fetch_search=api)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["1", "2"]
    assert api.pages() == [0]


def test_page_cap_stops_paging_and_logs_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    api = FakeSearch([_row(index, date(2026, 11, 14)) for index in range(PAGE_SIZE * 80)])

    with caplog.at_level(logging.WARNING, logger=ungm.logger.name):
        documents = collect_ungm_documents(_source(), limit=100_000, fetch_search=api)

    assert api.pages() == list(range(MAX_PAGES))
    assert len(documents) == MAX_PAGES * PAGE_SIZE
    assert "stopped after 40 pages" in caplog.text


def test_returns_at_most_limit_documents_and_stops_paging() -> None:
    api = FakeSearch([_row(index, date(2026, 11, 14)) for index in range(100)])

    documents = collect_ungm_documents(_source(), limit=20, fetch_search=api)

    assert len(documents) == 20
    assert api.pages() == [0, 1]


def test_a_notice_that_moves_between_pages_is_kept_once() -> None:
    rows = [_row(index, date(2026, 11, 14)) for index in range(PAGE_SIZE + 3)]
    pages = [
        "\n".join(rows[:PAGE_SIZE]),
        # A new notice pushed the last one of page 0 onto page 1.
        "\n".join(rows[PAGE_SIZE - 1 :]),
    ]

    documents = collect_ungm_documents(
        _source(),
        limit=100,
        fetch_search=lambda body: pages[body["PageIndex"]],
    )

    assert [d.source_url for d in documents] == [f"{NOTICE_PAGE}{i}" for i in range(PAGE_SIZE + 3)]


def test_design_and_supply_notices_are_both_collected() -> None:
    rows = [
        _row(
            2, date(2026, 11, 14), title="Architectural design and supervision of school buildings"
        ),
        _row(1, date(2026, 11, 14), title="Supply of vaccines"),
    ]

    ai_documents = collect_ungm_documents(_source(), limit=10, fetch_search=FakeSearch(rows))

    assert [d.source_url for d in ai_documents] == [f"{NOTICE_PAGE}2", f"{NOTICE_PAGE}1"]


def test_payload_carries_explicit_facts_and_leaves_the_server_rendered_page_to_enrichment() -> None:
    fragment = FIXTURE.read_text(encoding="utf-8")

    [document, *_] = collect_ungm_documents(
        _source(),
        limit=5,
        publication_date_from="2026-11-01",
        fetch_search=lambda body: fragment,
    )
    payload = json.loads(document.payload)

    assert document.source_url == f"{NOTICE_PAGE}322612"
    assert payload["officialUrl"] == f"{NOTICE_PAGE}322612"
    assert payload["buyer"] == "UNRWA"
    assert payload["deadline"] == "2026-11-19"
    assert payload["publishedAt"] == "2026-11-15"
    assert payload["country"] == payload["location"] == "Jordan"
    assert payload["noticeType"] == "Request for quotation"
    assert payload["rawNotice"]["reference"] == "RFQG 3126001168 (YB)"
    # The notice page is server rendered with the description: no empty ``rawNoticeHtml``.
    assert "rawNoticeHtml" not in payload

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == f"{NOTICE_PAGE}322612"
    assert record.deadline_at == date(2026, 11, 19)
    assert record.location_label == "Jordan"


def test_an_error_after_the_first_page_keeps_what_was_read() -> None:
    rows = [_row(index, date(2026, 11, 14)) for index in range(PAGE_SIZE)]

    def fetch(body: dict[str, Any]) -> str:
        if body["PageIndex"] == 0:
            return "\n".join(rows)
        raise HttpStatusError("boom", url="https://www.ungm.org", status_code=500)

    documents = collect_ungm_documents(_source(), limit=100, fetch_search=fetch)

    assert len(documents) == PAGE_SIZE


def test_an_error_on_the_first_page_is_raised() -> None:
    def fetch(body: dict[str, Any]) -> str:
        raise HttpStatusError("boom", url="https://www.ungm.org", status_code=500)

    with pytest.raises(HttpStatusError):
        collect_ungm_documents(_source(), fetch_search=fetch)


def _script(search_replies: list[Reply], seen: list[Any]):
    replies = iter(search_replies)

    def respond(request):
        seen.append(request)
        if request.method == "GET":
            return Reply(
                200,
                b'<input name="__RequestVerificationToken" type="hidden" value="first" />'
                b'<input name="__RequestVerificationToken" type="hidden" value="second" />',
            )
        return next(replies)

    return respond


def test_default_fetcher_sends_the_page_token_and_paces_the_pages() -> None:
    seen: list[Any] = []
    client, _, _ = make_client(_script([Reply(200, b"<p>a</p>"), Reply(200, b"<p>b</p>")], seen))
    set_default_client(client)
    sleeps: list[float] = []

    fetch = make_default_fetch_search(sleep=sleeps.append)
    first = fetch({"PageIndex": 0})
    second = fetch({"PageIndex": 1})

    assert (first, second) == ("<p>a</p>", "<p>b</p>")
    assert [request.method for request in seen] == ["GET", "POST", "POST"]  # token read once
    assert seen[0].url == "https://www.ungm.org/Public/Notice"
    assert seen[1].url == "https://www.ungm.org/Public/Notice/Search"
    assert seen[1].headers["RequestVerificationToken"] == "second"
    assert json.loads(seen[2].body) == {"PageIndex": 1}
    assert sleeps == [PAGE_PAUSE_SECONDS]  # no pause before the first search


def test_default_fetcher_waits_out_a_throttled_page_then_continues() -> None:
    seen: list[Any] = []
    replies = [Reply(429, headers={"Retry-After": "90"}), Reply(200, b"<p>ok</p>")]
    client, _, _ = make_client(_script(replies, seen))
    set_default_client(client)
    sleeps: list[float] = []

    result = make_default_fetch_search(sleep=sleeps.append)({"PageIndex": 0})

    assert result == "<p>ok</p>"
    assert sleeps == [90.0]  # the larger of the server's Retry-After and the 20 s minimum


def test_default_fetcher_gives_up_after_a_bounded_number_of_throttled_attempts() -> None:
    seen: list[Any] = []
    client, _, _ = make_client(_script([Reply(429)] * 5, seen))
    set_default_client(client)
    sleeps: list[float] = []

    with pytest.raises(HttpStatusError) as caught:
        make_default_fetch_search(sleep=sleeps.append)({"PageIndex": 0})

    assert caught.value.status_code == 429
    assert sleeps == [20.0, 60.0]
    assert [request.method for request in seen] == ["GET", "POST", "POST", "POST"]
