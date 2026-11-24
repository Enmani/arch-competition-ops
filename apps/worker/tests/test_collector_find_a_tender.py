from __future__ import annotations

import json
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit

from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors.find_a_tender import collect_find_a_tender_documents

API_URL = "https://www.find-tender.service.gov.uk/api/1.0/ocdsReleasePackages"
NOTICE_URL = "https://www.find-tender.service.gov.uk/Notice/"


def _source():
    return _build_source(
        "uk_find_a_tender_notices",
        name="UK Find a Tender Notices",
        jurisdiction="united_kingdom",
        base_url=API_URL,
        scan_method="api",
        extractor="generic_listing_html",
        collector="find_a_tender_ocds",
        regions=["europe", "united_kingdom"],
    )


def _release(
    notice_id: str,
    ocid: str,
    *,
    tag: list[str] | None = None,
    status: str | None = "active",
    cpv: list[str] | None = None,
    title: str = "Architectural services for a new primary school",
    date_: str = "2026-11-13T12:00:00Z",
    notice_type: str | None = "UK4",
    **tender_fields: object,
) -> dict:
    tender: dict = {
        "id": ocid,
        "title": title,
        "description": "Multidisciplinary design team for a school site.",
        "items": [
            {
                "id": "1",
                "additionalClassifications": [
                    {"scheme": "CPV", "id": code} for code in (cpv or ["71220000"])
                ],
                "deliveryAddresses": [{"region": "UKG32", "country": "GB"}],
            }
        ],
        **tender_fields,
    }
    if status is not None:
        tender["status"] = status
    if notice_type:
        tender["documents"] = [
            {
                "id": notice_id,
                "documentType": "tenderNotice",
                "noticeType": notice_type,
                "url": f"{NOTICE_URL}{notice_id}",
            }
        ]
    return {
        "id": notice_id,
        "ocid": ocid,
        "date": date_,
        "tag": tag or ["tender"],
        "buyer": {"name": "Solihull Metropolitan Borough Council"},
        "tender": tender,
    }


def _pages(*pages: list[dict]):
    """Offline API: page N links to page N+1 through ``links.next``; records requested URLs."""
    requested: list[str] = []
    next_urls = [f"{API_URL}?limit=100&cursor=page{n}" for n in range(2, len(pages) + 1)]

    def fetch(url: str) -> dict:
        requested.append(url)
        index = 0 if url not in next_urls else next_urls.index(url) + 1
        body: dict = {"releases": pages[index]}
        if index < len(next_urls):
            body["links"] = {"next": next_urls[index]}
        return body

    return fetch, requested


def test_follows_cursor_pages_until_exhausted_with_the_default_window() -> None:
    fetch, requested = _pages(
        [_release("108300-2026", "ocds-h6vhtk-000003", date_="2026-11-14T10:00:00Z")],
        [_release("108200-2026", "ocds-h6vhtk-000002", date_="2026-11-12T10:00:00Z")],
        [_release("108100-2026", "ocds-h6vhtk-000001", date_="2026-11-10T10:00:00Z")],
    )

    documents = collect_find_a_tender_documents(_source(), limit=500, fetch_json=fetch)

    query = parse_qs(urlsplit(requested[0]).query)
    today = clock.today()
    assert query == {
        "limit": ["100"],
        "updatedFrom": [f"{(today - timedelta(days=7)).isoformat()}T00:00:00"],
        "updatedTo": [f"{today.isoformat()}T23:59:59"],
    }
    assert requested[1:] == [
        f"{API_URL}?limit=100&cursor=page2",
        f"{API_URL}?limit=100&cursor=page3",
    ]
    assert [d.source_url for d in documents] == [
        f"{NOTICE_URL}108300-2026",
        f"{NOTICE_URL}108200-2026",
        f"{NOTICE_URL}108100-2026",
    ]


def test_keeps_only_open_tender_stage_notices_in_the_cpv_or_design_contest_scope() -> None:
    fetch, _ = _pages(
        [
            _release("1-2026", "ocds-a", cpv=["71240000"]),
            _release("2-2026", "ocds-b", cpv=["79932000"], title="Interior design"),
            _release("3-2026", "ocds-c", cpv=["45210000"], title="School building works"),
            _release(
                "4-2026",
                "ocds-d",
                cpv=["45210000"],
                title="Civic hall",
                procurementMethodDetails="Design contest",
            ),
            _release("5-2026", "ocds-e", tag=["award", "contract"], status="complete"),
            _release("6-2026", "ocds-f", tag=["planning"], status="planning", notice_type="UK2"),
            _release("7-2026", "ocds-g", tag=["tenderCancellation"], notice_type="UK12"),
            # A 2015-regulations prior information notice used as the call for competition.
            _release("8-2026", "ocds-h", tag=["planning", "tender"], notice_type=None),
            # A 2015-regulations contract modification: tender stage tag, but no status.
            _release("9-2026", "ocds-i", tag=["tenderUpdate"], status=None, notice_type=None),
        ]
    )

    documents = collect_find_a_tender_documents(_source(), limit=500, fetch_json=fetch)

    assert [d.source_url.removeprefix(NOTICE_URL) for d in documents] == [
        *(f"{i}-2026" for i in range(1, 10)),
    ]
    contest = json.loads(documents[3].payload)
    assert contest["opportunityType"] == "public_design_contest"


