"""Relevance classification of GGZY notices: is this a building-design commission?"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from arch_competition_ops.collectors.ggzy.markers import (
    ALLOWED_BUSINESS_TYPES,
    ALLOWED_INFORMATION_TYPES,
    AMBIGUOUS_BUILT_ASSET_LABELS,
    BODY_POSITIVE_MARKERS,
    BUILDING_DISCIPLINE_MARKERS,
    BUILT_ASSET_TYPE_LABEL_MARKERS,
    BUILT_CONTEXT_MARKERS,
    CLASSIFICATION_STOP_MARKERS,
    CONTEXTUAL_SOFT_NEGATIVE_MARKERS,
    DESIGN_SCOPE_LABEL_MARKERS,
    DESIGN_SCOPE_MARKERS,
    EXPLICIT_NEW_BUILD_MARKERS,
    HARD_NEGATIVE_MARKERS,
    NEGATIVE_DOMAIN_LABEL_MARKERS,
    NEGATIVE_TITLE_MARKERS,
    ORIGINAL_CATEGORY_NEGATIVE_MARKERS,
    ORIGINAL_CATEGORY_POSITIVE_LABEL_MARKERS,
    ORIGINAL_CATEGORY_PROBE_MARKERS,
    POSITIVE_TITLE_MARKERS,
    PRIMARY_BUILT_OBJECT_SCORE_MARKERS,
    PROJECT_MODE_LABEL_MARKERS,
    SITE_SCOPE_MARKERS,
    SOFT_NEGATIVE_MARKERS,
    TITLE_SCORE_MARKERS,
)


@dataclass(frozen=True)
class GGZYNoticeFeatures:
    official_positive_sectors: frozenset[str]
    built_asset_types: frozenset[str]
    design_scopes: frozenset[str]
    project_modes: frozenset[str]
    negative_domains: frozenset[str]
    has_building_discipline: bool


def map_project_types(features: GGZYNoticeFeatures) -> list[str]:
    project_types: list[str] = []
    if "urban_renewal" in features.built_asset_types:
        project_types.append("urban_regeneration")
    if "planning" in features.design_scopes:
        project_types.append("urban_planning")
    if "interior_design" in features.design_scopes or "interior" in features.built_asset_types:
        project_types.append("interior_project")
    if (
        _has_strong_built_asset(features)
        or features.has_building_discipline
        or features.official_positive_sectors
    ):
        project_types.append("building_project")
    return list(dict.fromkeys(project_types))


def map_building_categories(features: GGZYNoticeFeatures) -> list[str]:
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


def map_competition_types(features: GGZYNoticeFeatures) -> list[str]:
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


def _matches_negative_title(title: str) -> bool:
    lowered = title.lower()
    return any(marker in lowered for marker in NEGATIVE_TITLE_MARKERS)


def _matches_positive_title(title: str) -> bool:
    return any(marker in title for marker in POSITIVE_TITLE_MARKERS)


def _contains_any(text: str, markers: tuple[str, ...]) -> bool:
    return any(marker in text for marker in markers)


def _weighted_score(text: str, markers: tuple[tuple[str, int], ...]) -> int:
    return sum(weight for marker, weight in markers if marker in text)


def _soft_negative_penalty(text: str) -> int:
    return sum(weight for marker, weight in SOFT_NEGATIVE_MARKERS if marker in text)


def _contextual_negative_penalty(text: str) -> int:
    return sum(weight for marker, weight in CONTEXTUAL_SOFT_NEGATIVE_MARKERS if marker in text)


def classification_text_from_notice(title: str, body_text: str) -> str:
    truncated_body = body_text
    stop_indexes = [
        index for marker in CLASSIFICATION_STOP_MARKERS if (index := body_text.find(marker)) > 0
    ]
    if stop_indexes:
        truncated_body = body_text[: min(stop_indexes)]
    return f"{title.lower()} {truncated_body.lower()}".strip()


def _collect_feature_labels(
    text: str, label_markers: tuple[tuple[str, tuple[str, ...]], ...]
) -> frozenset[str]:
    labels = {
        label for label, markers in label_markers if any(marker in text for marker in markers)
    }
    return frozenset(labels)


def extract_notice_features(
    *,
    combined_text: str,
    classification_text: str | None,
    original_category_text: str | None,
) -> GGZYNoticeFeatures:
    category_text = (original_category_text or "").strip()
    feature_text = classification_text or combined_text
    official_positive_sectors = _collect_feature_labels(
        category_text, ORIGINAL_CATEGORY_POSITIVE_LABEL_MARKERS
    )
    built_asset_types = _collect_feature_labels(feature_text, BUILT_ASSET_TYPE_LABEL_MARKERS)
    design_scopes = _collect_feature_labels(feature_text, DESIGN_SCOPE_LABEL_MARKERS)
    project_modes = _collect_feature_labels(feature_text, PROJECT_MODE_LABEL_MARKERS)
    negative_domains = _collect_feature_labels(
        f"{category_text} {combined_text}".strip(), NEGATIVE_DOMAIN_LABEL_MARKERS
    )
    has_building_discipline = any(marker in combined_text for marker in BUILDING_DISCIPLINE_MARKERS)
    if (
        "new_build" in project_modes
        and "renovation" in project_modes
        and not any(marker in feature_text for marker in EXPLICIT_NEW_BUILD_MARKERS)
    ):
        project_modes = frozenset(mode for mode in project_modes if mode != "new_build")
    if "interior_design" in design_scopes:
        built_asset_types = frozenset({*built_asset_types, "interior"})
    if "architectural_design" in design_scopes and (
        "education" in built_asset_types or "healthcare" in built_asset_types
    ):
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
    return bool(features.built_asset_types - AMBIGUOUS_BUILT_ASSET_LABELS)


def _is_building_target_notice(features: GGZYNoticeFeatures) -> bool:
    has_design_scope = bool(features.design_scopes)
    has_strong_built_asset = _has_strong_built_asset(features)
    has_positive_sector = bool(features.official_positive_sectors)
    has_negative_domain = bool(features.negative_domains)
    has_building_support = has_positive_sector or features.has_building_discipline
    has_only_ambiguous_asset = bool(features.built_asset_types) and not has_strong_built_asset
    is_urban_renewal = "urban_renewal" in features.built_asset_types
    is_planning_land_use = (
        "planning" in features.design_scopes and "land_use_planning" in features.built_asset_types
    )

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


def _matches_negative_original_category(category_text: str | None) -> bool:
    normalized = (category_text or "").strip()
    if not normalized:
        return False
    return any(marker in normalized for marker in ORIGINAL_CATEGORY_NEGATIVE_MARKERS)


def assess_notice_relevance(
    *,
    title: str,
    body_text: str,
    detail_available: bool,
    original_category_text: str | None = None,
) -> tuple[bool, int]:
    title_text = title.lower()
    body_lower = body_text.lower()
    combined_text = f"{title_text} {body_lower}".strip()
    classification_text = classification_text_from_notice(title, body_text)

    if _matches_negative_original_category(original_category_text):
        return False, -120

    if _contains_any(combined_text, HARD_NEGATIVE_MARKERS):
        return False, -100

    has_design_scope = _contains_any(combined_text, DESIGN_SCOPE_MARKERS)
    has_built_context = _contains_any(combined_text, BUILT_CONTEXT_MARKERS)
    features = extract_notice_features(
        combined_text=combined_text,
        classification_text=classification_text,
        original_category_text=original_category_text,
    )
    title_score = _weighted_score(title_text, TITLE_SCORE_MARKERS)
    body_score = _weighted_score(combined_text, BODY_POSITIVE_MARKERS)
    primary_built_object_score = _weighted_score(combined_text, PRIMARY_BUILT_OBJECT_SCORE_MARKERS)
    negative_penalty = _soft_negative_penalty(combined_text)
    contextual_negative_penalty = _contextual_negative_penalty(combined_text)
    site_scope_penalty = _weighted_score(combined_text, SITE_SCOPE_MARKERS)

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


def is_allowed_listing(record: dict[str, Any]) -> bool:
    information_type = str(record.get("informationType") or "").strip()
    if information_type not in ALLOWED_INFORMATION_TYPES:
        return False

    business_type = str(record.get("businessTypeText") or "").strip()
    if business_type and business_type not in ALLOWED_BUSINESS_TYPES:
        return False

    title = str(record.get("title") or "").strip()
    if not title or _matches_negative_title(title):
        return False

    return _matches_positive_title(title)


def title_score(title: str) -> int:
    score = 0
    for marker, weight in TITLE_SCORE_MARKERS:
        if marker in title:
            score += weight
    return score


def should_probe_original_category(title: str, body_text: str) -> bool:
    combined = f"{title} {body_text}".strip()
    if any(marker in combined for marker in ORIGINAL_CATEGORY_PROBE_MARKERS):
        return True
    if any(marker in combined for marker in BUILDING_DISCIPLINE_MARKERS):
        return True
    if any(
        marker in combined
        for marker in ("建筑方案", "建筑概念方案", "建筑方案设计", "修建性详细规划")
    ):
        return True
    if any(
        marker in combined for marker in ("方案设计", "初步设计", "施工图设计")
    ) and not _contains_any(combined, BUILT_CONTEXT_MARKERS):
        return True
    return False
