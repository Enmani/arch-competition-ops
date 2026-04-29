from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class CollectedSourceDocument:
    source_url: str
    payload: str
