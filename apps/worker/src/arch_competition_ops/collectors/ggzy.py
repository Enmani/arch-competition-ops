from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http.client import IncompleteRead
from datetime import date, timedelta
from html import unescape
from html.parser import HTMLParser
from urllib.error import HTTPError, URLError
from typing import Any
from urllib.parse import urljoin

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.collectors.common import fetch_text_get, fetch_text_post, parse_date_string, strip_html
from arch_competition_ops.models import SourceDefinition


GGZY_LIST_API_URL = "https://www.ggzy.gov.cn/information/pubTradingInfo/getTradList"
GGZY_BASE_URL = "https://www.ggzy.gov.cn"
GGZY_ALLOWED_INFORMATION_TYPES = {"0101", "0201"}
GGZY_ALLOWED_BUSINESS_TYPES = {"工程建设", "政府采购"}
GGZY_SEARCH_STRATEGIES: tuple[tuple[str, int], ...] = (
    ("室内设计", 1),
    ("精装修设计", 1),
    ("建筑设计", 1),
    ("建筑室内", 1),
    ("老旧小区改造", 1),
    ("老旧街区改造", 1),
    ("病房改造", 2),
    ("医院改造", 1),
    ("施工图设计", 2),
    ("医院施工图设计", 1),
    ("病房改造提升", 1),
    ("公共教学楼改造", 1),
    ("教学楼设计", 1),
    ("学校设计", 1),
    ("医院设计", 1),
    ("办公楼设计", 1),
    ("酒店设计", 1),
    ("文化宫", 1),
    ("居住用地", 1),
    ("托幼用地", 1),
    ("修建性详细规划", 1),
    ("方案设计", 2),
    ("初步设计", 3),
)
GGZY_LIST_FETCH_RETRIES = 3
GGZY_DEFAULT_LOOKBACK_DAYS = 45
GGZY_DETAIL_FETCH_WORKERS = 6
GGZY_POSITIVE_TITLE_MARKERS = (
    "建筑设计",
    "室内设计",
    "精装修设计",
    "建筑室内",
    "设计服务",
    "方案设计",
    "初步设计",
    "建筑方案",
    "修建性详细规划",
    "老旧小区改造",
    "教学楼",
    "学校",
    "校园",
    "医院",
    "病房改造",
    "病房",
    "住院楼",
    "门诊楼",
    "应急救治中心",
    "酒店",
    "办公楼",
    "研发办公楼",
    "图书馆",
    "文化中心",
    "景区",
    "综合体",
    "会展",
    "会所",
    "福利院",
    "养老服务中心",
    "公区",
    "住宅",
    "小区",
    "居住用地",
    "托幼用地",
    "幼儿园",
)
GGZY_NEGATIVE_TITLE_MARKERS = (
    "施工招标公告",
    "施工招标文件",
    "道路",
    "公路",
    "桥梁",
    "桥涵",
    "隧道",
    "地铁",
    "轨道",
    "地下",
    "地下管网",
    "管网",
    "管廊",
    "污水",
    "给排水",
    "海绵城市",
    "农田",
    "河道",
    "水利",
    "堤防",
    "边坡",
    "边坡治理",
    "护坡",
    "土建",
    "土木",
    "土木工程",
    "市政",
    "基础设施",
    "市政配套",
    "勘察设计施工",
    "设计施工",
    "施工图审查",
    "总承包",
    "epc",
)
GGZY_TITLE_SCORE_MARKERS: tuple[tuple[str, int], ...] = (
    ("室内设计", 8),
    ("精装修设计", 8),
    ("建筑设计", 7),
    ("建筑室内", 5),
    ("老旧小区改造", 6),
    ("教学楼", 6),
    ("学校", 5),
    ("校园", 5),
    ("医院", 5),
    ("病房改造", 5),
    ("病房", 4),
    ("住院楼", 4),
    ("门诊楼", 4),
    ("应急救治中心", 4),
    ("酒店", 4),
    ("办公楼", 4),
    ("图书馆", 4),
    ("文化中心", 4),
    ("会所", 4),
    ("福利院", 4),
    ("养老服务中心", 4),
    ("居住用地", 6),
    ("托幼用地", 6),
    ("幼儿园", 5),
    ("修建性详细规划", 3),
    ("方案设计", 2),
    ("初步设计", 2),
    ("设计服务", 1),
)
GGZY_DESIGN_SCOPE_MARKERS = (
    "室内设计",
    "装修设计",
    "精装修设计",
    "概念设计",
    "方案设计",
    "初步设计",
    "施工图设计",
    "建筑设计",
    "设计服务",
    "灯光设计",
)
GGZY_BUILT_CONTEXT_MARKERS = (
    "建筑装饰",
    "建筑方案",
    "建筑概念方案",
    "建筑方案设计",
    "居住用地",
    "居住建筑",
    "住宅",
    "小区",
    "教学楼",
    "学校",
    "校区",
    "校园",
    "托幼",
    "幼儿园",
    "医院",
    "病房",
    "住院楼",
    "门诊楼",
    "应急救治中心",
    "门诊",
    "住院楼",
    "酒店",
    "办公楼",
    "研发办公楼",
    "图书馆",
    "文化中心",
    "公共建筑",
    "福利院",
    "养老服务中心",
    "会所",
    "商业设施用地",
    "建筑装饰工程",
    "建筑行业（建筑工程）",
    "建筑行业(建筑工程)",
    "注册建筑师",
    "一级注册建筑师",
)
GGZY_BODY_POSITIVE_MARKERS: tuple[tuple[str, int], ...] = (
    ("建筑装饰工程设计专项", 5),
    ("建筑行业（建筑工程）", 4),
    ("建筑行业(建筑工程)", 4),
    ("注册建筑师", 4),
    ("一级注册建筑师", 4),
    ("室内二次机电", 3),
    ("灯光设计", 3),
    ("施工图设计", 3),
    ("概念设计", 2),
    ("方案设计", 2),
    ("初步设计", 2),
    ("商业设施用地", 3),
    ("居住建筑", 3),
    ("病房改造", 3),
    ("住院楼", 3),
    ("门诊楼", 3),
    ("福利院", 3),
    ("养老服务中心", 3),
)
GGZY_PRIMARY_BUILT_OBJECT_SCORE_MARKERS: tuple[tuple[str, int], ...] = (
    ("室内设计", 6),
    ("精装修设计", 6),
    ("建筑装饰", 4),
    ("会所", 4),
    ("酒店", 4),
    ("学校", 4),
    ("教学楼", 4),
    ("校区", 4),
    ("医院", 4),
    ("病房改造", 5),
    ("病房", 4),
    ("门诊", 4),
    ("住院楼", 4),
    ("门诊楼", 4),
    ("应急救治中心", 4),
    ("办公楼", 4),
    ("图书馆", 4),
    ("文化中心", 4),
    ("博物馆", 4),
    ("档案馆", 4),
    ("科技馆", 4),
    ("剧院", 4),
    ("展览馆", 4),
    ("会展中心", 4),
    ("市民服务中心", 4),
    ("游客中心", 3),
    ("游客服务中心", 3),
    ("住宅", 4),
    ("小区", 4),
    ("居住建筑", 4),
    ("老旧小区改造", 5),
    ("居住用地", 4),
    ("托幼用地", 4),
    ("幼儿园", 4),
    ("托育中心", 4),
    ("公共建筑", 4),
    ("福利院", 4),
    ("养老服务中心", 4),
    ("商业设施用地", 3),
    ("综合体", 3),
)
GGZY_HARD_NEGATIVE_MARKERS = (
    "油气",
    "钻探",
    "钻井",
    "地震资料解释",
    "井位设计",
    "地质工程",
    "油藏",
    "农用地土壤污染",
    "海洋牧场",
    "入河排污口",
    "绩效方案设计",
    "配套软件服务",
)
GGZY_CONTEXTUAL_SOFT_NEGATIVE_MARKERS: tuple[tuple[str, int], ...] = (
    ("和美乡村", 5),
    ("农业农村", 4),
    ("乡村", 3),
    ("生态旅游", 3),
    ("矿山", 3),
    ("排污口", 4),
    ("生态修复", 4),
    ("水利工程", 5),
    ("河道整治", 5),
    ("污染修复工程", 4),
    ("水污染防治工程", 4),
    ("防浪消浪", 4),
    ("蓝藻隔离带", 4),
    ("水体透明度恢复", 4),
    ("沉水植物", 4),
    ("生态围网", 3),
)
GGZY_SOFT_NEGATIVE_MARKERS: tuple[tuple[str, int], ...] = (
    ("和美乡村", 5),
    ("农业农村", 4),
    ("乡村", 3),
    ("生态旅游", 3),
    ("矿山", 3),
    ("排污口", 4),
    ("生态修复", 3),
    ("水利工程", 4),
    ("河道整治", 4),
    ("污染修复工程", 3),
    ("水污染防治工程", 3),
    ("污水", 3),
    ("给排水", 2),
    ("道路", 2),
    ("排水工程", 2),
    ("市政", 2),
    ("基础设施", 2),
    ("环境整治", 2),
)
GGZY_SITE_SCOPE_MARKERS: tuple[tuple[str, int], ...] = (
    ("生态修复", 3),
    ("防浪消浪", 3),
    ("蓝藻隔离带", 3),
    ("水体透明度恢复", 3),
    ("沉水植物", 3),
    ("生态围网", 2),
    ("矿坑", 3),
    ("矿山遗址", 3),
    ("园区道路", 3),
    ("道路工程", 3),
    ("停车场", 2),
    ("绿化", 2),
    ("公共厕所", 2),
    ("公厕", 2),
    ("大门", 1),
    ("攀岩", 1),
    ("景观", 2),
    ("广场铺装", 2),
    ("室外管网", 2),
)
GGZY_AUTHORITY_PATTERNS = (
    r"(?:招标人[（(]项目业主[)）]?为)\s*([^\s，。,；;]+(?:公司|局|院|中心|政府|委员会|管理处|管理局))",
    r"(?:采购人信息.*?名称[:：]\s*)(.+?)(?=(?:地址|联系方式|联系人|采购代理机构信息|$))",
    r"(?:招标人[:：]\s*)(.+?)(?=(?:招标代理机构|联系人|电话|$))",
    r"(?:采购人|采购单位|招标人|招标单位|建设单位|业主单位|项目业主|采购代理机构)[:：]\s*(.+?)(?=(?:项目编号|招标编号|采购编号|项目名称|投标文件|响应文件|招标控制价|预算金额|最高限价|采购需求|项目概况|$))",
)
GGZY_NOTICE_ID_PATTERNS = (
    r"(?:项目编号|招标编号|采购编号|项目招标编号|交易编号|项目编码)[:：]\s*([A-Za-z0-9\u4e00-\u9fff\-\(\)]+)",
)
GGZY_PROCEDURE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"(?:采购方式|招标方式)[:：]\s*公开招标", "open"),
    (r"(?:采购方式|招标方式)[:：]\s*竞争性磋商", "public_design_services_tender"),
    (r"(?:采购方式|招标方式)[:：]\s*竞争性谈判", "negotiated_procedure"),
    (r"(?:采购方式|招标方式)[:：]\s*单一来源", "negotiated_procedure"),
    (r"(?:采购方式|招标方式)[:：]\s*询价", "public_design_services_tender"),
)
GGZY_DEADLINE_PATTERNS = (
    r"(?:投标文件递交的截止时间为|投标文件递交截止时间为|投标文件递交截止时间|投标文件截止时间|投标截止时间|响应文件提交截止时间|提交截止时间|提交投标文件截止时间|递交投标文件截止时间|递交截止时间|截止时间|开启时间|开标时间)[^0-9]{0,16}((?:\d\s*){4}年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}\s*[时点:：]\s*\d{1,2}(?:\s*分)?)?)",
    r"于\s*((?:\d\s*){4}年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}\s*[时点:：]\s*\d{1,2}(?:\s*分)?)?)\s*[（(]北京时间[)）]?\s*前",
    r"(?:投标文件递交的截止时间为|投标文件递交截止时间为|投标文件递交截止时间|投标文件截止时间|投标截止时间|响应文件提交截止时间|提交截止时间|提交投标文件截止时间|递交投标文件截止时间|递交截止时间|截止时间|开启时间|开标时间)[^0-9]{0,16}(\d{4}-\d{1,2}-\d{1,2}\s+\d{1,2}:\d{2}(?::\d{2})?)",
)
GGZY_DEADLINE_LABEL_PATTERNS: tuple[tuple[str, int], ...] = (
    (r"投标文件递交的截止时间为", 12),
    (r"投标文件递交截止时间为", 12),
    (r"投标文件递交截止时间", 12),
    (r"投标文件截止时间", 11),
    (r"投标截止时间", 11),
    (r"响应文件提交截止时间", 12),
    (r"提交响应文件截止时间", 12),
    (r"响应文件截止时间", 11),
    (r"递交投标文件截止时间", 11),
    (r"提交投标文件截止时间", 11),
    (r"递交截止时间", 10),
    (r"截止时间", 8),
    (r"开启时间", 3),
    (r"开标时间", 2),
)
GGZY_META_DATE_PATTERNS: tuple[tuple[str, int], ...] = (
    (r'<meta[^>]+name="others"[^>]+content="[^"]*页面生成时间\s*([0-9]{4}-[0-9]{1,2}-[0-9]{1,2})', -20),
)
GGZY_DATE_CANDIDATE_PATTERNS: tuple[str, ...] = (
    r"((?:\d\s*){4}年\s*\d{1,2}\s*月\s*\d{1,2}\s*日(?:\s*\d{1,2}\s*[时点:：]\s*\d{1,2}(?:\s*分)?)?)",
    r"(\d{4}-\d{1,2}-\d{1,2}(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?)",
)
GGZY_DETAIL_FETCH_RETRIES = 2
GGZY_REASONABLE_DEADLINE_WINDOW_DAYS = 365
GGZY_VALUE_PATTERNS = (
    r"(?:预算金额|最高限价|招标控制价|控制价|项目估算总投资|项目估算投资|投资估算)[:：]\s*([0-9][0-9,.\s]*)\s*元",
)
GGZY_ORIGINAL_CATEGORY_NEGATIVE_MARKERS = (
    "水利工程",
    "交通工程",
    "公路工程",
    "铁路工程",
    "轨道交通",
    "港口与航道工程",
    "市政工程",
    "矿业工程",
    "环保工程",
)
GGZY_ORIGINAL_CATEGORY_POSITIVE_LABEL_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("building_construction", ("房屋建筑", "房建工程", "建筑工程")),
    ("design_consulting", ("勘察设计", "建筑设计", "建筑装饰", "装饰装修")),
)
GGZY_BUILT_ASSET_TYPE_LABEL_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("interior", ("室内设计", "精装修设计", "建筑室内", "公区")),
    ("healthcare", ("医院", "病房", "住院楼", "门诊楼", "应急救治中心", "医共体")),
    ("education", ("学校", "教学楼", "校区", "校园", "幼儿园", "托育中心")),
    ("housing", ("住宅", "小区", "居住建筑", "居住用地", "棚户区", "城中村")),
    ("office_research", ("办公楼", "研发办公楼", "科研楼", "产业园")),
    ("civic_culture", ("图书馆", "文化中心", "文化宫", "博物馆", "档案馆", "科技馆", "剧院", "展览馆", "会展中心", "市民服务中心")),
    ("welfare", ("福利院", "养老服务中心")),
    ("hospitality_commercial", ("酒店", "会所", "商业设施用地", "综合体")),
    ("land_use_planning", ("托幼用地",)),
    ("urban_renewal", ("老旧小区改造", "老旧街区", "街区修复", "城市更新", "片区改造")),
)
GGZY_DESIGN_SCOPE_LABEL_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("interior_design", ("室内设计", "装修设计", "精装修设计", "建筑室内", "灯光设计")),
    ("architectural_design", ("建筑设计", "建筑方案", "建筑概念方案", "建筑方案设计")),
    ("scheme", ("概念设计", "方案设计")),
    ("preliminary", ("初步设计",)),
    ("construction_docs", ("施工图设计",)),
    ("planning", ("修建性详细规划",)),
    ("design_service", ("设计服务",)),
)
GGZY_PROJECT_MODE_LABEL_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("renovation", ("改造", "提升", "修缮", "修复", "更新", "加固")),
    ("extension", ("扩建", "改扩建")),
    ("new_build", ("新建", "建设项目", "拟建地块")),
)
GGZY_CLASSIFICATION_STOP_MARKERS = (
    "投标人资格要求",
    "申请人资格要求",
    "供应商资格要求",
    "资格要求",
    "资格审查",
    "地 址：",
    "地址：",
    "联系人：",
    "联系电话：",
    "电 话：",
    "电话：",
    "获取招标文件",
    "获取采购文件",
    "响应文件提交",
    "响应文件开启",
    "投标文件的递交",
    "投标文件递交",
    "投标保证金",
    "评标办法",
    "采购人信息",
    "联系方式",
    "招标代理机构",
)
GGZY_EXPLICIT_NEW_BUILD_MARKERS = ("新建", "拟建地块")
GGZY_NEGATIVE_DOMAIN_LABEL_MARKERS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("transport", ("道路", "公路", "桥梁", "桥涵", "隧道", "地铁", "轨道", "铁路", "港口", "航道", "交通工程")),
    ("underground", ("地下", "地下管网", "管网", "管廊", "综合管廊", "给排水", "污水")),
    ("water", ("水利", "水务", "河道", "堤防", "排污口", "防浪消浪", "蓝藻隔离带", "水体透明度恢复", "沉水植物", "生态围网")),
    ("ecology_environment", ("生态修复", "污染修复工程", "水污染防治工程", "环境整治")),
    ("mining", ("矿山", "矿坑", "矿业工程")),
    ("agriculture_rural", ("和美乡村", "农业农村", "农田", "乡村")),
)
GGZY_BUILDING_DISCIPLINE_MARKERS = (
    "建筑行业（建筑工程）",
    "建筑行业(建筑工程)",
    "建筑装饰工程设计专项",
    "注册建筑师",
    "一级注册建筑师",
)
GGZY_ORIGINAL_CATEGORY_PROBE_MARKERS = (
    "生态修复",
    "水利工程",
    "河道整治",
    "污染修复",
    "水污染防治",
    "防浪消浪",
    "蓝藻隔离带",
    "水体透明度恢复",
    "沉水植物",
    "生态围网",
    "道路",
    "桥梁",
    "隧道",
    "轨道",
    "市政",
    "污水",
    "给排水",
    "管网",
    "排污口",
    "矿山",
)
GGZY_AMBIGUOUS_BUILT_ASSET_LABELS = frozenset({"urban_renewal"})


