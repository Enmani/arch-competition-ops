from __future__ import annotations

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.models import SourceDefinition


def collect_scaffold_only_documents(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
) -> list[CollectedSourceDocument]:
    del limit, publication_date_from

    if source.enabled:
        raise ValueError(
            f"Source '{source.source_id}' is marked enabled but still points at the scaffold-only collector"
        )

    return []
