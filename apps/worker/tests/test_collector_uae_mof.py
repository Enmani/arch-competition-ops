from __future__ import annotations

import json
import logging
from datetime import date

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import uae_mof
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.collectors.uae_mof import collect_uae_mof_documents
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice

LINK = "https://procurement.gov.ae/page.aspx/en/bpm/process_manage_extranet/"


def _source():
    return _build_source(
        "uae_mof_federal_tenders",
        name="UAE Ministry of Finance Federal Tenders",
        jurisdiction="united_arab_emirates",
        base_url="https://mof.gov.ae/en/public-finance/government-procurement/current-business-opportunities/",
        scan_method="api",
        extractor="generic_listing_html",
        collector="mof_dpp_ajax_list",
        regions=["middle_east", "united_arab_emirates"],
        languages=["en", "ar"],
    )


def _tender(
    rfq: str,
    opened: str,
    *,
    title: str = "Comprehensive Maintenance of MEP Assets",
    entity: str = "Ministry of Energy and Infrastructure - (102/44069)",
    closes: str = "07/12/2026 12:00:00 PM",
    description: str | None = None,
    link: str | None = "",
) -> dict:
    href = LINK + rfq if link == "" else link
    return {
        "rfq": rfq,
        "opened": f"{opened} 9:00:00 AM",
        "title": title,
        "entity": entity,
        "closes": closes,
        "description": description or title,
        "link": href,
    }


def _fragment(tenders: list[dict]) -> str:
    """The HTML fragment the Ministry's ajax endpoint answers with (list view only)."""
    blocks = []
    for item in tenders:
        link = (
            f'<a class="text-secondary-600 hover:underline" href="{item["link"]}" '
            'target="_blank">Click here</a>'
            if item["link"]
            else ""
        )
        blocks.append(
            f"""
				<div class="mof-dpp-list__item">
					<div class="mof-dpp-list__item__main">
						<div class="mof-dpp-list__item__info">
							<p class="mof-dpp-list__item__title text-left">{item["title"]}</p>
							<p class="">{item["rfq"]}</p>
							<span class="mof-button">{item["entity"]}</span>
						</div>
					</div>
					<ul class="mof-dpp-list__item__expand">
						<li>{item["description"]}</li>
						<li class="mof-dpp-list__item__expand__item">
							<span class="mof-dpp-list__item__expand__title">Open Date</span>
							<span>{item["opened"]}</span>
						</li>
						<li class="mof-dpp-list__item__expand__item">
							<span class="mof-dpp-list__item__expand__title">Close Date</span>
							<span>{item["closes"]}</span>
						</li>
						<li class="mof-dpp-list__item__expand__item">
							<span class="mof-dpp-list__item__expand__title">Link</span>
							{link}
						</li>
					</ul>
				</div>"""
        )
    return (
        '<div class="mof-dpp-list">'
        + "".join(blocks)
        + '</div><div class="mof-dpp-pagination"><a data-page="2">2</a></div>'
    )


class FakeMinistry:
    """Serves ``tenders`` (newest first) nine to a page; a page past the end is empty."""

    def __init__(self, tenders: list[dict], page_size: int = 9) -> None:
        self.tenders = tenders
        self.page_size = page_size
        self.pages: list[int] = []

    def __call__(self, page: int) -> str:
        self.pages.append(page)
        start = (page - 1) * self.page_size
        return _fragment(self.tenders[start : start + self.page_size])


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def test_family_is_registered() -> None:
    assert COLLECTORS["mof_dpp_ajax_list"] is collect_uae_mof_documents


def test_pages_until_the_list_ends_and_every_notice_has_its_own_url() -> None:
    tenders = [_tender(f"{13000 + index}", "14/11/2026") for index in range(20)]
    api = FakeMinistry(tenders)

    documents = collect_uae_mof_documents(
        _source(), limit=1000, include_unclassified=True, fetch_page=api
    )

    assert len(documents) == 20
    assert api.pages == [1, 2, 3, 4]  # the empty fourth page ends the read
    urls = [document.source_url for document in documents]
    assert len(set(urls)) == 20
    assert urls[0] == LINK + "13000"
    assert urls[-1] == LINK + "13019"


def test_default_window_is_seven_days_and_stops_at_the_first_older_tender() -> None:
    tenders = [
        _tender("13003", "14/11/2026"),
        _tender("13002", "08/11/2026"),
        _tender("13001", "07/11/2026"),
        _tender("13000", "01/11/2026"),
    ]
    api = FakeMinistry(tenders, page_size=2)

    documents = collect_uae_mof_documents(
        _source(), limit=100, include_unclassified=True, fetch_page=api
    )

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["13003", "13002"]
    assert api.pages == [1, 2]  # page 2 holds the first older tender; no page 3 is read


