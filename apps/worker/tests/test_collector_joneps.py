from __future__ import annotations

import json
import logging
from datetime import date
from types import SimpleNamespace
from urllib import parse

import pytest
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import joneps
from arch_competition_ops.collectors.joneps import collect_joneps_documents
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.generic_listing import parse_generic_listing_notice

TECHNICAL, SERVICES, WORKS = "EP0014", "EP0012", "EP0015"


def _source():
    return _build_source(
        "jo_joneps_tender_invitations",
        name="JONEPS Tender Invitations",
        jurisdiction="jordan",
        base_url=joneps.LIST_URL,
        scan_method="api",
        extractor="generic_listing_html",
        collector="joneps_tender_invitations",
        regions=["middle_east", "jordan"],
        languages=["ar"],
    )


def _row(
    number: int,
    published: str = "14/11/2026",
    closing: str = "30/11/2026",
    *,
    title: str = "إعداد الدراسات والتصاميم لمبنى",
    tender_type: str = TECHNICAL,
    category: str = "EP1312",
    method: str = "EP0021",
    sequence: str = "00",
) -> dict:
    return {
        "html": (
            '<tr style="x"><td class="al_c">'
            f"<a href=\"#\" onclick=\"fn_goDetail('{number}','{sequence}','','{category}','' ,"
            f"'EP0061', '{method}', '{tender_type}');\"> {number}-{sequence}</a></td>"
            f'<td class="al_l"><a href="#" onclick="fn_goDetail(\'{number}\', \'{sequence}\','
            f"'','{category}' ,'' ,'EP0061' , '{method}', '{tender_type}');\">{title}</a><br></td>"
            '<td class="al_l"> وزارة العدل</td><td class="al_c">خدمات فنية</td>'
            f'<td class="al_c">{published}</td><td class="al_c">{closing}</td></tr>'
        ),
        "type": tender_type,
    }


class FakePortal:
    """Serves rows per (type, sub-type) search, 20 a page, with a CSRF input in every answer."""

    def __init__(self, rows_by_scope: dict[tuple[str, str], list[dict]]) -> None:
        self.rows_by_scope = rows_by_scope
        self.requests: list[dict[str, str]] = []

    def __call__(self, fields: dict[str, str]) -> str:
        self.requests.append(fields)
        key = (fields["searchTendTypeCd1"], fields["searchTendTypeCd2"])
        page = int(fields["currentPageNo"])
        rows = (
            [r for group in self.rows_by_scope.values() for r in group]
            if key == ("", "")
            else self.rows_by_scope.get(key, [])
        )[(page - 1) * 20 : page * 20]
        return (
            '<input type="hidden" name="_csrf" value="t"/><table>'
            + "".join(row["html"] for row in rows)
            + "</table>"
        )

    def scopes(self) -> list[tuple[str, str]]:
        seen = []
        for fields in self.requests:
            key = (fields["searchTendTypeCd1"], fields["searchTendTypeCd2"])
            if key not in seen:
                seen.append(key)
        return seen


@pytest.fixture(autouse=True)
def _fixed_today():
    clock.set_today_provider(lambda: date(2026, 11, 15))
    yield
    clock.set_today_provider(None)


def _collect(portal, **kwargs):
    kwargs.setdefault("limit", 1000)
    return collect_joneps_documents(_source(), search=portal, **kwargs)


def test_family_is_registered() -> None:
    assert COLLECTORS["joneps_tender_invitations"] is collect_joneps_documents


def test_searches_the_three_scopes_with_server_side_ranges() -> None:
    portal = FakePortal({})

    _collect(portal)

    assert portal.scopes() == [("", "")]
    fields = portal.requests[0]
    assert fields["searchStartPublicationYmd"] == "08/11/2026"
    assert fields["searchEndPublicationYmd"] == "15/11/2026"
    assert fields["searchStartSubmDlineDt"] == ""
    assert fields["searchEndSubmDlineDt"] == ""
    # "Opened" means bids opened on this portal; a tender open for bids never matches it.
    assert fields["searchTendStatusCd"] == ""
    assert (fields["currentPageNo"], fields["offSet"]) == ("1", "0")


