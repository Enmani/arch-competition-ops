"""Keyword classification of notices into competition, project and building categories.

Only text the notice itself provides is classified (title, buyer, description); nothing is
inferred from the platform. ``building_categories`` combines the competition types already found
with keyword hits. Keywords match at the start of a word (so ``sport`` does not fire inside
``transport``) after accents are folded, e.g. ``bibliothe`` covers bibliotheque/bibliothek.
"""

from __future__ import annotations

import re

from arch_competition_ops.normalizers.text import normalize_text


def infer_competition_types(*chunks: str | None) -> list[str]:
    haystack = " ".join(chunk for chunk in chunks if chunk).lower()
    inferred: list[str] = []
    keyword_map = {
        "public_building": [
            "library",
            "civic",
            "public building",
            "公共建筑",
            "图书馆",
            "文化中心",
            "办公楼",
            "综合体",
            "景区",
        ],
        "urban_design": [
            "square",
            "urban",
            "public space",
            "masterplan",
            "城市设计",
            "公共空间",
        ],
        "landscape": ["landscape", "park", "garden", "plaza", "景观", "园林"],
        "healthcare": ["hospital", "healthcare", "clinic", "医院", "医疗", "卫生院"],
        "education": ["school", "campus", "education", "学校", "教学楼", "校园", "幼儿园"],
        "housing": ["housing", "residential", "老旧小区", "住宅", "小区", "安置房", "安置片区"],
        "interior": ["interior", "interiors", "室内", "精装修", "公区精装"],
        "adaptive_reuse": [
            "adaptive reuse",
            "reuse",
            "conversion",
            "城市更新",
            "更新改造",
            "老旧小区改造",
            "旧改",
        ],
        "masterplan": ["masterplan", "planning", "规划", "修建性详细规划", "总体规划"],
        "architecture": [
            "design",
            "architecture",
            "architect",
            "建筑设计",
            "设计服务",
            "方案设计",
            "初步设计",
            "建筑方案",
        ],
    }

    for category, keywords in keyword_map.items():
        if any(keyword in haystack for keyword in keywords):
            inferred.append(category)

    return inferred or ["architecture"]


def infer_project_types(
    competition_types: list[str],
    *,
    project_types: list[str] | None = None,
) -> list[str]:
    if project_types:
        return project_types

    inferred: list[str] = []
    type_set = set(competition_types)
    if "adaptive_reuse" in type_set:
        inferred.append("urban_regeneration")
    if "landscape" in type_set:
        inferred.append("environment_design")
    if "masterplan" in type_set or "urban_design" in type_set:
        inferred.append("urban_planning")
    if "interior" in type_set:
        inferred.append("interior_project")
    if any(
        marker in type_set
        for marker in ("architecture", "public_building", "healthcare", "education", "housing")
    ):
        inferred.append("building_project")
    return inferred


# (category, competition type that implies it, keyword stems). Output follows this order.
_BUILDING_CATEGORY_RULES: tuple[tuple[str, str | None, tuple[str, ...]], ...] = (
    (
        "education",
        "education",
        ("school", "schule", "scuola", "ecole", "college", "grundschule", "groupe scolaire"),
    ),
    (
        "healthcare",
        "healthcare",
        ("hospital", "clinic", "clinique", "ospedal", "healthcare", "medical"),
    ),
    (
        "housing",
        "housing",
        ("housing", "logement", "wohn", "residential", "residenziale"),
    ),
    (
        "civic_public",
        "public_building",
        (
            "library",
            "bibliothe",
            "town hall",
            "mairie",
            "rathaus",
            "feuerwache",
            "community centre",
            "community center",
            "begegnungszentrum",
            "cimiter",
            "cemeter",
        ),
    ),
    (
        "sport_leisure",
        None,
        ("sport", "stadium", "arena", "leisure", "loisir"),
    ),
    (
        "culture_heritage",
        None,
        (
            "archaeolog",
            "museum",
            "heritage",
            "patrimoine",
            "restoration",
            "restauro",
            "monument",
            "sanctuary",
        ),
    ),
    (
        "transport_infrastructure",
        None,
        (
            "rail",
            "station",
            "tunnel",
            "bridge",
            "underbridge",
            "tram",
            "metro",
            "bahn",
            "transport",
            "passenger access",
        ),
    ),
)


def _has_keyword(normalized_text: str, stems: tuple[str, ...]) -> bool:
    return any(re.search(rf"(?<![^\W\d_]){re.escape(stem)}", normalized_text) for stem in stems)


def infer_building_categories(
    competition_types: list[str],
    *,
    building_categories: list[str] | None = None,
    text: str | None = None,
) -> list[str]:
    """Explicit categories win; otherwise competition types plus keyword hits in ``text``."""
    if building_categories:
        return building_categories

    type_set = set(competition_types)
    haystack = normalize_text(text)
    return [
        category
        for category, implied_by, stems in _BUILDING_CATEGORY_RULES
        if (implied_by is not None and implied_by in type_set) or _has_keyword(haystack, stems)
    ]
