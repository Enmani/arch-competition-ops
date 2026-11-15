from __future__ import annotations

import json
from datetime import date
from urllib import parse

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.collectors.world_bank import collect_world_bank_documents
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice

NOTICE_PAGE = "https://projects.worldbank.org/en/projects-operations/procurement-detail/"


def _source():
    return _build_source(
        "world_bank_procurement_notices",
        name="World Bank Procurement Notices",
        jurisdiction="global",
        base_url="https://projects.worldbank.org/en/projects-operations/procurement",
        scan_method="api",
        extractor="generic_listing_html",
        collector="world_bank_procnotices",
        regions=["global"],
        languages=["en", "fr", "es", "pt"],
    )


def _notice(
    notice_id: str,
    noticedate: str,
    *,
    title: str = "Consultant for irrigation monitoring",
    notice_type: str = "Request for Expression of Interest",
    group: str = "CS",
    deadline: str | None = "2026-12-02T00:00:00Z",
    **extra: object,
) -> dict:
    return {
        "id": notice_id,
        "notice_type": notice_type,
        "noticedate": noticedate,
        "procurement_group": group,
        "procurement_method_name": "Quality And Cost-Based Selection",
        "project_ctry_name": "Morocco",
        "project_name": "Water Security Program",
        "noticetitle": title,
        "agency_name": "Ministry of Equipment",
        "submission_deadline_date": deadline,
        "notice_text": "<p><strong>REQUEST FOR EXPRESSIONS OF INTEREST</strong></p><p>Scope&nbsp;</p>",
        **extra,
    }


class FakeApi:
    """Serves ``notices`` (newest first) by the ``rows``/``os`` query parameters."""

    def __init__(self, notices: list[dict]) -> None:
        self.notices = notices
        self.urls: list[str] = []

    def __call__(self, url: str) -> dict:
        self.urls.append(url)
        query = dict(parse.parse_qsl(parse.urlsplit(url).query))
        rows, offset = int(query["rows"]), int(query["os"])
        return {
            "rows": rows,
            "os": str(offset),
            "total": str(len(self.notices)),
            "procnotices": self.notices[offset : offset + rows],
        }

    def offsets(self) -> list[int]:
        return [int(dict(parse.parse_qsl(parse.urlsplit(u).query))["os"]) for u in self.urls]


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def test_world_bank_family_is_registered() -> None:
    assert COLLECTORS["world_bank_procnotices"] is collect_world_bank_documents


def test_query_asks_for_consulting_notices_newest_first_with_all_fields() -> None:
    api = FakeApi([])
    collect_world_bank_documents(_source(), include_unclassified=True, fetch_json=api)

    query = dict(parse.parse_qsl(parse.urlsplit(api.urls[0]).query))
    assert query["procurement_group_exact"] == "CS"
    assert (query["srt"], query["order"]) == ("noticedate", "desc")
    assert query["fl"] == "*"
    assert query["os"] == "0"


def test_pages_by_offset_until_the_window_is_exhausted() -> None:
    notices = [_notice(f"OP{index:08d}", "14-Nov-2026") for index in range(150)]
    notices += [_notice(f"OP{index:08d}", "12-Nov-2026") for index in range(150, 260)]
    notices += [_notice("OP99999999", "07-Nov-2026")]
    api = FakeApi(notices)

    documents = collect_world_bank_documents(
        _source(),
        limit=10_000,
        publication_date_from="2026-11-12",
        include_unclassified=True,
        fetch_json=api,
    )

    assert len(documents) == 260
    assert api.offsets() == [0, 100, 200]
    assert documents[0].source_url == f"{NOTICE_PAGE}OP00000000"
    assert documents[-1].source_url == f"{NOTICE_PAGE}OP00000259"


def test_default_window_is_seven_days_and_stops_at_the_first_older_notice() -> None:
    api = FakeApi(
        [
            _notice("OP00000003", "14-Nov-2026"),
            _notice("OP00000002", "08-Nov-2026"),
            _notice("OP00000001", "07-Nov-2026"),
            _notice("OP00000000", "01-Nov-2026"),
        ]
    )

    documents = collect_world_bank_documents(
        _source(), limit=100, include_unclassified=True, fetch_json=api
    )

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["OP00000003", "OP00000002"]
    assert api.offsets() == [0]


