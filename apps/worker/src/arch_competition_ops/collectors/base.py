from __future__ import annotations

import json
from dataclasses import dataclass

from arch_competition_ops.http import HttpError


@dataclass(frozen=True)
class CollectedSourceDocument:
    source_url: str
    payload: str


def deferred_detail(
    error: HttpError, source_url: str, listing, *, detail_url=None
) -> CollectedSourceDocument:
    """Keep the original listing when its detail GET is temporarily refused."""
    if error.status_code not in {403, 429}:
        raise error
    return CollectedSourceDocument(
        source_url,
        json.dumps(
            {"rawNotice": listing, "pendingDetailUrl": detail_url or source_url},
            ensure_ascii=False,
            default=str,
        ),
    )
