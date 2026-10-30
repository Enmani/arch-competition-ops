"""Fetch configured notice URLs verbatim; AI handles their varying page structures."""

from __future__ import annotations

from pathlib import Path

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.http import get_default_client
from arch_competition_ops.models import SourceDefinition


def collect_generic_notice_pages(
    source: SourceDefinition,
    *,
    limit: int = 20,
    publication_date_from: str | None = None,
    archive_dir: Path | None = None,
) -> list[CollectedSourceDocument]:
    documents = []
    urls = list(dict.fromkeys(source.url_list or [source.base_url]))[:limit]
    for url in urls:
        response = get_default_client().get(url, archive=archive_dir or False)
        documents.append(CollectedSourceDocument(response.url, response.text))
    return documents