def test_keeps_only_consulting_invitations_without_a_keyword_gate_in_ai_mode() -> None:
    api = FakeApi(
        [
            _notice("OP00000006", "14-Nov-2026", title="Communication strategy consultant"),
            _notice("OP00000005", "14-Nov-2026", notice_type="Contract Award"),
            _notice("OP00000004", "14-Nov-2026", notice_type="Invitation for Bids", group="CW"),
            _notice("OP00000003", "14-Nov-2026", notice_type="Invitation for Bids", group="GO"),
            _notice("OP00000002", "14-Nov-2026", notice_type="General Procurement Notice"),
            _notice("OP00000001", "14-Nov-2026", notice_type="Some Future Notice Type"),
        ]
    )

    documents = collect_world_bank_documents(
        _source(), limit=100, include_unclassified=True, fetch_json=api
    )

    assert [d.source_url for d in documents] == [f"{NOTICE_PAGE}OP00000006"]
    raw = json.loads(documents[0].payload)["rawNotice"]
    assert raw["id"] == "OP00000006"


def test_keyword_gate_applies_without_ai_mode() -> None:
    api = FakeApi(
        [
            _notice(
                "OP00000002",
                "14-Nov-2026",
                title="Architectural design and supervision of rehabilitated school buildings",
            ),
            _notice("OP00000001", "14-Nov-2026", title="Communication strategy consultant"),
        ]
    )

    documents = collect_world_bank_documents(_source(), limit=100, fetch_json=api)

    assert [d.source_url for d in documents] == [f"{NOTICE_PAGE}OP00000002"]
    assert "rawNotice" not in json.loads(documents[0].payload)


def test_payload_carries_explicit_facts_and_its_own_notice_page() -> None:
    api = FakeApi([_notice("OP00481539", "14-Nov-2026")])

    [document] = collect_world_bank_documents(
        _source(), limit=5, include_unclassified=True, fetch_json=api
    )
    payload = json.loads(document.payload)

    assert document.source_url == f"{NOTICE_PAGE}OP00481539"
    assert payload["officialUrl"] == f"{NOTICE_PAGE}OP00481539"
    assert payload["title"] == "Consultant for irrigation monitoring"
    assert payload["buyer"] == "Ministry of Equipment"
    assert payload["deadline"] == "2026-12-02"
    assert payload["publishedAt"] == "2026-11-14"
    assert payload["country"] == "Morocco"
    assert payload["noticeType"] == "Request for Expression of Interest"
    assert payload["procedureType"] == "Quality And Cost-Based Selection"
    assert payload["summary"] == "REQUEST FOR EXPRESSIONS OF INTEREST Scope"

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == f"{NOTICE_PAGE}OP00481539"
    assert record.deadline_at == date(2026, 12, 2)
    assert record.location_label == "Morocco"


def test_deadline_on_the_publication_date_is_treated_as_missing() -> None:
    api = FakeApi(
        [
            _notice("OP00000002", "14-Nov-2026", deadline="2026-11-14T00:00:00Z"),
            _notice("OP00000001", "14-Nov-2026", deadline=None),
        ]
    )

    documents = collect_world_bank_documents(
        _source(), limit=5, include_unclassified=True, fetch_json=api
    )

    assert [json.loads(d.payload)["deadline"] for d in documents] == [None, None]


def test_returns_at_most_limit_documents_and_stops_paging() -> None:
    api = FakeApi([_notice(f"OP{index:08d}", "14-Nov-2026") for index in range(250)])

    documents = collect_world_bank_documents(
        _source(), limit=120, include_unclassified=True, fetch_json=api
    )

    assert len(documents) == 120
    assert documents[-1].source_url == f"{NOTICE_PAGE}OP00000119"
    assert api.offsets() == [0, 100]