@dataclass(frozen=True)
class GGZYNoticeFeatures:
    official_positive_sectors: frozenset[str]
    built_asset_types: frozenset[str]
    design_scopes: frozenset[str]
    project_modes: frozenset[str]
    negative_domains: frozenset[str]
    has_building_discipline: bool


def _map_project_types(features: GGZYNoticeFeatures) -> list[str]:
    project_types: list[str] = []
    if "urban_renewal" in features.built_asset_types:
        project_types.append("urban_regeneration")
    if "planning" in features.design_scopes:
        project_types.append("urban_planning")
    if "interior_design" in features.design_scopes or "interior" in features.built_asset_types:
        project_types.append("interior_project")
    if _has_strong_built_asset(features) or features.has_building_discipline or features.official_positive_sectors:
        project_types.append("building_project")
    return list(dict.fromkeys(project_types))


def _map_building_categories(features: GGZYNoticeFeatures) -> list[str]:
    building_categories: list[str] = []
    if "healthcare" in features.built_asset_types:
        building_categories.append("healthcare")
    if "education" in features.built_asset_types:
        building_categories.append("education")
    if "housing" in features.built_asset_types:
        building_categories.append("housing")
    if {"civic_culture", "welfare", "office_research"} & set(features.built_asset_types):
        building_categories.append("civic_public")
    if "hospitality_commercial" in features.built_asset_types:
        building_categories.append("sport_leisure")
    return list(dict.fromkeys(building_categories))


