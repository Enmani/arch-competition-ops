from __future__ import annotations

import json
import logging
import ssl
from datetime import date

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import monaqasat
from arch_competition_ops.collectors.monaqasat import collect_monaqasat_documents
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice

PAGE = "https://monaqasat.mof.gov.qa/TendersOnlineServices/AvailableMinistriesTenders/{}"
NOTICE = "https://monaqasat.mof.gov.qa/TendersOnlineServices/TenderDetails/{}"
SERVICES = "موردين / مقدمى خدمات"
CONTRACTING = "مقاولات"


def _source():
    return _build_source(
        "qa_monaqasat_available_tenders",
        name="Qatar Monaqasat Available Tenders",
        jurisdiction="qatar",
        base_url=PAGE.format(1),
        scan_method="api",
        extractor="generic_listing_html",
        collector="monaqasat_available_tenders",
        regions=["middle_east", "qatar"],
        languages=["ar"],
    )


def _card(
    tender_id: int,
    published: str,
    *,
    title: str = "عقد الخدمات الاستشارية للإشراف على أعمال الطرق",
    sector: str = SERVICES,
    kind: str = "مناقصة عامة",
    closing: str = "03/12/2026",
) -> str:
    return f"""
<tr><div class="row custom-cards"><div class="col-md-7 cards-col"><div class="col-header">
<span class="card-label">
  {tender_id}/2026
</span>
<span class="card-title"><a target="_blank" href="/TendersOnlineServices/TenderDetails/{tender_id}">
  {title}
</a></span></div>
<div class="col-footer"><div class="cards-row">
<span class="card-label"><label>تاريخ الطرح</label></span>
<span class="card-title"><span><label>{published}</label></span></span></div>
<div class="cards-row"><span class="card-label"><label>نوع القطاع المطلوب</label></span>
<span class="card-title"><label>{sector}</label></span></div></div></div>
<div class="col-md-3 cards-col"><div class="col-header">
<span class="card-label"><label>الجهة</label></span>
<span class="card-title"><span>هيئة الاشغال العامة</span></span></div>
<div class="col-footer"><div class="cards-row"><span class="card-label"><label>النوع</label></span>
<span class="card-title"><span>{kind}</span></span></div></div></div>
<div class="col-md-2 circle-container"><span class="card-label">
<span>تاريخ الإغلاق</span><br />
<span>{closing}</span></span>
<a class="btn btn-primary" href="/eservices/Tenders/TenderDetails/{tender_id}">شراء</a>
</div></div></tr>"""


def _detail(note: str = "نبذة مختصرة تصميم وإشراف") -> str:
    return (
        '<html><body><div class="page-content">بيانات المناقصة رقم الإعلان: 1 '
        f"{note} الشروط العامة boilerplate</div></body></html>"
    )


class FakeSite:
    """Pages of 15 cards; a page past the end repeats the last page, like the real site."""

    def __init__(self, cards: list[str], per_page: int = 15) -> None:
        self.pages = [cards[i : i + per_page] for i in range(0, max(len(cards), 1), per_page)] or [
            []
        ]
        self.requests: list[str] = []

    def __call__(self, url: str) -> str:
        self.requests.append(url)
        if "/TenderDetails/" in url:
            return _detail()
        number = int(url.rsplit("/", 1)[1])
        return "".join(self.pages[min(number, len(self.pages)) - 1])

    def list_pages(self) -> list[int]:
        return [int(u.rsplit("/", 1)[1]) for u in self.requests if "/TenderDetails/" not in u]


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def _collect(site, **kwargs):
    kwargs.setdefault("limit", 1000)
    return collect_monaqasat_documents(_source(), fetch_text=site, **kwargs)


def test_family_is_registered() -> None:
    assert COLLECTORS["monaqasat_available_tenders"] is collect_monaqasat_documents


def test_pages_until_the_site_repeats_its_last_page() -> None:
    site = FakeSite([_card(i, "14/11/2026") for i in range(1, 36)])

    documents = _collect(site)

    assert len(documents) == 35
    assert site.list_pages() == [1, 2, 3, 4]


def test_stops_after_a_page_that_is_entirely_older_than_the_window() -> None:
    cards = [_card(i, "14/11/2026") for i in range(1, 16)]
    cards += [_card(i, "01/10/2026") for i in range(16, 31)]
    cards += [_card(i, "01/09/2026") for i in range(31, 46)]
    site = FakeSite(cards)

    documents = _collect(site)

    assert len(documents) == 15
    assert site.list_pages() == [1, 2]


