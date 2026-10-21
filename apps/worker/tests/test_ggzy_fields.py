from __future__ import annotations

import json
from datetime import date

import pytest
from support import build_source

from arch_competition_ops.collectors.ggzy import collect_ggzy_documents
from arch_competition_ops.collectors.ggzy.collect import (
    MAX_DETAIL_BUDGET,
    MIN_DETAIL_BUDGET,
    detail_budget,
)
from arch_competition_ops.collectors.ggzy.html_text import extract_notice_body_text
from arch_competition_ops.extractors.ggzy_fields import (
    extract_deadline_iso,
    extract_qualification_clause,
)
from arch_competition_ops.http import HttpClient, set_default_client

from http_fakes import Reply, make_client  # isort: skip

PUBLISHED = "2026-05-08"


@pytest.mark.parametrize(
    "text",
    [
        "项目名称：某市民文化中心项目方案设计\n项目概况：本项目采用公开招标方式。",
        "开标时间：2026年05月18日 09时30分",
        "开启时间：2026年05月18日",
        "发布时间：2026-05-08\n公告期限：自本公告发布之日起5个工作日",
        "页面生成时间 2026-05-08",
        "答疑截止时间：2026年05月12日",
    ],
)
def test_text_without_a_labelled_submission_deadline_yields_none(text: str) -> None:
    assert extract_deadline_iso(text, published_at_iso=PUBLISHED) is None


def test_page_generation_meta_date_is_never_a_deadline() -> None:
    detail_html = (
        '<html><head><meta name="others" content="页面生成时间 2026-05-09"></head>'
        '<body><div id="mycontent"><div class="detail_content">'
        "<p>项目名称：学校教学楼设计</p></div></div></body></html>"
    )

    body = extract_notice_body_text(detail_html) or ""

    assert extract_deadline_iso(body, published_at_iso=PUBLISHED) is None


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("投标文件递交截止时间：2026年05月19日 09时30分", "2026-05-19"),
        ("投标截止时间：2026-05-20 09:30", "2026-05-20"),
        ("报名截止时间：2026年05月15日", "2026-05-15"),
        ("响应文件提交截止时间为2026年5月21日", "2026-05-21"),
        ("潜在供应商应于 2026 年 5 月 19 日 13 时 30分（北京时间）前提交响应文件", "2026-05-19"),
    ],
)
def test_positively_labelled_deadlines_are_extracted(text: str, expected: str) -> None:
    assert extract_deadline_iso(text, published_at_iso=PUBLISHED) == expected


def test_submission_deadline_outranks_opening_and_registration() -> None:
    text = (
        "报名截止时间：2026年05月12日\n"
        "开标时间：2026年05月20日 09时30分\n"
        "投标文件递交截止时间：2026年05月19日 09时30分\n"
    )

    assert extract_deadline_iso(text, published_at_iso=PUBLISHED) == "2026-05-19"


def test_extended_deadline_wins_over_the_original_when_both_are_labelled_equally() -> None:
    text = "投标截止时间：2026年05月19日\n更正：投标截止时间：2026年05月26日"

    assert extract_deadline_iso(text, published_at_iso=PUBLISHED) == "2026-05-26"


def test_implausible_dates_relative_to_publication_are_discarded() -> None:
    assert extract_deadline_iso("投标截止时间：2024年01月01日", published_at_iso=PUBLISHED) is None
    assert extract_deadline_iso("投标截止时间：2031年01月01日", published_at_iso=PUBLISHED) is None
    # without a publication date there is nothing to compare against
    assert extract_deadline_iso("投标截止时间：2031年01月01日") == "2031-01-01"


def test_qualification_clause_is_taken_only_from_a_qualification_section() -> None:
    body = (
        "项目名称：医院改造设计\n"
        "投标人资格要求：须具有建筑行业（建筑工程）甲级资质及一级注册建筑师。\n"
        "获取招标文件：2026年5月1日起\n"
    )

    clause = extract_qualification_clause(body)

    assert clause is not None
    assert "一级注册建筑师" in clause
    assert "获取招标文件" not in clause


def test_no_qualification_heading_means_no_clause() -> None:
    assert (
        extract_qualification_clause("项目名称：医院改造设计\n建筑行业（建筑工程）相关项目") is None
    )


# -- collector level ------------------------------------------------------------------------------

SOURCE = build_source(
    "ggzy_public_notices",
    name="National Public Resources Trading Platform",
    jurisdiction="china",
    base_url="https://www.ggzy.gov.cn/deal/dealList.html",
    scan_method="api",
    extractor="generic_listing_html",
    collector="ggzy_public_notices",
    regions=["asia", "china"],
    languages=["zh"],
)


def _listing(identifier: str, title: str) -> dict:
    return {
        "id": identifier,
        "publishTime": PUBLISHED,
        "businessTypeText": "工程建设",
        "informationType": "0101",
        "informationTypeText": "招标/资审公告",
        "provinceText": "山东省",
        "title": title,
        "url": f"/information/deal/html/a/370000/0101/20260508/{identifier}.html",
    }


