from __future__ import annotations

import json
from datetime import date
from http.client import IncompleteRead

from support import build_source as _build_source

from arch_competition_ops.collectors.ggzy import collect_ggzy_documents


def test_collect_ggzy_documents_ignores_qualification_examples_when_mapping_building_categories() -> (
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
                    "id": "culture-001",
                    "publishTime": "2026-05-09",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "安徽省",
                    "title": "庐阳工人文化宫规划方案及初步设计招标公告",
                    "url": "/information/deal/html/a/340000/0101/20260509/culture-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">庐阳工人文化宫规划方案及初步设计招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目名称：庐阳工人文化宫规划方案及初步设计</p>
          <p>项目概况：新建工人文化宫，包含公共文化活动空间及配套服务用房。</p>
          <p>招标范围：方案设计、初步设计及相关服务。</p>
          <p>投标文件递交的截止时间为2026年05月29日09时30分。</p>
          <p>投标人资格要求：公共建筑项目设计业绩应包含方案设计、初步设计内容。</p>
          <p>注：“公共建筑”系指办公建筑、商业建筑、旅游建筑、科教文卫建筑、通信建筑、交通运输类建筑等。工业建筑及居住建筑设计业绩不予认可。</p>
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

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["buildingCategories"] == ["civic_public"]
    assert payload["builtAssetTypes"] == ["civic_culture"]


def test_collect_ggzy_documents_ignores_contact_address_when_mapping_hospitality_labels() -> None:
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
                    "id": "housing-001",
                    "publishTime": "2026-05-07",
                    "businessTypeText": "政府采购",
                    "informationType": "0201",
                    "informationTypeText": "采购/资审公告",
                    "provinceText": "新疆维吾尔自治区",
                    "title": "库车市2025年棚户区（城中村）改造项目初步设计及施工图设计竞争性磋商公告",
                    "url": "/information/deal/html/a/650000/0201/20260507/housing-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">库车市2025年棚户区（城中村）改造项目初步设计及施工图设计竞争性磋商公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目概况：库车市2025年棚户区（城中村）改造项目初步设计及施工图设计采购项目的潜在供应商应于2026年05月20日10:30前提交响应文件。</p>
          <p>简要规格描述：本次工程的初步设计、施工图设计编制工作（含方案设计、施工期间的配合服务）。</p>
          <p>地 址：阿克苏市解放北路御城青山商业综合体御城大厦A座12楼。</p>
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

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["buildingCategories"] == ["housing"]
    assert payload["builtAssetTypes"] == ["housing"]
    assert payload["projectModes"] == ["renovation"]


def test_collect_ggzy_documents_drops_generic_construction_project_from_new_build_when_notice_is_renovation() -> (
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
                    "id": "health-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "政府采购",
                    "informationType": "0201",
                    "informationTypeText": "采购/资审公告",
                    "provinceText": "广西壮族自治区",
                    "title": "防城港市防城区人民医院医共体能力提升建设项目初步设计、方案设计、施工图编制设计服务的竞争性磋商公告",
                    "url": "/information/deal/html/a/450000/0201/20260508/health-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">防城港市防城区人民医院医共体能力提升建设项目初步设计、方案设计、施工图编制设计服务的竞争性磋商公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目名称：防城港市防城区人民医院医共体能力提升建设项目初步设计、方案设计、施工图编制设计服务</p>
          <p>采购需求：拟对防城区人民医院及3个乡镇卫生院进行改建，总改建建筑面积17525.50平方米。</p>
          <p>响应文件提交截止时间：2026年05月19日13时30分。</p>
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

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["projectModes"] == ["renovation"]


def test_collect_ggzy_documents_keeps_listing_level_record_without_deadline_when_detail_fails() -> (
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
        "data": {
            "records": [
                {
                    "id": "retry-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "政府采购",
                    "informationType": "0201",
                    "informationTypeText": "采购/资审公告",
                    "provinceText": "广西壮族自治区",
                    "title": "防城港市防城区人民医院医共体能力提升建设项目初步设计、方案设计、施工图编制设计服务竞争性磋商公告",
                    "url": "/information/deal/html/a/450000/0201/20260508/retry-001.html",
                }
            ]
        },
    }
    attempts = {"count": 0}

    def failing_fetch_detail(_url: str) -> str:
        # The shared HTTP client already retried this GET before giving up.
        attempts["count"] += 1
        raise TimeoutError("detail page unreachable")

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=lambda _url, _data: json.dumps(list_payload, ensure_ascii=False),
        fetch_detail=failing_fetch_detail,
        today=date(2026, 5, 9),
    )

    assert attempts["count"] == 1
    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["evidenceLevel"] == "official_listing"
    # Without the detail page there is no deadline evidence, so none is invented.
    assert "deadline" not in payload


def test_collect_ggzy_documents_retries_list_fetch_before_filtering() -> None:
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
                    "id": "retry-list-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "贵州省",
                    "title": "贵阳观城运小龙滩地产项目会所室内设计招标公告",
                    "url": "/information/deal/html/a/520000/0101/20260507/retry-list-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">贵阳观城运小龙滩地产项目会所室内设计招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>招标人：贵阳观城运地产开发有限公司</p>
          <p>项目编号：GY-INTERIOR-2026-001</p>
          <p>投标文件递交截止时间：2026年05月21日 09时30分</p>
          <p>项目规模：会所室内设计及精装修设计服务。</p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()

    attempts = {"count": 0}

    def flaky_fetch_list(_url: str, _data: dict[str, str]) -> str:
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise IncompleteRead(b"partial", 10)
        return json.dumps(list_payload, ensure_ascii=False)

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=flaky_fetch_list,
        fetch_detail=lambda _url: detail_html,
        today=date(2026, 5, 9),
    )

    assert attempts["count"] >= 2
    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["title"] == "贵阳观城运小龙滩地产项目会所室内设计招标公告"