def test_pages_until_a_short_page() -> None:
    rows = [_row(2026000000 + i) for i in range(45)]
    portal = FakePortal({(TECHNICAL, ""): rows})

    documents = _collect(portal)

    pages = [
        (f["currentPageNo"], f["offSet"]) for f in portal.requests if f["searchTendTypeCd1"] == ""
    ]
    assert pages == [("1", "0"), ("2", "20"), ("3", "40")]
    assert len(documents) == 45


def test_page_cap_stops_a_runaway_search_with_a_warning(caplog) -> None:
    class Endless(FakePortal):
        def __call__(self, fields: dict[str, str]) -> str:
            self.requests.append(fields)
            if fields["searchTendTypeCd1"] != "":
                return '<input name="_csrf" value="t"/>'
            page = int(fields["currentPageNo"])
            return "".join(_row(2026000000 + page * 100 + n)["html"] for n in range(20))

    portal = Endless({})
    with caplog.at_level(logging.WARNING, logger=joneps.logger.name):
        documents = _collect(portal)

    technical_pages = [f for f in portal.requests if f["searchTendTypeCd1"] == ""]
    assert len(technical_pages) == joneps.MAX_PAGES
    assert len(documents) == 20 * joneps.MAX_PAGES
    assert "page cap" in caplog.text


def test_drops_rows_outside_the_window_or_already_closed() -> None:
    portal = FakePortal(
        {
            (TECHNICAL, ""): [
                _row(1),
                _row(2, published="01/10/2026"),
                _row(3, closing="10/11/2026"),
                _row(4, published="bad"),
            ]
        }
    )

    documents = _collect(portal)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["3", "1"]


def test_works_are_read_only_for_design_and_build_and_other_scopes_keep_everything() -> None:
    portal = FakePortal(
        {
            (TECHNICAL, ""): [_row(1, title="Anything at all")],
            (SERVICES, "EP0218"): [_row(2, tender_type=SERVICES, category="EP1311")],
            (WORKS, ""): [
                _row(3, tender_type=WORKS, title="Road paving"),
                _row(4, tender_type=WORKS, title="Design and build of a school"),
            ],
        }
    )

    documents = _collect(portal)

    assert sorted(json.loads(d.payload)["noticeId"] for d in documents) == ["1", "2", "3", "4"]


def test_collection_preserves_unclassified_source_material() -> None:
    portal = FakePortal(
        {
            (TECHNICAL, ""): [_row(1, title="شيء ما")],
            (SERVICES, "EP0218"): [
                _row(2, tender_type=SERVICES, title="دراسة جدوى"),
                _row(3, tender_type=SERVICES, title="تصميم موقع"),
            ],
        }
    )

    documents = _collect(portal)

    assert sorted(json.loads(d.payload)["noticeId"] for d in documents) == ["1", "2", "3"]
    assert "rawNotice" in json.loads(documents[0].payload)


def test_one_document_per_tender_number_keeping_the_newest_row() -> None:
    portal = FakePortal(
        {
            (TECHNICAL, ""): [
                _row(1, published="14/11/2026", sequence="01"),
                _row(1, published="10/11/2026", sequence="00"),
            ],
            (SERVICES, "EP0218"): [_row(1, tender_type=SERVICES)],
        }
    )

    documents = _collect(portal)

    assert len(documents) == 1
    assert json.loads(documents[0].payload)["tenderSequence"] == "01"


