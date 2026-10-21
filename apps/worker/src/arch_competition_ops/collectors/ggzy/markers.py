"""GGZY keyword data, loaded from ``markers.json`` (one list per marker family).

Keeping the vocabulary in JSON means tuning what counts as a building-design notice does not
require touching code. Weighted families are ``(marker, weight)`` pairs, label families are
``(label, (markers...))`` pairs; the shapes match what ``relevance.py`` iterates over.
"""

from __future__ import annotations

import json
from importlib import resources

_DATA = json.loads(
    resources.files(__package__).joinpath("markers.json").read_text(encoding="utf-8")
)


def _words(name: str) -> tuple[str, ...]:
    return tuple(_DATA[name])


def _weighted(name: str) -> tuple[tuple[str, int], ...]:
    return tuple((marker, int(weight)) for marker, weight in _DATA[name])


def _labelled(name: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    return tuple((label, tuple(markers)) for label, markers in _DATA[name])


ALLOWED_INFORMATION_TYPES = frozenset(_DATA["allowed_information_types"])
ALLOWED_BUSINESS_TYPES = frozenset(_DATA["allowed_business_types"])
AMBIGUOUS_BUILT_ASSET_LABELS = frozenset(_DATA["ambiguous_built_asset_labels"])

# (search term, number of result pages to read)
SEARCH_STRATEGIES: tuple[tuple[str, int], ...] = tuple(
    (term, int(pages)) for term, pages in _DATA["search_strategies"]
)

POSITIVE_TITLE_MARKERS = _words("positive_title_markers")
NEGATIVE_TITLE_MARKERS = _words("negative_title_markers")
DESIGN_SCOPE_MARKERS = _words("design_scope_markers")
BUILT_CONTEXT_MARKERS = _words("built_context_markers")
HARD_NEGATIVE_MARKERS = _words("hard_negative_markers")
ORIGINAL_CATEGORY_NEGATIVE_MARKERS = _words("original_category_negative_markers")
CLASSIFICATION_STOP_MARKERS = _words("classification_stop_markers")
EXPLICIT_NEW_BUILD_MARKERS = _words("explicit_new_build_markers")
BUILDING_DISCIPLINE_MARKERS = _words("building_discipline_markers")
ORIGINAL_CATEGORY_PROBE_MARKERS = _words("original_category_probe_markers")

TITLE_SCORE_MARKERS = _weighted("title_score_markers")
BODY_POSITIVE_MARKERS = _weighted("body_positive_markers")
PRIMARY_BUILT_OBJECT_SCORE_MARKERS = _weighted("primary_built_object_score_markers")
CONTEXTUAL_SOFT_NEGATIVE_MARKERS = _weighted("contextual_soft_negative_markers")
SOFT_NEGATIVE_MARKERS = _weighted("soft_negative_markers")
SITE_SCOPE_MARKERS = _weighted("site_scope_markers")

ORIGINAL_CATEGORY_POSITIVE_LABEL_MARKERS = _labelled("original_category_positive_label_markers")
BUILT_ASSET_TYPE_LABEL_MARKERS = _labelled("built_asset_type_label_markers")
DESIGN_SCOPE_LABEL_MARKERS = _labelled("design_scope_label_markers")
PROJECT_MODE_LABEL_MARKERS = _labelled("project_mode_label_markers")
NEGATIVE_DOMAIN_LABEL_MARKERS = _labelled("negative_domain_label_markers")
