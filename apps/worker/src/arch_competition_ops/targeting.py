"""Apply ``config/filters.yml`` keyword preferences to extracted records.

* ``negative_keywords`` exclude a record before it is stored (whole-word / phrase match on the
  title and the descriptive text), e.g. ``ideas competition`` or ``student only``.
* ``positive_keywords`` never exclude anything; a title hit adds ``POSITIVE_KEYWORD_BONUS`` to the
  qualification score so matching notices sort higher.

The other fields in ``filters.yml`` are consumed elsewhere (ranking, the Web filters).
"""

from __future__ import annotations

import logging

from arch_competition_ops.config_loader import load_targeting_preferences
from arch_competition_ops.models import CompetitionRecord, TargetingPreferences
from arch_competition_ops.normalizers.text import compile_markers, contains_phrase, normalize_text
from arch_competition_ops.settings import Settings

logger = logging.getLogger(__name__)

POSITIVE_KEYWORD_BONUS = 0.05


class TargetingFilter:
    def __init__(self, preferences: TargetingPreferences) -> None:
        self._positive = compile_markers(preferences.positive_keywords)
        self._negative = compile_markers(preferences.negative_keywords)

    def excluded_by(self, record: CompetitionRecord) -> str | None:
        """The negative keyword that excludes ``record``, or ``None`` when it may be kept."""
        haystack = normalize_text(
            f"{record.title} {record.description or ''} {record.eligibility_summary or ''}"
        )
        return next(
            (keyword for keyword in self._negative if contains_phrase(haystack, keyword)), None
        )

    def apply_bonus(self, record: CompetitionRecord) -> None:
        title = normalize_text(record.title)
        if record.qualification_score is not None and any(
            contains_phrase(title, keyword) for keyword in self._positive
        ):
            record.qualification_score = min(
                1.0, round(record.qualification_score + POSITIVE_KEYWORD_BONUS, 4)
            )


def load_targeting_filter(settings: Settings) -> TargetingFilter:
    """Filter from ``filters.yml``; a missing file means "no preferences" (logged), not a crash."""
    try:
        preferences = load_targeting_preferences(settings)
    except FileNotFoundError as exc:
        logger.warning("Targeting preferences not applied: %s", exc)
        preferences = TargetingPreferences()
    return TargetingFilter(preferences)
