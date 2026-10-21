"""GETS (NZ) post-processing: drop advance notices that are not open tenders."""

from __future__ import annotations

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.collectors.generic_rss import is_preannouncement_rss_notice
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import list_source_records, update_competition_status

SOURCE_ID = "gets_open_tenders"


def _is_preannouncement(
    *,
    title: str | None,
    authority_name: str | None,
    eligibility_summary: str | None,
    source_url: str | None,
) -> bool:
    categories: list[str] = []
    if authority_name and "historic" in authority_name.lower():
        categories.append("historic")
    if source_url and "historic" in source_url.lower():
        categories.append("historic")
    return is_preannouncement_rss_notice(title or "", eligibility_summary or "", categories)


def normalize_preannouncement_statuses(settings: Settings, *, limit: int = 500) -> int:
    """Discard stored GETS rows that are advance notices. Only ``discovered`` rows move."""
    db_path = initialize_database(settings)
    updated = 0

    for row in list_source_records(
        db_path, SOURCE_ID, limit=limit, exclude_statuses=("archived", "discarded")
    ):
        if not _is_preannouncement(
            title=row["title"],
            authority_name=row["authority_name"],
            eligibility_summary=row["eligibility_summary"],
            source_url=row["source_url"],
        ):
            continue
        if update_competition_status(
            db_path, competition_id=row["id"], status="discarded", only_from=("discovered",)
        ):
            updated += 1

    return updated
