"""Relevance classification of GGZY notices: is this a building-design commission?"""

from __future__ import annotations

from dataclasses import dataclass

from arch_competition_ops.collectors.ggzy.markers import (
    AMBIGUOUS_BUILT_ASSET_LABELS,
    BUILDING_DISCIPLINE_MARKERS,
    BUILT_ASSET_TYPE_LABEL_MARKERS,
    CLASSIFICATION_STOP_MARKERS,
    DESIGN_SCOPE_LABEL_MARKERS,
    EXPLICIT_NEW_BUILD_MARKERS,
    PROJECT_MODE_LABEL_MARKERS,
)


@dataclass(frozen=True)
class GGZYNoticeFeatures:
    built_asset_types: frozenset[str]
    design_scopes: frozenset[str]
    project_modes: frozenset[str]
    has_building_discipline: bool


def map_project_types(features: GGZYNoticeFeatures) -> list[str]:
    project_types: list[str] = []
    if "urban_renewal" in features.built_asset_types:
        project_types.append("urban_regeneration")
    if "planning" in features.design_scopes:
        project_types.append("urban_planning")
    if "interior_design" in features.design_scopes or "interior" in features.built_asset_types:
        project_types.append("interior_project")
    if _has_strong_built_asset(features) or features.has_building_discipline:
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
) -> GGZYNoticeFeatures:
    feature_text = classification_text or combined_text
    built_asset_types = _collect_feature_labels(feature_text, BUILT_ASSET_TYPE_LABEL_MARKERS)
    design_scopes = _collect_feature_labels(feature_text, DESIGN_SCOPE_LABEL_MARKERS)
    project_modes = _collect_feature_labels(feature_text, PROJECT_MODE_LABEL_MARKERS)
    has_building_discipline = any(marker in combined_text for marker in BUILDING_DISCIPLINE_MARKERS)
    if (
        "new_build" in project_modes
        and "renovation" in project_modes
        and not any(marker in feature_text for marker in EXPLICIT_NEW_BUILD_MARKERS)
    ):
        project_modes = frozenset(mode for mode in project_modes if mode != "new_build")
    if "interior_design" in design_scopes:
        built_asset_types = frozenset({*built_asset_types, "interior"})
    return GGZYNoticeFeatures(
        built_asset_types=built_asset_types,
        design_scopes=design_scopes,
        project_modes=project_modes,
        has_building_discipline=has_building_discipline,
    )


def _has_strong_built_asset(features: GGZYNoticeFeatures) -> bool:
    return bool(features.built_asset_types - AMBIGUOUS_BUILT_ASSET_LABELS)