def _map_competition_types(features: GGZYNoticeFeatures) -> list[str]:
    competition_types = ["architecture"]
    if "interior_design" in features.design_scopes or "interior" in features.built_asset_types:
        competition_types.append("interior")
    if "healthcare" in features.built_asset_types:
        competition_types.append("healthcare")
    if "education" in features.built_asset_types:
        competition_types.append("education")
    if "housing" in features.built_asset_types:
        competition_types.append("housing")
    if {"civic_culture", "welfare", "office_research"} & set(features.built_asset_types):
        competition_types.append("public_building")
    if "urban_renewal" in features.built_asset_types or "renovation" in features.project_modes:
        competition_types.append("adaptive_reuse")
    if "planning" in features.design_scopes:
        competition_types.append("masterplan")
    return list(dict.fromkeys(competition_types))


def _default_fetch_list(url: str, data: dict[str, Any]) -> str:
    return fetch_text_post(url, data)


def _default_fetch_detail(url: str) -> str:
    return fetch_text_get(url)


def _fetch_list_with_retries(
    url: str,
    data: dict[str, Any],
    *,
    fetch_list: callable,
    attempts: int = GGZY_LIST_FETCH_RETRIES,
) -> str:
    last_error: Exception | None = None
    for attempt in range(attempts):
        try:
            return fetch_list(url, data)
        except (TimeoutError, IncompleteRead, URLError, HTTPError) as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
    assert last_error is not None
    raise last_error