def test_page_cap_stops_a_runaway_listing_with_a_warning(caplog) -> None:
    class Endless:
        def __init__(self) -> None:
            self.pages: list[int] = []

        def __call__(self, url: str) -> str:
            if "/TenderDetails/" in url:
                return _detail()
            number = int(url.rsplit("/", 1)[1])
            self.pages.append(number)
            return "".join(_card(number * 100 + n, "14/11/2026") for n in range(15))

    site = Endless()
    with caplog.at_level(logging.WARNING, logger=monaqasat.logger.name):
        documents = _collect(site)

    assert site.pages == list(range(1, monaqasat.MAX_PAGES + 1))
    assert len(documents) == 15 * monaqasat.MAX_PAGES
    assert "page cap" in caplog.text


def test_skips_closed_and_undated_tenders() -> None:
    site = FakeSite(
        [
            _card(1, "14/11/2026"),
            _card(2, "14/11/2026", closing="10/11/2026"),
            _card(3, "no date"),
            _card(4, "14/11/2026", closing=""),
        ]
    )

    documents = _collect(site)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["1", "2", "4"]


def test_contracting_is_read_only_for_design_and_build_or_competitions() -> None:
    site = FakeSite(
        [
            _card(1, "14/11/2026", sector=CONTRACTING, title="Construction of a road"),
            _card(2, "14/11/2026", sector=CONTRACTING, title="Design and build of a school"),
            _card(3, "14/11/2026", sector=CONTRACTING, title="مسابقة تصميم", kind="مسابقة"),
            _card(4, "14/11/2026", sector=SERVICES, title="Catering"),
        ]
    )

    documents = _collect(site)

    assert sorted(json.loads(d.payload)["noticeId"] for d in documents) == ["1", "2", "3", "4"]


def test_collection_preserves_unclassified_source_material() -> None:
    site = FakeSite(
        [
            _card(1, "14/11/2026", title="توريد أدوية طبية"),
            _card(2, "14/11/2026", title="تصميم وإشراف على مبنى"),
            _card(3, "14/11/2026", title="Architectural services for a pavilion"),
        ]
    )

    documents = _collect(site)

    assert sorted(json.loads(d.payload)["noticeId"] for d in documents) == ["1", "2", "3"]
    assert len([u for u in site.requests if "/TenderDetails/" in u]) == 3
    assert "rawNotice" in json.loads(documents[0].payload)


def test_each_tender_has_its_own_public_page_and_limit_picks_the_newest() -> None:
    site = FakeSite([_card(i, f"{10 + i:02d}/11/2026") for i in range(1, 5)])

    documents = _collect(site, limit=2)

    assert [d.source_url for d in documents] == [NOTICE.format(4), NOTICE.format(3)]
    assert len(documents) == len([u for u in site.requests if "/TenderDetails/" in u]) == 2


def test_payload_carries_explicit_facts_and_the_detail_block() -> None:
    site = FakeSite([_card(662029, "14/11/2026", closing="14/12/2026")])

    [document] = _collect(site)
    payload = json.loads(document.payload)

    assert payload["title"] == "عقد الخدمات الاستشارية للإشراف على أعمال الطرق"
    assert payload["buyer"] == "هيئة الاشغال العامة"
    assert payload["tenderNumber"] == "662029/2026"
    assert payload["deadline"] == "2026-12-14"
    assert payload["publishedAt"] == "2026-11-14"
    assert payload["procedureType"] == "مناقصة عامة"
    assert payload["sector"] == SERVICES
    assert payload["country"] == "Qatar"
    assert payload["summary"] == "نبذة مختصرة تصميم وإشراف"
    assert payload["rawNoticeHtml"].startswith("بيانات المناقصة")
    assert "boilerplate" not in payload["rawNoticeHtml"]
    assert payload["rawNotice"]["published"] == "2026-11-14"

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == NOTICE.format(662029)
    assert record.deadline_at == date(2026, 12, 14)


def test_the_client_keeps_certificate_verification_on_and_asks_for_tls_13() -> None:
    adapter = monaqasat._ChainCompletingAdapter()
    context = adapter.poolmanager.connection_pool_kw["ssl_context"]

    assert context.verify_mode == ssl.CERT_REQUIRED
    assert context.check_hostname is True
    assert context.minimum_version == ssl.TLSVersion.TLSv1_3
    name = ("commonName", "DigiCert Global G2 TLS RSA SHA256 2020 CA1")
    assert any(name in rdn for cert in context.get_ca_certs() for rdn in cert["subject"])
