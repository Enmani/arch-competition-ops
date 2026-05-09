from __future__ import annotations

import re


def normalize_fragment(value: str) -> str:
    lowered = value.strip().lower()
    normalized = re.sub(r"[^\w]+", "-", lowered, flags=re.UNICODE)
    normalized = re.sub(r"-{2,}", "-", normalized)
    normalized = normalized.strip("-_")
    return normalized or "unknown"


def build_competition_key(title: str, organizer: str, deadline: str) -> str:
    return "__".join(
        [
            normalize_fragment(title),
            normalize_fragment(organizer),
            normalize_fragment(deadline),
        ]
    )
