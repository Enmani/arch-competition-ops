from __future__ import annotations

import json
from datetime import date

from support import build_source as _build_source

from arch_competition_ops.collectors.ggzy import collect_ggzy_documents


def test_collect_ggzy_documents_extracts_deadline_from_iso_style_beijing_notice() -> None:
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
                    "id": "bj-001",
                    "publishTime": "2026-05-07",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "北京市",
                    "title": "十一学校延庆校区项目（方案设计、初步设计）招标公告",
                    "url": "/information/deal/html/a/110000/0101/20260507/bj-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">十一学校延庆校区项目（方案设计、初步设计）招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <h3>六、投标文件的递交</h3>
          <div>递交截止时间：2026-05-28 10:30:00</div>
          <div>递交方式：现场递交文件</div>
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
    assert payload["deadline"] == "2026-05-28"


def test_collect_ggzy_documents_extracts_deadline_from_spaced_chinese_notice() -> None:
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
                    "id": "gx-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "政府采购",
                    "informationType": "0201",
                    "informationTypeText": "采购/资审公告",
                    "provinceText": "广西壮族自治区",
                    "title": "防城港市防城区人民医院医共体能力提升建设项目初步设计、方案设计、施工图编制设计服务竞争性磋商公告",
                    "url": "/information/deal/html/a/450000/0201/20260508/gx-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">防城港市防城区人民医院医共体能力提升建设项目初步设计、方案设计、施工图编制设计服务竞争性磋商公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目概况：潜在供应商应于 202 6 年 5 月 19 日 13 时 30分（北京时间）前提交响应文件。</p>
          <p>截止时间：202 6 年 5 月 19 日 13 时 30分（北京时间）</p>
          <p>采购方式：竞争性磋商</p>
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
    assert payload["deadline"] == "2026-05-19"


def test_collect_ggzy_documents_extracts_deadline_from_sichuan_word_html_template() -> None:
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
                    "id": "sc-001",
                    "publishTime": "2026-05-07",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "四川省",
                    "title": "叙州丽雅拟建地块方案设计（二次）招标招标公告",
                    "url": "/information/deal/html/a/510000/0101/20260507/sc-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">叙州丽雅拟建地块方案设计（二次）招标招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <!DOCTYPE html>
          <html>
            <head><title></title></head>
            <body>
              <div>招标范围：叙州丽雅拟建地块建设项目建筑概念方案设计、建筑方案设计。</div>
              <div>5.1 投标文件递交的截止时间（投标截止时间，下同）为 2026-05-28 09:00。</div>
              <div>3.1.1资质要求：具备建筑行业（建筑工程）设计乙级及以上资质。</div>
            </body>
          </html>
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
    assert payload["deadline"] == "2026-05-28"


def test_collect_ggzy_documents_extracts_deadline_from_fujian_word_export_notice() -> None:
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
                    "id": "fj-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "福建省",
                    "title": "石狮市黄金海岸国际度假酒店设计服务（招标公告）",
                    "url": "/information/deal/html/a/350000/0101/20260508/fj-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">石狮市黄金海岸国际度假酒店设计服务（招标公告）</h4>
      <div id="mycontent">
        <div class="detail_content">
          <html xmlns="http://www.w3.org/TR/REC-html40">
            <head>
              <meta http-equiv="Content-Type" content="text/html; charset=gb2312">
              <title>Word Export</title>
            </head>
            <body>
              <p>项目名称：石狮市黄金海岸国际度假酒店设计服务</p>
              <p>投标截止时间：2026年05月29日 09时30分</p>
              <p>开标时间：2026年05月29日 09时30分</p>
              <p>资质要求：建筑行业（建筑工程）甲级。</p>
            </body>
          </html>
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
    assert payload["deadline"] == "2026-05-29"
    assert "投标截止时间" in payload["summary"]


def test_collect_ggzy_documents_prefers_submission_deadline_over_opening_time() -> None:
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
                    "id": "prefer-deadline-001",
                    "publishTime": "2026-05-08",
                    "businessTypeText": "工程建设",
                    "informationType": "0101",
                    "informationTypeText": "招标/资审公告",
                    "provinceText": "山东省",
                    "title": "青岛市市民文化中心项目方案设计招标公告",
                    "url": "/information/deal/html/a/370000/0101/20260508/prefer-deadline-001.html",
                }
            ]
        },
    }

    detail_html = """
<!doctype html>
<html>
  <body>
    <div class="detail">
      <h4 class="h4_o">青岛市市民文化中心项目方案设计招标公告</h4>
      <div id="mycontent">
        <div class="detail_content">
          <p>项目名称：青岛市市民文化中心项目方案设计</p>
          <p>开标时间：2026年05月18日 09时30分</p>
          <p>投标文件递交截止时间：2026年05月19日 09时30分</p>
          <p>资质要求：投标人须具备建筑行业（建筑工程）甲级资质。</p>
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
    assert payload["deadline"] == "2026-05-19"
