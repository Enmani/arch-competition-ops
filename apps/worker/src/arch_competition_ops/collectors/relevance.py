"""Shared design-relevance heuristics for collectors.

Matching rules (all on ``normalize_text`` output, which keeps CJK):

* positive markers are *stems* on purpose (``architett`` covers architetto/architettura), so they
  match as substrings;
* negative markers are phrases and match on word boundaries, so ``award`` can no longer fire on
  ``awarded``-style fragments and ``logo`` can no longer fire on ``catalogo``. Ambiguous single
  words are replaced by phrases (``student`` alone also names legitimate "student housing"
  commissions, so only student-only competition phrases are excluded).

Marker lists are compiled through ``normalize_text`` once at import, which is what makes
``maîtrise d'oeuvre`` (normalized to ``maitrise d oeuvre``) matchable at all.
"""

from __future__ import annotations

from arch_competition_ops.normalizers.text import (
    compile_markers,
    contains_any_phrase,
    contains_any_substring,
    normalize_text,
)

STRONG_POSITIVE_MARKERS = compile_markers(
    (
        "architect",
        "architecture",
        "architett",
        "architecte",
        "architectural",
        "progettazione",
        "maîtrise d'oeuvre",
        "masterplan",
        "urban design",
        "landscape",
        "planungswettbewerb",
        "projektwettbewerb",
        "design competition",
        "project competition",
        "concours",
        "competition",
        "design services",
        # Chinese notices: CJK survives normalization, so these actually match now.
        "建筑设计",
        "建筑方案",
        "方案设计",
        "室内设计",
        "景观设计",
        "城市设计",
        "规划设计",
        "设计竞赛",
    )
)
NEGATIVE_MARKERS = compile_markers(
    (
        "student competition",
        "students competition",
        "student only",
        "students only",
        "for students",
        "student workshop",
        "student award",
        "workshop",
        "awards",
        "design award",
        "award ceremony",
        "awarded",
        "contract award",
        "award notice",
        "notice of award",
        "poster",
        "logo",
        "photography",
        "graphic design",
        "stationery",
        "cancelleria",
        "printing",
        "stampa",
        "grafica",
        "sito web",
        "website",
        "bollettazione",
        "depurazione",
        "rilevazione incendi",
        "impianti elettrici",
        "wayfinding",
        "segnaletica",
        "testvergabe",
        "dies ist eine testvergabe",
        "bitte weder bewerben",
        "学生竞赛",
        "大学生设计",
        "海报设计",
        "标志设计",
    )
)
RELEVANT_CPV_PREFIXES = ("712", "7142")
BUILT_ENVIRONMENT_MARKERS = compile_markers(
    (
        "building",
        "civic",
        "library",
        "museum",
        "school",
        "college",
        "campus",
        "hospital",
        "housing",
        "public space",
        "urban",
        "waterfront",
        "landscape",
        "masterplan",
        "rehabilitation",
        "renovation",
        "extension",
        "biblioteca",
        "scuola",
        "museo",
        "ospedale",
        "edificio",
        "piazza",
        "urbanistica",
        "riqualificazione",
        "rigenerazione",
        "civico",
        "logement",
        "architecture",
        "建筑",
        "学校",
        "医院",
        "图书馆",
        "住宅",
        "小区",
    )
)


def is_design_relevant(
    *chunks: str | None,
    cpv_codes: list[str] | None = None,
    categories: list[str] | None = None,
    require_professional_category: bool = False,
) -> bool:
    haystack = " ".join(normalize_text(chunk) for chunk in chunks if chunk)

    normalized_categories = [
        normalize_text(category) for category in (categories or []) if category
    ]
    if normalized_categories:
        # Category labels are short ("For professionals", "For students"), so a stem match is the
        # intent here, unlike the free-text negative markers below.
        has_professional_category = any(
            "professional" in category for category in normalized_categories
        )
        if (
            any("student" in category for category in normalized_categories)
            and not has_professional_category
        ):
            return False
        if require_professional_category and not has_professional_category:
            return False

    if contains_any_phrase(haystack, NEGATIVE_MARKERS):
        return False

    if contains_any_substring(haystack, STRONG_POSITIVE_MARKERS):
        return True

    return any(code.startswith(RELEVANT_CPV_PREFIXES) for code in (cpv_codes or []))


def has_built_environment_context(*chunks: str | None) -> bool:
    haystack = " ".join(normalize_text(chunk) for chunk in chunks if chunk)
    return contains_any_substring(haystack, BUILT_ENVIRONMENT_MARKERS)
