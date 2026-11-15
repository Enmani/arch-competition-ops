from __future__ import annotations

import json
from datetime import date

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import ashghal
from arch_competition_ops.collectors.ashghal import collect_ashghal_documents
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice
from arch_competition_ops.http import HttpStatusError

SITE = "https://www.ashghal.gov.qa"
OPEN_LIST = SITE + "/en/Tenders/pages/erPTenders.aspx"
EOI_LIST = SITE + "/en/Tenders/pages/PreqShowAll.aspx?Status=Open&Type=EOI"
PQ_LIST = SITE + "/en/Tenders/pages/PreqShowAll.aspx?Status=Open&Type=PQ"


def _source():
    return _build_source(
        "qa_ashghal_open_tenders",
        name="Ashghal (Public Works Authority) Open Tenders",
        jurisdiction="qatar",
        base_url=OPEN_LIST,
        scan_method="api",
        extractor="generic_listing_html",
        collector="ashghal_open_tenders",
        regions=["middle_east", "qatar"],
        languages=["en"],
    )


def _row(
    tender_id: int,
    issued: str = "12 November 2026",
    closing: str = "13 December 2026",
    *,
    title: str = "Supervision Consultancy Services for Roads",
    status: str = "Open",
) -> str:
    return (
        '<tr class="grid-row" style="white-space:nowrap;"><td><span>'
        f'<a href="/en/Tenders/Pages/ERPTenderDetailes.aspx?TenderID={tender_id}&Status={status}">'
        f"PWA/STC/{tender_id}/2026</a></span></td><td><span>STC</span></td>"
        f"<td><span>{title}</span></td><td><span>{issued}</span></td>"
        f"<td><span>{closing}</span></td><td><span></span></td></tr>"
    )


def _detail(title: str = "Professional Services Contract for Supervision of Roads") -> str:
    return (
        "<html><body><div>Tender Print Email PC Consultancy Services Tender Number PWA/STC/1/2026 "
        "Tender Type STC Brief Description: Tender Details: "
        f"{title} - Project ID: BP 2026 Refer to Tender Project Brief for further details "
        "Document Fees 1,000 Q.R. Contact Details Engineering Services Department</div>"
        "<script>var x = 1;</script></body></html>"
    )


class FakeSite:
    def __init__(self, open_rows: list[str], eoi_rows=(), pq_rows=()) -> None:
        self.lists = {OPEN_LIST: open_rows, EOI_LIST: list(eoi_rows), PQ_LIST: list(pq_rows)}
        self.requests: list[str] = []
        self.broken: set[str] = set()

    def __call__(self, url: str) -> str:
        self.requests.append(url)
        if url in self.lists:
            return "<table>" + "".join(self.lists[url]) + "</table>"
        if url in self.broken:
            raise HttpStatusError("Unexpected HTTP status 500", url=url, status_code=500)
        return _detail()

    def detail_requests(self) -> list[str]:
        return [u for u in self.requests if u not in self.lists]


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def _collect(site, **kwargs):
    kwargs.setdefault("include_unclassified", True)
    kwargs.setdefault("limit", 1000)
    return collect_ashghal_documents(_source(), fetch_text=site, **kwargs)


def test_family_is_registered() -> None:
    assert COLLECTORS["ashghal_open_tenders"] is collect_ashghal_documents


def test_reads_the_open_tender_eoi_and_prequalification_lists() -> None:
    site = FakeSite([_row(1)], [_row(2)], [_row(3)])

    documents = _collect(site)

    assert [site.requests[i] for i in range(3)] == [OPEN_LIST, EOI_LIST, PQ_LIST]
    assert {json.loads(d.payload)["procedureType"] for d in documents} == {
        "Tender",
        "Expression of interest",
        "Prequalification",
    }


def test_only_open_rows_in_the_window_that_have_not_closed_are_kept() -> None:
    site = FakeSite(
        [
            _row(1),
            _row(2, status="Closed"),
            _row(3, issued="22 October 2026"),
            _row(4, closing="10 November 2026"),
            _row(5, issued="soon"),
        ]
    )

    documents = _collect(site)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["PWA/STC/1/2026"]


def test_a_longer_window_reads_older_issue_dates() -> None:
    site = FakeSite([_row(1), _row(3, issued="22 October 2026")])

    documents = _collect(site, publication_date_from="2026-10-01")

    assert len(documents) == 2


def test_each_tender_has_its_own_public_page_and_limit_picks_the_newest() -> None:
    site = FakeSite(
        [_row(1, "10 November 2026"), _row(2, "14 November 2026"), _row(3, "12 November 2026")]
    )

    documents = _collect(site, limit=2)

    assert [d.source_url for d in documents] == [
        SITE + "/en/Tenders/Pages/ERPTenderDetailes.aspx?TenderID=2&Status=Open",
        SITE + "/en/Tenders/Pages/ERPTenderDetailes.aspx?TenderID=3&Status=Open",
    ]
    assert site.detail_requests() == [d.source_url for d in documents]
    assert _collect(site, limit=0) == []


def test_plain_mode_needs_the_design_relevance_gate() -> None:
    site = FakeSite(
        [
            _row(1, title="Architectural design of a pavilion"),
            _row(2, title="Supply of pumps"),
        ]
    )

    documents = _collect(site, include_unclassified=False)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["PWA/STC/1/2026"]
    assert "rawNotice" not in json.loads(documents[0].payload)


def test_payload_takes_the_full_title_from_the_detail_page() -> None:
    site = FakeSite([_row(1, closing="13 December 2026")])

    [document] = _collect(site)
    payload = json.loads(document.payload)

    assert payload["title"] == "Professional Services Contract for Supervision of Roads"
    assert payload["buyer"] == "Public Works Authority (Ashghal)"
    assert payload["deadline"] == "2026-12-13"
    assert payload["publishedAt"] == "2026-11-12"
    assert payload["tenderType"] == "STC"
    assert payload["country"] == "Qatar"
    assert payload["rawNotice"]["title"] == "Supervision Consultancy Services for Roads"
    assert payload["rawNoticeHtml"].startswith("PC Consultancy Services")
    assert "var x" not in payload["rawNoticeHtml"]
    assert "Contact Details" not in payload["rawNoticeHtml"]

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == document.source_url
    assert record.deadline_at == date(2026, 12, 13)


def test_a_detail_page_that_fails_keeps_the_row_with_the_list_title() -> None:
    site = FakeSite([_row(1)])
    site.broken.add(SITE + "/en/Tenders/Pages/ERPTenderDetailes.aspx?TenderID=1&Status=Open")

    [document] = _collect(site)
    payload = json.loads(document.payload)

    assert payload["title"] == "Supervision Consultancy Services for Roads"
    assert payload["rawNoticeHtml"] == ""
    assert ashghal.DETAIL_CHARS > 0
