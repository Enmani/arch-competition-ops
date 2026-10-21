"""Relevance rules for German municipal procurement notices."""

from __future__ import annotations

from arch_competition_ops.collectors.relevance import is_design_relevant
from arch_competition_ops.normalizers.text import normalize_text

GERMAN_DIRECT_SERVICE_MARKERS = (
    "objektplanung",
    "fachplanung",
    "planungsleistung",
    "planungsleistungen",
    "architektenleistung",
    "architektenleistungen",
    "ingenieurleistung",
    "ingenieurleistungen",
    "generalplanung",
    "gesamtplanung",
    "freianlagenplanung",
    "landschaftsarchitektur",
    "stadtplanung",
    "projektleitung",
    "generalplaner",
    "bauakustik",
    "raum und bauakustik",
)


GERMAN_PROJECT_STEERING_MARKERS = (
    "projektsteuerung",
    "projektsteuerer",
    "projektsteuererleistungen",
    "kostenplanung",
)


GERMAN_BUILT_CONTEXT_MARKERS = (
    "gebaude",
    "hochbau",
    "neubau",
    "umbau",
    "sanierung",
    "feuerwache",
    "schule",
    "bibliothek",
    "museum",
    "campus",
    "haltestelle",
    "stadtteilschule",
    "bibliothek",
    "sport",
    "quartier",
    "txl",
)


def is_relevant_municipal_notice(title: str, description: str) -> bool:
    if is_design_relevant(title, description):
        return True

    haystack = normalize_text(f"{title} {description}")
    if any(marker in haystack for marker in GERMAN_DIRECT_SERVICE_MARKERS):
        return True

    return any(marker in haystack for marker in GERMAN_PROJECT_STEERING_MARKERS) and any(
        marker in haystack for marker in GERMAN_BUILT_CONTEXT_MARKERS
    )


def is_candidate_municipal_notice(title: str, description: str) -> bool:
    if is_relevant_municipal_notice(title, description):
        return True

    haystack = normalize_text(f"{title} {description}")
    return any(
        marker in haystack
        for marker in (*GERMAN_DIRECT_SERVICE_MARKERS, *GERMAN_PROJECT_STEERING_MARKERS)
    )