def test_each_release_of_one_procedure_keeps_its_notice_url() -> None:
    fetch, _ = _pages(
        [
            _release(
                "30-2026",
                "ocds-updated",
                tag=["tenderUpdate"],
                title="Library design team (amended)",
                date_="2026-11-14T09:00:00Z",
            ),
            _release(
                "29-2026",
                "ocds-awarded",
                tag=["award", "contract"],
                status="complete",
                date_="2026-11-14T08:00:00Z",
            ),
        ],
        [
            _release("20-2026", "ocds-updated", title="Library design team"),
            _release("19-2026", "ocds-awarded", title="Town hall architect"),
        ],
    )

    documents = collect_find_a_tender_documents(_source(), limit=500, fetch_json=fetch)

    assert {d.source_url for d in documents} == {f"{NOTICE_URL}{n}-2026" for n in [30, 29, 20, 19]}
    assert documents[0].source_url == f"{NOTICE_URL}30-2026"
    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Library design team (amended)"
    assert payload["noticeId"] == "ocds-updated"


def test_payload_keeps_explicit_facts_and_the_raw_release_in_ai_mode() -> None:
    release = _release(
        "108004-2026",
        "ocds-h6vhtk-07bba4",
        tenderPeriod={"endDate": "2026-11-27T12:00:00Z"},
        value={"amountGross": 180000.0, "currency": "GBP"},
        procurementMethodDetails="Below threshold - open competition",
    )
    fetch, _ = _pages([release])

    (document,) = collect_find_a_tender_documents(_source(), limit=5, fetch_json=fetch)

    payload = json.loads(document.payload)
    assert payload["officialUrl"] == f"{NOTICE_URL}108004-2026" == document.source_url
    assert payload["deadline"] == "2026-11-27T12:00:00Z"
    assert payload["estimatedValueEur"] is None
    assert payload["estimatedValueText"] == "GBP 180,000 (including VAT)"
    assert payload["cpv"] == ["71220000"]
    assert payload["location"] == "UKG32"
    assert payload["noticeType"] == "UK4"
    assert payload["procedureType"] == "Below threshold - open competition"
    assert payload["buyer"] == "Solihull Metropolitan Borough Council"
    assert payload["rawNotice"] == release


def test_collection_preserves_unclassified_source_material() -> None:
    fetch, _ = _pages(
        [
            _release("1-2026", "ocds-a", cpv=["71200000"]),
            # In scope by CPV (71* engineering) but not an architecture or design notice.
            _release(
                "2-2026",
                "ocds-b",
                cpv=["71631480"],
                title="Road condition survey",
                description="Annual SCRIM road surveys.",
            ),
        ]
    )

    documents = collect_find_a_tender_documents(_source(), limit=5, fetch_json=fetch)

    assert [d.source_url for d in documents] == [f"{NOTICE_URL}1-2026", f"{NOTICE_URL}2-2026"]
    assert "rawNotice" in json.loads(documents[0].payload)


def test_limit_caps_documents_and_stops_paging() -> None:
    fetch, requested = _pages(
        [
            _release("3-2026", "ocds-c", date_="2026-11-14T10:00:00Z"),
            _release("2-2026", "ocds-b", date_="2026-11-13T10:00:00Z"),
        ],
        [_release("1-2026", "ocds-a", date_="2026-11-12T10:00:00Z")],
    )

    documents = collect_find_a_tender_documents(_source(), limit=2, fetch_json=fetch)

    assert [d.source_url.removeprefix(NOTICE_URL) for d in documents] == ["3-2026", "2-2026"]
    assert len(requested) == 1


def test_design_and_ordinary_works_are_both_collected() -> None:
    releases = [
        _release("1-2026", "ocds-a", cpv=["45214200"], title="Design and Build of a new school"),
        _release("2-2026", "ocds-b", cpv=["45214200"], title="Roof repairs at the town hall"),
    ]

    fetch, _requested = _pages(releases)
    documents = collect_find_a_tender_documents(_source(), limit=50, fetch_json=fetch)
    assert [d.source_url for d in documents] == [f"{NOTICE_URL}1-2026", f"{NOTICE_URL}2-2026"]

    fetch, _requested = _pages(releases)
