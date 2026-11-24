from __future__ import annotations

import json
import logging
import zlib
from datetime import date
from pathlib import Path
from urllib import parse

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import isdb
from arch_competition_ops.collectors.isdb import (
    MAX_PAGES,
    collect_isdb_documents,
    parse_tender_list,
)
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice

SITE = "https://www.isdb.org"
FIXTURE = Path(__file__).parent / "fixtures" / "isdb-tenders-list.html"


def _source():
    return _build_source(
        "isdb_project_tenders",
        name="Islamic Development Bank Project Tenders",
        jurisdiction="global",
        base_url="https://www.isdb.org/project-procurement/tenders",
        scan_method="html",
        extractor="generic_listing_html",
        collector="isdb_tender_list",
        regions=["global"],
        languages=["en", "fr", "ar"],
    )


def _article(
    slug: str,
    *,
    title: str = "Architectural design and supervision of school buildings",
    status: str = "active",
    type_slug: str = "eoi",
    close: str = "24 November 2026",
    country: str = "Jordan",
) -> str:
    """One listing row in the live markup, reduced to what the parser reads."""
    return f"""<div class="views-row"><div class="container-huge">
<article role="article" about="/project-procurement/tenders/2026/{type_slug}/{slug}" data-nid="{zlib.crc32(slug.encode()) % 9000}" lang="en" class="display-teaser teaser type-tender">
<div class="field-title mt-4"><h2><a href="/project-procurement/tenders/2026/{type_slug}/{slug}" hreflang="en">{title}</a></h2></div>
<div class="tender-badges">
  <div class="field field--name-field-tender-status field--type-entity-reference field--label-hidden field--item"><div about="/t/204" class="taxonomy-term vocabulary-tender-status slug-{status}">
  {status.capitalize()}
</div></div>
  <div class="field field--name-field-tender-type field--type-entity-reference field--label-hidden field--item"><div about="/t/206" class="taxonomy-term vocabulary-tender-type slug-{type_slug}">
  Expression of Interest
</div></div>
  <div class="field field--name-field-world-country field--type-entity-reference field--label-hidden field--item">{country}</div>
  <div class="field field--name-field-close-date field--type-datetime field--label-hidden field--item"><time datetime="00Z">{close}</time>
</div>
</div>
</article>
</div></div>"""


class FakeSite:
    """Serves one listing body per ``page`` query value; later pages are empty."""

    def __init__(self, pages: list[list[str]]) -> None:
        self.pages = pages
        self.urls: list[str] = []

    def __call__(self, url: str) -> str:
        self.urls.append(url)
        page = int(dict(parse.parse_qsl(parse.urlsplit(url).query))["page"])
        return "".join(self.pages[page]) if page < len(self.pages) else "<div></div>"


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def test_isdb_family_is_registered() -> None:
    assert COLLECTORS["isdb_tender_list"] is isdb.collect_isdb_documents


def test_parses_the_live_listing_rows() -> None:
    tenders = parse_tender_list(FIXTURE.read_text(encoding="utf-8"))

    assert [(t["status"], t["typeSlug"]) for t in tenders] == [
        ("closed", "eoi"),
        ("active", "gpn"),
        ("active", "eoi"),
        ("active", "pqn"),
        ("active", "contract-award"),
        ("closed", "pqn"),
    ]
    eoi = tenders[2]
    assert eoi["title"].startswith("Consulting Firm for Development of Design and Estimate")
    assert eoi["noticeType"] == "Expression of Interest"
    assert eoi["country"] == "Kyrgyz"
    assert eoi["closeDate"] == "2026-11-24"
    assert str(eoi["path"]).startswith("/project-procurement/tenders/2026/eoi/")


def test_the_page_heading_article_is_not_a_tender(caplog: pytest.LogCaptureFixture) -> None:
    heading = (
        '<article role="article" about="/project-procurement/tenders" '
        'class="display-full type-pproc_page slug-tenders"><h1>Tenders</h1></article>'
    )

    with caplog.at_level(logging.WARNING, logger=isdb.logger.name):
        tenders = parse_tender_list(heading + _article("school"))

    assert [t["path"] for t in tenders] == ["/project-procurement/tenders/2026/eoi/school"]
    assert caplog.text == ""