def _normalize_space(value: str | None) -> str | None:
    if not value:
        return None
    collapsed = re.sub(r"\s+", " ", unescape(value))
    return collapsed.strip() or None


def _strip_html_block(value: str | None) -> str | None:
    return _normalize_space(strip_html(value))


class _GGZYDetailContentTextParser(HTMLParser):
    _BLOCK_TAGS = {
        "article",
        "blockquote",
        "br",
        "div",
        "h1",
        "h2",
        "h3",
        "h4",
        "h5",
        "h6",
        "li",
        "p",
        "section",
        "table",
        "td",
        "th",
        "tr",
    }
    _IGNORED_TAGS = {"head", "link", "meta", "noscript", "script", "style", "title"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._capture_depth = 0
        self._ignored_depth = 0
        self._parts: list[str] = []

    @staticmethod
    def _has_detail_content_class(attrs: list[tuple[str, str | None]]) -> bool:
        for name, value in attrs:
            if name.lower() != "class" or not value:
                continue
            if "detail_content" in re.split(r"\s+", value):
                return True
        return False

    @classmethod
    def _is_ignored_tag(cls, tag: str) -> bool:
        normalized_tag = tag.lower()
        return normalized_tag in cls._IGNORED_TAGS or normalized_tag == "xml" or ":" in normalized_tag

    def _push_break(self) -> None:
        if not self._parts:
            return
        if self._parts[-1] == " ":
            self._parts.pop()
        if self._parts and self._parts[-1] != "\n":
            self._parts.append("\n")

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if self._capture_depth == 0:
            if not self._has_detail_content_class(attrs):
                return
            self._capture_depth = 1
        else:
            self._capture_depth += 1

        if self._is_ignored_tag(normalized_tag):
            self._ignored_depth += 1
            return
        if normalized_tag in self._BLOCK_TAGS:
            self._push_break()

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        self.handle_endtag(tag)

    def handle_endtag(self, tag: str) -> None:
        if self._capture_depth == 0:
            return

        normalized_tag = tag.lower()
        if self._ignored_depth == 0 and normalized_tag in self._BLOCK_TAGS:
            self._push_break()
        if self._is_ignored_tag(normalized_tag) and self._ignored_depth > 0:
            self._ignored_depth -= 1

        self._capture_depth -= 1

    def handle_data(self, data: str) -> None:
        if self._capture_depth == 0 or self._ignored_depth > 0:
            return
        text = re.sub(r"\s+", " ", unescape(data)).strip()
        if not text:
            return
        if self._parts and self._parts[-1] not in {" ", "\n"}:
            self._parts.append(" ")
        self._parts.append(text)

    def get_text(self) -> str | None:
        if not self._parts:
            return None
        text = "".join(self._parts)
        text = re.sub(r"[ \t]*\n[ \t]*", "\n", text)
        text = re.sub(r"\n{2,}", "\n", text)
        return text.strip() or None


def _matches_negative_title(title: str) -> bool:
    lowered = title.lower()
    return any(marker in lowered for marker in GGZY_NEGATIVE_TITLE_MARKERS)


def _matches_positive_title(title: str) -> bool:
    return any(marker in title for marker in GGZY_POSITIVE_TITLE_MARKERS)


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    return any(marker in text for marker in markers)


def _weighted_score(text: str, markers: tuple[tuple[str, int], ...]) -> int:
    return sum(weight for marker, weight in markers if marker in text)


def _soft_negative_penalty(text: str) -> int:
    return sum(weight for marker, weight in GGZY_SOFT_NEGATIVE_MARKERS if marker in text)


def _contextual_negative_penalty(text: str) -> int:
    return sum(weight for marker, weight in GGZY_CONTEXTUAL_SOFT_NEGATIVE_MARKERS if marker in text)


def _extract_notice_context(record: dict[str, Any], detail_html: str | None) -> tuple[str, str]:
    title = _extract_detail_title(detail_html or "") or _normalize_space(str(record.get("title") or "")) or "Untitled notice"
    body_text = _extract_notice_body_text(detail_html or "") or ""
    return title, body_text


def _classification_text_from_notice(title: str, body_text: str) -> str:
    truncated_body = body_text
    stop_indexes = [
        index
        for marker in GGZY_CLASSIFICATION_STOP_MARKERS
        if (index := body_text.find(marker)) > 0
    ]
    if stop_indexes:
        truncated_body = body_text[: min(stop_indexes)]
    return f"{title.lower()} {truncated_body.lower()}".strip()


def _collect_feature_labels(text: str, label_markers: tuple[tuple[str, tuple[str, ...]], ...]) -> frozenset[str]:
    labels = {
        label
        for label, markers in label_markers
        if any(marker in text for marker in markers)
    }
    return frozenset(labels)


def _extract_notice_features(
    *,
    combined_text: str,
    classification_text: str | None,
    original_category_text: str | None,
) -> GGZYNoticeFeatures:
    category_text = (original_category_text or "").strip()
    feature_text = classification_text or combined_text
    official_positive_sectors = _collect_feature_labels(category_text, GGZY_ORIGINAL_CATEGORY_POSITIVE_LABEL_MARKERS)
    built_asset_types = _collect_feature_labels(feature_text, GGZY_BUILT_ASSET_TYPE_LABEL_MARKERS)
    design_scopes = _collect_feature_labels(feature_text, GGZY_DESIGN_SCOPE_LABEL_MARKERS)
    project_modes = _collect_feature_labels(feature_text, GGZY_PROJECT_MODE_LABEL_MARKERS)
    negative_domains = _collect_feature_labels(f"{category_text} {combined_text}".strip(), GGZY_NEGATIVE_DOMAIN_LABEL_MARKERS)
    has_building_discipline = any(marker in combined_text for marker in GGZY_BUILDING_DISCIPLINE_MARKERS)
    if (
        "new_build" in project_modes
        and "renovation" in project_modes
        and not any(marker in feature_text for marker in GGZY_EXPLICIT_NEW_BUILD_MARKERS)
    ):
        project_modes = frozenset(mode for mode in project_modes if mode != "new_build")
    if "interior_design" in design_scopes:
        built_asset_types = frozenset({*built_asset_types, "interior"})
    if "architectural_design" in design_scopes and ("education" in built_asset_types or "healthcare" in built_asset_types):
        built_asset_types = frozenset({*built_asset_types})
    return GGZYNoticeFeatures(
        official_positive_sectors=official_positive_sectors,
        built_asset_types=built_asset_types,
        design_scopes=design_scopes,
        project_modes=project_modes,
        negative_domains=negative_domains,
        has_building_discipline=has_building_discipline,
    )


def _has_strong_built_asset(features: GGZYNoticeFeatures) -> bool:
    return bool(features.built_asset_types - GGZY_AMBIGUOUS_BUILT_ASSET_LABELS)


def _is_building_target_notice(features: GGZYNoticeFeatures) -> bool:
    has_design_scope = bool(features.design_scopes)
    has_strong_built_asset = _has_strong_built_asset(features)
    has_positive_sector = bool(features.official_positive_sectors)
    has_negative_domain = bool(features.negative_domains)
    has_building_support = has_positive_sector or features.has_building_discipline
    has_only_ambiguous_asset = bool(features.built_asset_types) and not has_strong_built_asset
    is_urban_renewal = "urban_renewal" in features.built_asset_types
    is_planning_land_use = "planning" in features.design_scopes and "land_use_planning" in features.built_asset_types

    if has_negative_domain and not has_strong_built_asset and not has_building_support:
        return False
    if has_negative_domain and has_only_ambiguous_asset and not has_building_support:
        return False
    if not has_design_scope:
        return False
    if has_strong_built_asset:
        return True
    if is_planning_land_use:
        return True
    if "architectural_design" in features.design_scopes and features.has_building_discipline:
        return True
    if has_positive_sector and features.has_building_discipline:
        return True
    if is_urban_renewal and has_building_support:
        return True
    return has_building_support and bool(features.built_asset_types)


def _assess_notice_relevance(
    *,
    title: str,
    body_text: str,
    detail_available: bool,
    original_category_text: str | None = None,
) -> tuple[bool, int]:
    title_text = title.lower()
    body_lower = body_text.lower()
    combined_text = f"{title_text} {body_lower}".strip()
    classification_text = _classification_text_from_notice(title, body_text)

    if _matches_negative_original_category(original_category_text):
        return False, -120

    if _contains_any(combined_text, GGZY_HARD_NEGATIVE_MARKERS):
        return False, -100

    has_design_scope = _contains_any(combined_text, GGZY_DESIGN_SCOPE_MARKERS)
    has_built_context = _contains_any(combined_text, GGZY_BUILT_CONTEXT_MARKERS)
    features = _extract_notice_features(
        combined_text=combined_text,
        classification_text=classification_text,
        original_category_text=original_category_text,
    )
    title_score = _weighted_score(title_text, GGZY_TITLE_SCORE_MARKERS)
    body_score = _weighted_score(combined_text, GGZY_BODY_POSITIVE_MARKERS)
    primary_built_object_score = _weighted_score(combined_text, GGZY_PRIMARY_BUILT_OBJECT_SCORE_MARKERS)
    negative_penalty = _soft_negative_penalty(combined_text)
    contextual_negative_penalty = _contextual_negative_penalty(combined_text)
    site_scope_penalty = _weighted_score(combined_text, GGZY_SITE_SCOPE_MARKERS)

    score = title_score + body_score + primary_built_object_score - negative_penalty
    if contextual_negative_penalty:
        score -= site_scope_penalty
    if has_design_scope:
        score += 2
    if has_built_context:
        score += 3
    else:
        score -= 3
    if features.official_positive_sectors:
        score += 3
    if features.has_building_discipline:
        score += 2
    if _has_strong_built_asset(features):
        score += 2
    if features.negative_domains:
        score -= 3 * len(features.negative_domains)

    if contextual_negative_penalty >= 5 and primary_built_object_score == 0:
        return False, score
    if contextual_negative_penalty >= 3 and site_scope_penalty >= primary_built_object_score + 3:
        return False, score
    if not _is_building_target_notice(features):
        return False, score
    if detail_available:
        return score >= 7, score
    return score >= 10, score


def _is_allowed_listing(record: dict[str, Any]) -> bool:
    information_type = str(record.get("informationType") or "").strip()
    if information_type not in GGZY_ALLOWED_INFORMATION_TYPES:
        return False

    business_type = str(record.get("businessTypeText") or "").strip()
    if business_type and business_type not in GGZY_ALLOWED_BUSINESS_TYPES:
        return False

    title = str(record.get("title") or "").strip()
    if not title or _matches_negative_title(title):
        return False

    return _matches_positive_title(title)


def _title_score(title: str) -> int:
    score = 0
    for marker, weight in GGZY_TITLE_SCORE_MARKERS:
        if marker in title:
            score += weight
    return score


def _detail_url_from_listing(source: SourceDefinition, raw_url: str | None) -> str:
    relative_url = (raw_url or "").strip()
    if not relative_url:
        return source.base_url
    detail_url = relative_url.replace("/html/a/", "/html/b/")
    return urljoin(GGZY_BASE_URL, detail_url)


def _sanitize_extracted_value(value: str | None) -> str | None:
    candidate = _normalize_space(value)
    if not candidate:
        return None
    candidate = re.split(
        r"\s+(?=(?:"
        r"项目编号|招标编号|采购编号|项目招标编号|交易编号|项目编码|"
        r"项目名称|投标文件|响应文件|招标控制价|预算金额|最高限价|"
        r"采购需求|项目概况|项目内容|简要规格描述|合同履约期限|"
        r"联系人|联系方式|电话|地址|采购方式|招标方式|"
        r"招标代理机构|采购代理机构信息|采购代理机构"
        r")[:：])",
        candidate,
        maxsplit=1,
    )[0]
    return candidate.strip(" ，,；;。")


def _extract_first(patterns: tuple[str, ...], text: str) -> str | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        for pattern in patterns:
            match = re.search(pattern, line, flags=re.IGNORECASE)
            if match:
                candidate = _sanitize_extracted_value(match.group(1))
                if candidate:
                    return candidate

    for pattern in patterns:
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            candidate = _sanitize_extracted_value(match.group(1))
            if candidate:
                return candidate
    return None


def _extract_procedure_type(text: str, business_type_text: str | None, information_type_text: str | None) -> str | None:
    for pattern, normalized_value in GGZY_PROCEDURE_PATTERNS:
        if re.search(pattern, text, flags=re.IGNORECASE):
            return normalized_value

    business_type = (business_type_text or "").strip()
    information_type = (information_type_text or "").strip()
    if business_type == "政府采购":
        return "public_design_services_tender"
    if "招标" in information_type:
        return "open"
    return None


def _parse_ggzy_date_candidate(raw_value: str | None) -> str | None:
    normalized = _normalize_space(raw_value) or ""
    if not normalized:
        return None

    chinese_match = re.search(
        r"((?:\d\s*){4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日",
        normalized,
    )
    if chinese_match:
        year = int(re.sub(r"\s+", "", chinese_match.group(1)))
        month = int(chinese_match.group(2))
        day = int(chinese_match.group(3))
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None

    iso_match = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", normalized)
    if iso_match:
        year = int(iso_match.group(1))
        month = int(iso_match.group(2))
        day = int(iso_match.group(3))
        try:
            return date(year, month, day).isoformat()
        except ValueError:
            return None

    return parse_date_string(normalized)


def _parse_iso_date_value(raw_value: str | None) -> date | None:
    parsed = _parse_ggzy_date_candidate(raw_value)
    if not parsed:
        return None
    try:
        return date.fromisoformat(parsed)
    except ValueError:
        return None


def _score_deadline_label(label_text: str) -> int:
    for pattern, score in GGZY_DEADLINE_LABEL_PATTERNS:
        if re.search(pattern, label_text, flags=re.IGNORECASE):
            return score
    return 0


def _score_deadline_context(context_text: str) -> int:
    score = _score_deadline_label(context_text)
    if "北京时间" in context_text:
        score += 1
    if "前提交" in context_text or "提交响应文件" in context_text:
        score += 2
    if "前递交" in context_text or "递交投标文件" in context_text:
        score += 2
    return score


def _is_reasonable_deadline(
    parsed_deadline: date,
    *,
    published_at_iso: str | None,
) -> bool:
    if not published_at_iso:
        return True
    try:
        published_at = date.fromisoformat(published_at_iso)
    except ValueError:
        return True
    delta_days = (parsed_deadline - published_at).days
    return -7 <= delta_days <= GGZY_REASONABLE_DEADLINE_WINDOW_DAYS


def _find_deadline_candidates_from_structured_html(detail_html: str) -> list[tuple[int, str]]:
    candidates: list[tuple[int, str]] = []
    for pattern, score in GGZY_META_DATE_PATTERNS:
        for match in re.finditer(pattern, detail_html, flags=re.IGNORECASE):
            parsed = _parse_ggzy_date_candidate(match.group(1))
            if parsed:
                candidates.append((score, parsed))
    return candidates


def _find_deadline_candidates_from_text(text: str) -> list[tuple[int, str]]:
    candidates: list[tuple[int, str]] = []
    lines = [line.strip() for line in text.splitlines() if line.strip()]

    for line in lines:
        label_score = _score_deadline_context(line)
        if label_score <= 0:
            continue
        for pattern in GGZY_DATE_CANDIDATE_PATTERNS:
            for match in re.finditer(pattern, line, flags=re.IGNORECASE):
                parsed = _parse_ggzy_date_candidate(match.group(1))
                if parsed:
                    candidates.append((label_score, parsed))

    for pattern in GGZY_DEADLINE_PATTERNS:
        for match in re.finditer(pattern, text, flags=re.IGNORECASE):
            parsed = _parse_ggzy_date_candidate(match.group(1))
            if not parsed:
                continue
            start = max(0, match.start() - 48)
            end = min(len(text), match.end() + 24)
            context = text[start:end]
            score = _score_deadline_context(context)
            candidates.append((score or 1, parsed))

    return candidates


def _choose_best_deadline_candidate(
    candidates: list[tuple[int, str]],
    *,
    published_at_iso: str | None,
) -> str | None:
    scored: list[tuple[int, str]] = []
    for score, parsed_iso in candidates:
        parsed_date = _parse_iso_date_value(parsed_iso)
        if parsed_date is None:
            continue
        if not _is_reasonable_deadline(parsed_date, published_at_iso=published_at_iso):
            continue
        scored.append((score, parsed_date.isoformat()))

    if not scored:
        return None

    scored.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return scored[0][1]


def _extract_deadline_iso(
    text: str,
    *,
    detail_html: str | None = None,
    published_at_iso: str | None = None,
) -> str | None:
    candidates: list[tuple[int, str]] = []
    if detail_html:
        candidates.extend(_find_deadline_candidates_from_structured_html(detail_html))
    candidates.extend(_find_deadline_candidates_from_text(text))
    return _choose_best_deadline_candidate(candidates, published_at_iso=published_at_iso)


def _extract_value_text(text: str) -> str | None:
    for pattern in GGZY_VALUE_PATTERNS:
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            amount = re.sub(r"\s+", "", match.group(1))
            return f"CNY {amount}"
    return None


def _extract_notice_body_html(detail_html: str) -> str | None:
    mycontent_match = re.search(r'<div[^>]+id="mycontent"[^>]*>', detail_html, flags=re.IGNORECASE)
    if mycontent_match:
        detail_match = re.search(
            r'<div[^>]+class="[^"]*\bdetail_content\b[^"]*"[^>]*>',
            detail_html[mycontent_match.end():],
            flags=re.IGNORECASE,
        )
        if detail_match:
            start = mycontent_match.end() + detail_match.end()
            depth = 1
            idx = start
            tag_pattern = re.compile(r"</?div\b[^>]*>", flags=re.IGNORECASE)
            for tag_match in tag_pattern.finditer(detail_html, start):
                tag_text = tag_match.group(0)
                if tag_text.startswith("</") or tag_text.startswith("</".upper()):
                    depth -= 1
                    if depth == 0:
                        return detail_html[start:tag_match.start()]
                else:
                    depth += 1
                idx = tag_match.end()
            if idx > start:
                return detail_html[start:idx]

    match = re.search(
        r'<div id="mycontent">\s*<div class="detail_content">(.*)</div>\s*</div>\s*</div>\s*</body>',
        detail_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return match.group(1)
    match = re.search(
        r'<div class="detail_content">(.*)</div>\s*</div>\s*</body>',
        detail_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if match:
        return match.group(1)
    return None


def _extract_notice_body_text(detail_html: str) -> str | None:
    if not detail_html:
        return None

    parser = _GGZYDetailContentTextParser()
    try:
        parser.feed(detail_html)
        parser.close()
    except Exception:  # noqa: BLE001
        parser = _GGZYDetailContentTextParser()

    body_text = parser.get_text()
    if body_text:
        return body_text

    body_html = _extract_notice_body_html(detail_html)
    if body_html:
        return _strip_html_block(body_html)
    return None


def _extract_original_link(detail_html: str) -> str | None:
    match = re.search(
        r'<a[^>]+href="([^"]+)"[^>]*>\s*原文链接地址\s*</a>',
        detail_html,
        flags=re.IGNORECASE,
    )
    return _normalize_space(match.group(1)) if match else None


def _extract_detail_title(detail_html: str) -> str | None:
    match = re.search(r'<h4[^>]*class="h4_o"[^>]*>(.*?)</h4>', detail_html, flags=re.IGNORECASE | re.DOTALL)
    return _strip_html_block(match.group(1)) if match else None


def _extract_original_category_text(original_html: str) -> str | None:
    bread_match = re.search(
        r'<div[^>]+class="[^"]*\bewb-bread\b[^"]*"[^>]*>(.*?)</div>',
        original_html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    if not bread_match:
        return None
    return _strip_html_block(bread_match.group(1))


def _fetch_original_category_text(
    official_url: str | None,
    *,
    fetch_page: callable = fetch_text_get,
) -> str | None:
    normalized_url = _normalize_space(official_url)
    if not normalized_url:
        return None
    try:
        original_html = fetch_page(
            normalized_url,
        )
    except Exception:  # noqa: BLE001
        return None
    return _extract_original_category_text(original_html)


def _matches_negative_original_category(category_text: str | None) -> bool:
    normalized = (category_text or "").strip()
    if not normalized:
        return False
    return any(marker in normalized for marker in GGZY_ORIGINAL_CATEGORY_NEGATIVE_MARKERS)


def _should_probe_original_category(title: str, body_text: str) -> bool:
    combined = f"{title} {body_text}".strip()
    if any(marker in combined for marker in GGZY_ORIGINAL_CATEGORY_PROBE_MARKERS):
        return True
    if any(marker in combined for marker in GGZY_BUILDING_DISCIPLINE_MARKERS):
        return True
    if any(marker in combined for marker in ("建筑方案", "建筑概念方案", "建筑方案设计", "修建性详细规划")):
        return True
    if any(marker in combined for marker in ("方案设计", "初步设计", "施工图设计")) and not _contains_any(combined, GGZY_BUILT_CONTEXT_MARKERS):
        return True
    return False


def _fetch_detail_with_retries(
    detail_url: str,
    *,
    fetch_detail: callable,
    attempts: int = GGZY_DETAIL_FETCH_RETRIES,
) -> str | None:
    for attempt in range(attempts):
        try:
            return fetch_detail(detail_url)
        except (TimeoutError, URLError, HTTPError):
            if attempt == attempts - 1:
                return None
        except Exception:  # noqa: BLE001
            return None
    return None


def _build_listing_payload(
    source: SourceDefinition,
    record: dict[str, Any],
    *,
    title: str,
    body_text: str,
    detail_html: str | None,
    detail_url: str,
    relevance_score: int,
    features: GGZYNoticeFeatures,
) -> dict[str, Any]:
    listing_publish_time = _normalize_space(str(record.get("publishTime") or ""))
    authority_name = _extract_first(GGZY_AUTHORITY_PATTERNS, body_text)
    official_notice_id = _extract_first(GGZY_NOTICE_ID_PATTERNS, body_text) or _normalize_space(str(record.get("id") or ""))
    official_url = _extract_original_link(detail_html or "")
    deadline = _extract_deadline_iso(body_text, detail_html=detail_html, published_at_iso=parse_date_string(listing_publish_time))
    estimated_value_text = _extract_value_text(body_text)
    procedure_type = _extract_procedure_type(
        body_text,
        _normalize_space(str(record.get("businessTypeText") or "")),
        _normalize_space(str(record.get("informationTypeText") or "")),
    )

    evidence_level = "official_notice" if detail_html else "official_listing"
    evidence_note = (
        f"Official {source.name} notice detail. Relevance score {relevance_score} after detail validation."
        if detail_html
        else f"Official {source.name} listing retained after detail fetch failed. Relevance score {relevance_score} from title-only screening."
    )

    payload: dict[str, Any] = {
        "title": title,
        "buyer": authority_name,
        "noticeId": official_notice_id,
        "deadline": deadline,
        "summary": body_text[:4000] if body_text else _normalize_space(str(record.get("title") or "")),
        "officialUrl": official_url,
        "documentsPortalUrl": official_url,
        "opportunityType": "public_design_services_procurement",
        "procedureType": procedure_type,
        "implementationPath": "service_contract_award_after_competitive_selection",
        "evidenceLevel": evidence_level,
        "evidenceNote": evidence_note,
        "publishedAt": parse_date_string(listing_publish_time),
        "estimatedValueText": estimated_value_text,
        "location": _normalize_space(str(record.get("provinceText") or "")),
        "businessType": _normalize_space(str(record.get("businessTypeText") or "")),
        "informationType": _normalize_space(str(record.get("informationTypeText") or "")),
        "detailUrl": detail_url,
        "competitionTypes": _map_competition_types(features),
        "projectTypes": _map_project_types(features),
        "buildingCategories": _map_building_categories(features),
        "officialSectors": sorted(features.official_positive_sectors),
        "builtAssetTypes": sorted(features.built_asset_types),
        "designScopes": sorted(features.design_scopes),
        "projectModes": sorted(features.project_modes),
    }

    return {key: value for key, value in payload.items() if value not in (None, "")}


def _collect_scored_document(
    source: SourceDefinition,
    record: dict[str, Any],
    *,
    detail_fetcher: callable,
) -> tuple[int, str, CollectedSourceDocument] | None:
    detail_url = _detail_url_from_listing(source, _normalize_space(str(record.get("url") or "")))
    detail_html = _fetch_detail_with_retries(detail_url, fetch_detail=detail_fetcher)

    title, body_text = _extract_notice_context(record, detail_html)
    original_category_text = None
    if detail_html and _should_probe_original_category(title, body_text):
        official_url = _extract_original_link(detail_html)
        original_category_text = _fetch_original_category_text(official_url, fetch_page=detail_fetcher)
    classification_text = _classification_text_from_notice(title, body_text)
    features = _extract_notice_features(
        combined_text=f"{title.lower()} {body_text.lower()}".strip(),
        classification_text=classification_text,
        original_category_text=original_category_text,
    )
    is_relevant, relevance_score = _assess_notice_relevance(
        title=title,
        body_text=body_text,
        detail_available=detail_html is not None,
        original_category_text=original_category_text,
    )
    if not is_relevant:
        return None

    payload = _build_listing_payload(
        source,
        record,
        title=title,
        body_text=body_text,
        detail_html=detail_html,
        detail_url=detail_url,
        relevance_score=relevance_score,
        features=features,
    )
    return (
        relevance_score,
        _normalize_space(str(record.get("publishTime") or "")) or "",
        CollectedSourceDocument(
            source_url=detail_url,
            payload=json.dumps(payload, ensure_ascii=False),
        ),
    )


def _iter_candidate_rows(
    source: SourceDefinition,
    *,
    publication_date_from: str | None,
    today: date,
    fetch_list: callable,
) -> list[dict[str, Any]]:
    start_date = publication_date_from or (today - timedelta(days=GGZY_DEFAULT_LOOKBACK_DAYS)).isoformat()
    end_date = today.isoformat()
    seen_ids: set[str] = set()
    candidates: list[dict[str, Any]] = []

    for term, page_limit in GGZY_SEARCH_STRATEGIES:
        for page_number in range(1, page_limit + 1):
            response_text = _fetch_list_with_retries(
                GGZY_LIST_API_URL,
                {
                    "SOURCE_TYPE": "1",
                    "DEAL_TIME": "02",
                    "TIMEBEGIN": start_date,
                    "TIMEEND": end_date,
                    "FINDTXT": term,
                    "PAGENUMBER": str(page_number),
                },
                fetch_list=fetch_list,
            )
            payload = json.loads(response_text)
            records = payload.get("data", {}).get("records", [])
            if not isinstance(records, list):
                break

            for record in records:
                if not isinstance(record, dict):
                    continue
                notice_id = str(record.get("id") or "").strip()
                if not notice_id or notice_id in seen_ids:
                    continue
                if publication_date_from:
                    publish_time = _normalize_space(str(record.get("publishTime") or ""))
                    published_at = parse_date_string(publish_time)
                    if published_at and published_at < publication_date_from:
                        continue
                if not _is_allowed_listing(record):
                    continue
                seen_ids.add(notice_id)
                candidates.append(record)

            if len(records) < 20:
                break

    candidates.sort(
        key=lambda record: (
            _title_score(str(record.get("title") or "")),
            _normalize_space(str(record.get("publishTime") or "")) or "",
        ),
        reverse=True,
    )
    return candidates


def collect_ggzy_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    fetch_list: callable | None = None,
    fetch_detail: callable | None = None,
    today: date | None = None,
) -> list[CollectedSourceDocument]:
    list_fetcher = fetch_list or _default_fetch_list
    detail_fetcher = fetch_detail or _default_fetch_detail
    effective_today = today or date.today()

    candidates = _iter_candidate_rows(
        source,
        publication_date_from=publication_date_from,
        today=effective_today,
        fetch_list=list_fetcher,
    )

    scored_documents: list[tuple[int, str, CollectedSourceDocument]] = []
    with ThreadPoolExecutor(max_workers=GGZY_DETAIL_FETCH_WORKERS) as executor:
        futures = [
            executor.submit(
                _collect_scored_document,
                source,
                record,
                detail_fetcher=detail_fetcher,
            )
            for record in candidates
        ]
        for future in futures:
            scored_document = future.result()
            if scored_document is not None:
                scored_documents.append(scored_document)

    scored_documents.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [document for _score, _published_at, document in scored_documents[:limit]]
