from __future__ import annotations

import json
from datetime import date

from support import build_source as _build_source

from arch_competition_ops.collectors.ggzy import collect_ggzy_documents


def test_collect_ggzy_documents_keeps_building_and_interior_design_notices_only() -> None:
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
                    "id": "keep-001",
                    "publishTime": "2026-05-07",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "贵州省",
                    "title": "贵阳观城运小龙滩地产项目会所室内设计招标公告",
                    "url": "/information/deal/html/a/520000/0101/20260507/keep-001.html",
                },
                {
                    "id": "drop-001",
                    "publishTime": "2026-05-09",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "河北省",
                    "title": "冀南新区庭院小区地下管网改造工程设计施工工程总承包（EPC）",
                    "url": "/information/deal/html/a/130000/0101/20260509/drop-001.html",
                },
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">贵阳观城运小龙滩地产项目会所室内设计招标公告</h4>
      <p class="p_o">
        <span>发布时间：2026-05-07 00:00</span>
        <span class='detail_url'>
          <a target="_blank" href="https://example.cn/original/interior" >原文链接地址</a>
        </span>
      </p>
      <div id="mycontent">
        <div class="detail_content">
          <p>招标人：贵阳观城运地产开发有限公司</p>
          <p>项目编号：GY-INTERIOR-2026-001</p>
          <p>投标文件递交截止时间：2026年05月21日 09时30分</p>
          <p>招标控制价：580000 元</p>
          <p>项目规模：会所室内设计及精装修设计服务。</p>
        </div>
      </div>
    </div>
  </body>
</html>
""".strip()

    def fake_fetch_list(_url: str, data: dict[str, str]) -> str:
        assert data["SOURCE_TYPE"] == "1"
        assert data["PAGENUMBER"] == "1"
        return json.dumps(list_payload, ensure_ascii=False)

    def fake_fetch_detail(url: str) -> str:
        assert "keep-001" in url
        return detail_html

    documents = collect_ggzy_documents(
        source,
        limit=5,
        publication_date_from="2026-05-01",
        fetch_list=fake_fetch_list,
        fetch_detail=fake_fetch_detail,
        today=date(2026, 5, 8),
    )

    assert len(documents) == 1
    document = documents[0]
    assert document.source_url.endswith("/html/b/520000/0101/20260507/keep-001.html")

    payload = json.loads(document.payload)
    assert payload["title"] == "贵阳观城运小龙滩地产项目会所室内设计招标公告"
    assert payload["buyer"] == "贵阳观城运地产开发有限公司"
    assert payload["noticeId"] == "GY-INTERIOR-2026-001"
    assert payload["deadline"] == "2026-05-21"
    assert payload["officialUrl"] == "https://example.cn/original/interior"
    assert payload["estimatedValueText"] == "CNY 580000"
    assert payload["procedureType"] == "open"
    assert payload["evidenceLevel"] == "official_notice"
    assert "interior_project" in payload["projectTypes"]
    assert payload["buildingCategories"] == ["sport_leisure"]
    assert "architecture" in payload["competitionTypes"]
    assert "interior" in payload["competitionTypes"]
    assert "interior" in payload["builtAssetTypes"]
    assert "interior_design" in payload["designScopes"]
    assert "室内设计" in payload["summary"]


def test_collect_ggzy_documents_excludes_hard_negative_domain_notices_after_detail_validation() -> (
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
                    "id": "oil-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "政府采购",
                    "informationType": "0201",
                    "informationTypeText": "采购/资审公告",
                    "provinceText": "新疆维吾尔自治区",
                    "title": "新疆伊宁凹陷曲鲁海次凹油气资源调查评价钻探地质工程方案设计综合研究技术服务公开招标公告",
                    "url": "/information/deal/html/a/650000/0201/20260508/oil-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">新疆伊宁凹陷曲鲁海次凹油气资源调查评价钻探地质工程方案设计综合研究技术服务公开招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>采购方式：公开招标</p>
          <p>预算金额：800000 元</p>
          <p>简要规格描述：油气资源调查评价钻探地质工程方案设计综合研究技术服务。</p>
          <p>合同履约期限：完成井位设计、钻井地质设计、钻井工程设计。</p>
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
        today=date(2026, 5, 8),
    )

    assert documents == []


def test_collect_ggzy_documents_excludes_soft_negative_rural_notices_without_strong_built_signals() -> (
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
                    "id": "rural-001",
                    "publishTime": "2026-05-09",
                    "businessTypeText": "政府采购",
                    "informationType": "0201",
                    "informationTypeText": "采购/资审公告",
                    "provinceText": "江西省",
                    "title": "遂川县2026年和美乡村建设项目初步设计服务（第2次）",
                    "url": "/information/deal/html/a/360000/0201/20260509/rural-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">遂川县2026年和美乡村建设项目初步设计服务（第2次）</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目名称：遂川县2026年和美乡村建设项目初步设计服务（第2次）</p>
          <p>采购方式：竞争性磋商</p>
          <p>采购人信息 名称：遂川县农业农村局</p>
          <p>项目内容：农村人居环境整治、村庄基础设施完善等前期设计服务。</p>
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
        today=date(2026, 5, 8),
    )

    assert documents == []


def test_collect_ggzy_documents_excludes_tourism_mining_notices_without_primary_building_focus() -> (
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
                    "id": "tourism-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "广东省",
                    "title": "龙江镇矿山遗址生态旅游融合项目方案设计及初步设计（第二次招标）【设计】招标公告",
                    "url": "/information/deal/html/a/440000/0101/20260508/tourism-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">龙江镇矿山遗址生态旅游融合项目方案设计及初步设计（第二次招标）【设计】招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>招标项目名称：龙江镇矿山遗址生态旅游融合项目方案设计及初步设计（第二次招标）</p>
          <p>招标内容：包括但不限于方案设计、方案修改、初步设计（含方案深化等）、概算编制工作等。</p>
          <p>主要建设内容包括工业遗存改造11001平方米，新建游客服务中心800平方米，新建一级运动服务中心600平方米，二级运动服务中心300平方米，配套建设停车场13500平方米，以及公共厕所、园区道路工程、大门、攀岩体验设施、矿坑周边地块绿化等基础配套设施。</p>
          <p>投标人须具有工程设计综合甲级资质或建筑行业乙级及以上资质，设计项目负责人具有一级注册建筑师执业资格。</p>
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
        today=date(2026, 5, 8),
    )

    assert documents == []