def test_keeps_open_notices_that_are_not_awards_and_gives_each_its_own_url() -> None:
    site = FakeSite([[FIXTURE.read_text(encoding="utf-8")]])

    documents = collect_isdb_documents(_source(), limit=100, fetch_text=site)

    urls = [document.source_url for document in documents]
    original = parse_tender_list(FIXTURE.read_text(encoding="utf8"))
    assert urls == [SITE + r["path"] for r in original]
    assert [json.loads(d.payload)["noticeType"] for d in documents] == [
        r["noticeType"] for r in original
    ]


def test_a_general_procurement_notice_close_date_is_not_a_deadline() -> None:
    site = FakeSite([[FIXTURE.read_text(encoding="utf-8")]])

    documents = collect_isdb_documents(_source(), limit=100, fetch_text=site)
    gpn, eoi = (json.loads(d.payload) for d in documents[1:3])

    assert gpn["deadline"] is None
    assert "16 November 2026" in gpn["rawNotice"]  # evidence keeps what the site says
    assert eoi["deadline"] == "2026-11-24"


def test_an_active_notice_past_its_close_date_is_skipped() -> None:
    site = FakeSite(
        [
            [
                _article("late", close="14 November 2026"),
                _article("today", close="15 November 2026"),
                _article("undated", close="not a date"),
            ]
        ]
    )

    documents = collect_isdb_documents(_source(), limit=100, fetch_text=site)

    assert [d.source_url.rsplit("/", 1)[-1] for d in documents] == ["late", "today", "undated"]
    assert json.loads(documents[2].payload)["deadline"] is None


def test_pages_until_an_empty_page_and_keeps_a_notice_listed_twice_once() -> None:
    site = FakeSite(
        [
            [_article("a"), _article("b")],
            [_article("b"), _article("c")],  # a shifting list repeats a row across pages
        ]
    )

    documents = collect_isdb_documents(_source(), limit=100, fetch_text=site)

    assert [d.source_url.rsplit("/", 1)[-1] for d in documents] == ["a", "b", "c"]
    queries = [dict(parse.parse_qsl(parse.urlsplit(url).query)) for url in site.urls]
    assert [query["page"] for query in queries] == ["0", "1", "2"]
    assert {query["status"] for query in queries} == {"active"}


def test_page_cap_stops_paging_and_logs_a_warning(caplog: pytest.LogCaptureFixture) -> None:
    site = FakeSite([[_article(f"n{index}")] for index in range(MAX_PAGES + 5)])

    with caplog.at_level(logging.WARNING, logger=isdb.logger.name):
        documents = collect_isdb_documents(_source(), limit=1000, fetch_text=site)

    assert len(site.urls) == MAX_PAGES
    assert len(documents) == MAX_PAGES
    assert f"stopped after {MAX_PAGES} pages" in caplog.text


def test_returns_at_most_limit_documents_and_stops_paging() -> None:
    site = FakeSite([[_article(f"p{page}n{n}") for n in range(3)] for page in range(4)])

    documents = collect_isdb_documents(_source(), limit=4, fetch_text=site)

    assert len(documents) == 4
    assert len(site.urls) == 2


def test_collection_preserves_unclassified_source_material() -> None:
    site = FakeSite(
        [
            [
                _article("school"),
                _article("audit", title="Shariah compliance audit of the financing portfolio"),
            ]
        ]
    )

    documents = collect_isdb_documents(_source(), limit=100, fetch_text=site)

    assert [d.source_url.rsplit("/", 1)[-1] for d in documents] == ["school", "audit"]
    assert "rawNotice" in json.loads(documents[0].payload)


def test_payload_parses_as_a_generic_listing_notice() -> None:
    site = FakeSite([[_article("school")]])

    [document] = collect_isdb_documents(_source(), limit=5, fetch_text=site)
    payload = json.loads(document.payload)

    assert payload["officialUrl"] == document.source_url
    assert payload["location"] == payload["country"] == "Jordan"
    # The notice page is server rendered, so enrichment reads it: no empty ``rawNoticeHtml``.
    assert "rawNoticeHtml" not in payload

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == document.source_url
    assert record.deadline_at == date(2026, 11, 24)
    assert record.location_label == "Jordan"