def _detail(title: str, body_lines: list[str]) -> str:
    paragraphs = "".join(f"<p>{line}</p>" for line in body_lines)
    return (
        f'<html><body><div class="detail"><h4 class="h4_o">{title}</h4>'
        f'<div id="mycontent"><div class="detail_content">{paragraphs}</div></div></div></body></html>'
    )


def test_notice_without_any_labelled_date_carries_no_deadline() -> None:
    title = "青岛市市民文化中心项目方案设计招标公告"
    detail_html = _detail(
        title,
        [
            "项目名称：青岛市市民文化中心项目方案设计",
            "开标时间：2026年05月18日 09时30分",
            "建筑设计",
        ],
    )
    list_payload = {"data": {"records": [_listing("no-deadline-1", title)]}}

    documents = collect_ggzy_documents(
        SOURCE,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=lambda _url: detail_html,
        today=date(2026, 5, 9),
    )

    assert len(documents) == 1
    assert "deadline" not in json.loads(documents[0].payload)


def test_summary_is_not_promoted_to_an_eligibility_clause() -> None:
    title = "青岛市市民文化中心项目方案设计招标公告"
    detail_html = _detail(title, ["项目名称：方案设计", "建筑行业（建筑工程）设计项目", "建筑设计"])
    list_payload = {"data": {"records": [_listing("no-clause-1", title)]}}

    documents = collect_ggzy_documents(
        SOURCE,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=lambda _url: detail_html,
        today=date(2026, 5, 9),
    )

    payload = json.loads(documents[0].payload)
    assert "eligibility" not in payload  # body text is carried as "summary" only
    assert "建筑行业" in payload["summary"]


def test_clause_found_under_a_heading_is_sent_as_eligibility() -> None:
    title = "青岛市市民文化中心项目方案设计招标公告"
    detail_html = _detail(
        title,
        [
            "项目名称：方案设计",
            "投标人资格要求：须具有一级注册建筑师。",
            "获取招标文件：5月1日起",
            "建筑设计",
        ],
    )
    list_payload = {"data": {"records": [_listing("clause-1", title)]}}

    documents = collect_ggzy_documents(
        SOURCE,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=lambda _url: detail_html,
        today=date(2026, 5, 9),
    )

    assert "一级注册建筑师" in json.loads(documents[0].payload)["eligibility"]


def test_detail_fetching_is_bounded_by_the_requested_limit() -> None:
    records = [
        _listing(f"bulk-{index:03d}", f"学校教学楼方案设计项目{index}") for index in range(80)
    ]
    list_payload = {"data": {"records": records}}
    fetched: list[str] = []

    def fetch_detail(url: str) -> str:
        fetched.append(url)
        return _detail("学校教学楼方案设计", ["建筑设计"])

    collect_ggzy_documents(
        SOURCE,
        limit=2,
        fetch_list=lambda _url, data: (
            json.dumps(list_payload, ensure_ascii=False) if data["PAGENUMBER"] == "1" else "{}"
        ),
        fetch_detail=fetch_detail,
        today=date(2026, 5, 9),
    )

    assert len(fetched) <= detail_budget(2) <= MAX_DETAIL_BUDGET
    assert len(fetched) < 80


def test_detail_budget_scales_with_limit_within_bounds() -> None:
    assert detail_budget(1) == MIN_DETAIL_BUDGET
    assert detail_budget(10) == 30
    assert detail_budget(1000) == MAX_DETAIL_BUDGET


def test_raw_detail_pages_are_archived_as_evidence(tmp_path) -> None:
    title = "青岛市市民文化中心项目方案设计招标公告"
    page = _detail(title, ["项目名称：方案设计", "投标截止时间：2026年05月19日", "建筑设计"])
    client, adapter, _clock = make_client(
        lambda request: Reply(
            body=page.encode("utf-8"), headers={"Content-Type": "text/html; charset=utf-8"}
        )
    )
    set_default_client(client)
    list_payload = {"data": {"records": [_listing("archive-1", title)]}}
    archive_dir = tmp_path / "artifacts" / "html"

    documents = collect_ggzy_documents(
        SOURCE,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        today=date(2026, 5, 9),
        archive_dir=archive_dir,
    )

    assert len(documents) == 1
    assert adapter.requests  # the real page fetcher ran through the shared client
    metadata_files = list(archive_dir.glob("*.json"))
    assert len(metadata_files) == 1
    metadata = json.loads(metadata_files[0].read_text(encoding="utf-8"))
    assert metadata["status_code"] == 200
    assert metadata["url"].endswith("/information/deal/html/b/370000/0101/20260508/archive-1.html")
    assert (archive_dir / f"{metadata['sha1']}.html").read_bytes() == page.encode("utf-8")
    assert isinstance(client, HttpClient)
