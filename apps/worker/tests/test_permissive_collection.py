from __future__ import annotations

import json
from datetime import date

from support import build_source

from arch_competition_ops.collectors.ggzy import collect_ggzy_documents
from arch_competition_ops.collectors.tenderned import collect_tenderned_documents


def test_china_ai_mode_reads_candidates_before_domain_and_listing_type_gates():
    source = build_source(
        "china",
        collector="ggzy_public_notices",
        jurisdiction="china",
        name="China",
        base_url="https://www.ggzy.gov.cn/",
        scan_method="api",
        extractor="generic_listing_html",
    )
    rows = [
        {"id": "bridge", "title": "桥梁工程设计与施工", "informationType": "9999"},
        {"id": "unknown", "title": "城市空间更新综合服务", "informationType": ""},
    ]
    for row in rows:
        row.update(url=f"/notice/{row['id']}", publishTime="2026-10-30")
    fetch_list = lambda *_: json.dumps({"data": {"records": rows}})  # noqa: E731
    fetch_detail = lambda _: "<h1>项目公告</h1><p>详细工作范围待核实。</p>"  # noqa: E731
    kwargs = dict(fetch_list=fetch_list, fetch_detail=fetch_detail, today=date(2026, 10, 30))
    assert collect_ggzy_documents(source, **kwargs) == []
    documents = collect_ggzy_documents(source, include_unclassified=True, **kwargs)
    assert len(documents) == 2
    assert all("rawNoticeHtml" in json.loads(d.payload) for d in documents)


def test_netherlands_ai_mode_retains_unknown_scope_and_missing_deadline():
    source = build_source(
        "nl",
        collector="tenderned_publications_api",
        jurisdiction="netherlands",
        name="NL",
        base_url="https://www.tenderned.nl/",
        scan_method="api",
        extractor="generic_listing_html",
    )
    source.base_url = "https://www.tenderned.nl/publicaties"
    row = {
        "publicatieId": "123",
        "aanbestedingNaam": "Unfamiliar project",
        "publicatiestatus": {"code": "PUB"},
        "typePublicatie": {"code": "CHANGE"},
        "typeOpdracht": {"code": "W"},
    }
    fetcher = lambda url: {"content": [row], "last": True} if "?" in url else row  # noqa: E731
    assert collect_tenderned_documents(source, fetch_json=fetcher) == []
    documents = collect_tenderned_documents(source, fetch_json=fetcher, include_unclassified=True)
    assert len(documents) == 1
    assert json.loads(documents[0].payload)["deadline"] is None
