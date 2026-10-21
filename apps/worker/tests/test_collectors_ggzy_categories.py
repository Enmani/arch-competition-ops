from __future__ import annotations

import json
from datetime import date

from support import build_source as _build_source

from arch_competition_ops.collectors.ggzy import collect_ggzy_documents


def test_collect_ggzy_documents_excludes_water_engineering_notice_from_original_category() -> None:
    source = _build_source(
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

    list_payload = {
        "code": 200,
        "message": "success",
        "data": {
            "records": [
                {
                    "id": "water-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "江苏省",
                    "title": "滆湖湖区生态修复一期项目初步设计",
                    "url": "/information/deal/html/a/320000/0101/20260508/water-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">滆湖湖区生态修复一期项目初步设计</h4>
      <p class="p_o">
        <span class='detail_url'>
          <a target="_blank" href="https://example.cn/original/water-001">原文链接地址</a>
        </span>
      </p>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目名称：滆湖湖区生态修复一期项目初步设计</p>
          <p>项目建设内容：主要建设内容为防浪消浪带构建工程、水体透明度恢复工程和沉水植物重建工程。</p>
          <p>资质要求：水利工程设计资质、环境工程设计专项（水污染防治工程或污染修复工程）甲级资质。</p>
          <p>投标文件递交的截止时间为2026年06月01日09时00分。</p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()

    original_html = """
<!doctype html>
<html>
  <body>
    <div class="ewb-bread">
      <a href="/">首页</a> &gt; <a>交易信息</a> &gt; <a>水利工程</a> &gt; <span>招标公告</span>
    </div>
  </body>
</html>
""".strip()

    def fake_fetch_detail(url: str) -> str:
        if url == "https://example.cn/original/water-001":
            return original_html
        return detail_html

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=fake_fetch_detail,
        today=date(2026, 5, 9),
    )

    assert documents == []


def test_collect_ggzy_documents_excludes_water_ecology_notice_without_original_category_probe() -> (
    None
):
    source = _build_source(
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

    list_payload = {
        "code": 200,
        "message": "success",
        "data": {
            "records": [
                {
                    "id": "water-002",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "江苏省",
                    "title": "滆湖湖区生态修复一期项目初步设计",
                    "url": "/information/deal/html/a/320000/0101/20260508/water-002.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">滆湖湖区生态修复一期项目初步设计</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目总体建设内容：主要建设内容为防浪消浪带构建工程、水体透明度恢复工程和沉水植物重建工程。</p>
          <p>资质要求：水利工程设计资质或水利行业（河道整治）专业乙级及以上资质；环境工程设计专项（水污染防治工程或污染修复工程）甲级资质。</p>
          <p>投标文件递交的截止时间为2026年06月01日09时00分。</p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=lambda _url: detail_html,
        today=date(2026, 5, 9),
    )

    assert documents == []


def test_collect_ggzy_documents_keeps_unknown_building_type_with_positive_official_category_and_building_discipline() -> (
    None
):
    source = _build_source(
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

    list_payload = {
        "code": 200,
        "message": "success",
        "data": {
            "records": [
                {
                    "id": "keep-unknown-building-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "北京市",
                    "title": "星际计算中心项目方案设计、初步设计招标公告",
                    "url": "/information/deal/html/a/110000/0101/20260508/keep-unknown-building-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">星际计算中心项目方案设计、初步设计招标公告</h4>
      <p class="p_o">
        <span class='detail_url'>
          <a target="_blank" href="https://example.cn/original/keep-unknown-building-001">原文链接地址</a>
        </span>
      </p>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目名称：星际计算中心项目方案设计、初步设计</p>
          <p>建设规模：新建科研计算设施及配套公共服务空间。</p>
          <p>投标文件递交的截止时间为2026年06月06日09时30分。</p>
          <p>资质要求：投标人须具备建筑行业（建筑工程）甲级资质，项目负责人须具备一级注册建筑师资格。</p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()

    original_html = """
<!doctype html>
<html>
  <body>
    <div class="ewb-bread">
      <a href="/">首页</a> &gt; <a>交易信息</a> &gt; <a>工程建设</a> &gt; <a>勘察设计</a> &gt; <a>房屋建筑</a> &gt; <span>招标公告</span>
    </div>
  </body>
</html>
""".strip()

    def fake_fetch_detail(url: str) -> str:
        if url == "https://example.cn/original/keep-unknown-building-001":
            return original_html
        return detail_html

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=fake_fetch_detail,
        today=date(2026, 5, 9),
    )

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["title"] == "星际计算中心项目方案设计、初步设计招标公告"
    assert payload["deadline"] == "2026-06-06"


def test_collect_ggzy_documents_excludes_municipal_design_notice_from_official_category_even_with_design_scope() -> (
    None
):
    source = _build_source(
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

    list_payload = {
        "code": 200,
        "message": "success",
        "data": {
            "records": [
                {
                    "id": "drop-municipal-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "浙江省",
                    "title": "滨江大道综合管廊项目初步设计招标公告",
                    "url": "/information/deal/html/a/330000/0101/20260508/drop-municipal-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">滨江大道综合管廊项目初步设计招标公告</h4>
      <p class="p_o">
        <span class='detail_url'>
          <a target="_blank" href="https://example.cn/original/drop-municipal-001">原文链接地址</a>
        </span>
      </p>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目建设内容：新建综合管廊及附属市政配套设施。</p>
          <p>投标文件递交的截止时间为2026年06月08日09时00分。</p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()

    original_html = """
<!doctype html>
<html>
  <body>
    <div class="ewb-bread">
      <a href="/">首页</a> &gt; <a>交易信息</a> &gt; <a>工程建设</a> &gt; <a>市政工程</a> &gt; <span>招标公告</span>
    </div>
  </body>
</html>
""".strip()

    def fake_fetch_detail(url: str) -> str:
        if url == "https://example.cn/original/drop-municipal-001":
            return original_html
        return detail_html

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=fake_fetch_detail,
        today=date(2026, 5, 9),
    )

    assert documents == []