def test_notice_addresses_follow_the_portals_own_detail_routing() -> None:
    portal = FakePortal(
        {
            (TECHNICAL, ""): [
                _row(1, category="EP1312"),
                _row(2, category="EP1311", tender_type=SERVICES),
                _row(3, category="EP1311", method="EP0022"),
                _row(4, category="EP1311", tender_type="EP0011"),
                _row(5, category="EP1313"),
                _row(6, category="EP9999"),
            ]
        }
    )

    documents = _collect(portal)

    paths = {
        json.loads(d.payload)["noticeId"]: parse.urlsplit(d.source_url).path for d in documents
    }
    assert paths == {
        "1": "/ep/invt/WorkDetails.do",
        "2": "/ep/invt/ServiceDetails.do",
        "3": "/ep/invt/WorkDetails.do",
        "4": "/ep/invt/GoodsDetails.do",
        "5": "/ep/invt/MedicineDetails.do",
        "6": "/ep/invt/WorkUnspscDetails.do",
    }
    assert len({d.source_url for d in documents}) == 6
    query = dict(parse.parse_qsl(parse.urlsplit(documents[0].source_url).query))
    assert query["tendNo"] and query["tendSeq"] == "00" and query["invtYn"] == "Y"


def test_limit_keeps_the_newest_tenders() -> None:
    portal = FakePortal(
        {
            (TECHNICAL, ""): [
                _row(1, published="09/11/2026"),
                _row(2, published="14/11/2026"),
                _row(3, published="12/11/2026"),
            ]
        }
    )

    documents = _collect(portal, limit=2)

    assert [json.loads(d.payload)["noticeId"] for d in documents] == ["2", "3"]
    assert _collect(portal, limit=0) == []


def test_payload_carries_explicit_facts_and_the_row_as_evidence() -> None:
    portal = FakePortal({(TECHNICAL, ""): [_row(2026004748, closing="30/11/2026")]})

    [document] = _collect(portal)
    payload = json.loads(document.payload)

    assert payload["title"] == "إعداد الدراسات والتصاميم لمبنى"
    assert payload["buyer"] == "وزارة العدل"
    assert payload["noticeId"] == "2026004748"
    assert payload["deadline"] == "2026-11-30"
    assert payload["publishedAt"] == "2026-11-14"
    assert payload["procedureType"] == "Public tender"
    assert payload["country"] == "Jordan"
    assert "2026004748" in payload["rawNotice"]
    # The detail page fills itself by script, so enrichment must not fetch it again.
    assert payload["rawNoticeHtml"] == ""

    record = parse_generic_listing_notice(document.payload, _source(), document.source_url)
    assert record.official_url == document.source_url
    assert record.deadline_at == date(2026, 11, 30)


class _Reply(SimpleNamespace):
    pass


class _StubClient:
    def __init__(self, post_replies: list[str]) -> None:
        self.post_replies = post_replies
        self.gets = 0
        self.posted: list[dict] = []

    def get(self, url: str, **kwargs):
        self.gets += 1
        return _Reply(text=f'<input type="hidden" name="_csrf" value="token{self.gets}"/>')

    def post(self, url: str, *, data: dict, **kwargs):
        self.posted.append(data)
        return _Reply(text=self.post_replies.pop(0))


def test_session_opens_the_page_for_a_token_and_reuses_it() -> None:
    session = joneps._Session()
    session._client = _StubClient(
        ['<input name="_csrf" value="next1"/>', '<input name="_csrf" value="next2"/>']
    )

    session.search({"currentPageNo": "1"})
    session.search({"currentPageNo": "2"})

    assert session._client.gets == 1
    assert [post["_csrf"] for post in session._client.posted] == ["token1", "next1"]


def test_session_opens_a_new_session_once_when_the_token_is_gone_and_then_gives_up() -> None:
    session = joneps._Session()
    session._client = _StubClient(["expired", '<input name="_csrf" value="fresh"/>ok'])

    assert session.search({}).endswith("ok")
    assert session._client.gets == 2

    session._client = _StubClient(["expired", "expired again"])
    with pytest.raises(RuntimeError, match="without a CSRF token"):
        session.search({})