def test_explicit_window_start_overrides_the_default() -> None:
    tenders = [_tender("13001", "14/11/2026"), _tender("13000", "10/11/2026")]

    documents = collect_uae_mof_documents(
        _source(),
        limit=100,
        publication_date_from="2026-11-12",
        include_unclassified=True,
        fetch_page=FakeMinistry(tenders),
    )

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["13001"]


def test_page_cap_stops_a_list_that_never_ends_and_logs_a_warning(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    monkeypatch.setattr(uae_mof, "MAX_PAGES", 3)
    calls: list[int] = []

    def endless(page: int) -> str:
        calls.append(page)
        return _fragment([_tender(f"{page}{index}", "14/11/2026") for index in range(9)])

    with caplog.at_level(logging.WARNING, logger=uae_mof.logger.name):
        documents = collect_uae_mof_documents(
            _source(), limit=10_000, include_unclassified=True, fetch_page=endless
        )

    assert calls == [1, 2, 3]
    assert len(documents) == 27
    assert "page cap" in caplog.text


def test_limit_stops_the_read_early() -> None:
    api = FakeMinistry([_tender(f"{13000 + index}", "14/11/2026") for index in range(30)])

    documents = collect_uae_mof_documents(
        _source(), limit=5, include_unclassified=True, fetch_page=api
    )

    assert len(documents) == 5
    assert api.pages == [1]


def test_drops_closed_duplicate_and_linkless_tenders() -> None:
    api = FakeMinistry(
        [
            _tender("13005", "14/11/2026"),
            _tender("13004", "14/11/2026", closes="14/11/2026 12:00:00 PM"),
            _tender("13005", "14/11/2026"),
            _tender("13003", "14/11/2026", link=None),
            _tender("13002", "14/11/2026", closes="15/11/2026 12:00:00 PM"),
        ]
    )

    documents = collect_uae_mof_documents(
        _source(), limit=100, include_unclassified=True, fetch_page=api
    )

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["13005", "13002"]


def test_ai_mode_keeps_every_open_tender_and_the_gate_applies_otherwise() -> None:
    tenders = [
        _tender("13002", "14/11/2026", title="Architectural design of the ministry annex"),
        _tender("13001", "14/11/2026", title="Supply of gym equipment"),
    ]

    everything = collect_uae_mof_documents(
        _source(), limit=100, include_unclassified=True, fetch_page=FakeMinistry(tenders)
    )
    gated = collect_uae_mof_documents(_source(), limit=100, fetch_page=FakeMinistry(tenders))

    assert [json.loads(d.payload)["noticeId"] for d in everything] == ["13002", "13001"]
    assert [json.loads(d.payload)["noticeId"] for d in gated] == ["13002"]
    assert "rawNotice" not in json.loads(gated[0].payload)


def test_payload_carries_explicit_facts_and_the_notice_link() -> None:
    api = FakeMinistry(
        [
            _tender(
                "13094",
                "12/11/2026",
                title="Comprehensive Landscaping Maintenance &amp; Management",
                entity="Ministry of Family - (145/58031/60520)",
                description="Landscaping for the ministry campus.",
            )
        ]
    )

    [document] = collect_uae_mof_documents(
        _source(), limit=5, include_unclassified=True, fetch_page=api
    )
    payload = json.loads(document.payload)

    assert document.source_url == LINK + "13094"
    assert payload["officialUrl"] == LINK + "13094"
    assert payload["title"] == "Comprehensive Landscaping Maintenance & Management"
    assert payload["buyer"] == "Ministry of Family"
    assert payload["noticeId"] == "13094"
    assert payload["deadline"] == "2026-12-07"
    assert payload["publishedAt"] == "2026-11-12"
    assert payload["summary"] == "Landscaping for the ministry campus."
    assert payload["country"] == "United Arab Emirates"
    assert payload["rawNoticeHtml"] == ""
    assert payload["rawNotice"]["rfq"] == "13094"

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.title == "Comprehensive Landscaping Maintenance & Management"
    assert record.official_url == LINK + "13094"
    assert record.deadline_at == date(2026, 12, 7)


def test_summary_is_empty_when_the_description_only_repeats_the_title() -> None:
    api = FakeMinistry([_tender("13001", "14/11/2026")])

    [document] = collect_uae_mof_documents(
        _source(), limit=5, include_unclassified=True, fetch_page=api
    )

    assert json.loads(document.payload)["summary"] is None
