"""Local labels used to describe GGZY project types after collection."""

from __future__ import annotations

import json
from importlib import resources

_DATA = json.loads(
    resources.files(__package__).joinpath("markers.json").read_text(encoding="utf-8")
)


def _words(name: str) -> tuple[str, ...]:
    return tuple(_DATA[name])


def _labelled(name: str) -> tuple[tuple[str, tuple[str, ...]], ...]:
    return tuple((label, tuple(markers)) for label, markers in _DATA[name])


AMBIGUOUS_BUILT_ASSET_LABELS = frozenset(_DATA["ambiguous_built_asset_labels"])

CLASSIFICATION_STOP_MARKERS = _words("classification_stop_markers")
EXPLICIT_NEW_BUILD_MARKERS = _words("explicit_new_build_markers")
BUILDING_DISCIPLINE_MARKERS = _words("building_discipline_markers")


BUILT_ASSET_TYPE_LABEL_MARKERS = _labelled("built_asset_type_label_markers")
DESIGN_SCOPE_LABEL_MARKERS = _labelled("design_scope_label_markers")
PROJECT_MODE_LABEL_MARKERS = _labelled("project_mode_label_markers")
