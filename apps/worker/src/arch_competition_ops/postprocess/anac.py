"""ANAC BDNCP post-processing: human-readable source links and archived award notices."""

from __future__ import annotations

import logging
from collections.abc import Callable
from typing import Any

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.collectors.common import fetch_json_get
from arch_competition_ops.extractors.anac import resolve_anac_record_status
from arch_competition_ops.http import HttpError
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import (
    list_source_records,
    update_competition_source_url,
    update_competition_status,
)

logger = logging.getLogger(__name__)

SOURCE_ID = "anac_bdncp_contracts"
PUBLIC_BASE_URL = "https://pubblicitalegale.anticorruzione.it"
_PUBLIC_PATH_PREFIXES = (f"{PUBLIC_BASE_URL}/bandi/", f"{PUBLIC_BASE_URL}/esiti/")

NoticeDetailFetcher = Callable[[str], dict[str, Any] | None]


def fetch_notice_detail(official_notice_id: str) -> dict[str, Any] | None:
    try:
        payload = fetch_json_get(
            f"{PUBLIC_BASE_URL}/api/v0/avvisi/{official_notice_id}",
            headers={"Accept": "application/json", "Referer": f"{PUBLIC_BASE_URL}/"},
        )
    except (HttpError, ValueError) as exc:
        logger.warning("ANAC notice detail %s unavailable: %s", official_notice_id, exc)
        return None
    return payload if isinstance(payload, dict) else None


def _is_award_notice(
    *, source_url: str | None, title: str | None, notice_detail: dict[str, Any] | None
) -> bool:
    detail = notice_detail or {}
    status = resolve_anac_record_status(
        {
            "procedureType": detail.get("codiceScheda"),
            "tipo": detail.get("tipo"),
            "sourceKind": detail.get("sourceKind"),
            "sourcePublicUrl": source_url,
            "title": title,
        }
    )
    return status == "archived"


def build_public_notice_url(
    *,
    official_notice_id: str | None,
    source_url: str | None,
    title: str | None,
    notice_detail: dict[str, Any] | None = None,
) -> str | None:
    """The human-readable ANAC page (``/bandi/`` call or ``/esiti/`` result) for a notice."""
    notice_id = (official_notice_id or "").strip()
    if not notice_id:
        return None
    is_award = _is_award_notice(source_url=source_url, title=title, notice_detail=notice_detail)
    route = "esiti" if is_award else "bandi"
    return f"{PUBLIC_BASE_URL}/{route}/{notice_id}?ricercaArchivio=true"


def normalize_source_traces(
    settings: Settings,
    *,
    limit: int = 500,
    fetch_detail: NoticeDetailFetcher | None = None,
) -> int:
    db_path = initialize_database(settings)
    fetcher = fetch_detail or fetch_notice_detail
    updated = 0

    for row in list_source_records(
        db_path,
        SOURCE_ID,
        limit=limit,
        require_notice_id=True,
        exclude_source_url_prefixes=_PUBLIC_PATH_PREFIXES,
    ):
        normalized_url = build_public_notice_url(
            official_notice_id=row["official_notice_id"],
            source_url=row["source_url"],
            title=row["title"],
            notice_detail=fetcher(row["official_notice_id"]),
        )
        if not normalized_url or normalized_url == row["source_url"]:
            continue
        update_competition_source_url(db_path, competition_id=row["id"], source_url=normalized_url)
        updated += 1

    return updated


def normalize_record_statuses(
    settings: Settings,
    *,
    limit: int = 500,
    fetch_detail: NoticeDetailFetcher | None = None,
) -> int:
    """Archive stored ANAC rows that are award/result notices.

    Only ``discovered`` rows move: a shortlisted/verified/discarded row is a human decision.
    """
    db_path = initialize_database(settings)
    fetcher = fetch_detail or fetch_notice_detail
    updated = 0

    for row in list_source_records(db_path, SOURCE_ID, limit=limit, require_notice_id=True):
        if row["status"] == "archived":
            continue
        notice_detail = fetcher(row["official_notice_id"])
        public_url = build_public_notice_url(
            official_notice_id=row["official_notice_id"],
            source_url=row["source_url"],
            title=row["title"],
            notice_detail=notice_detail,
        )
        if not _is_award_notice(
            source_url=public_url or row["source_url"],
            title=row["title"],
            notice_detail=notice_detail,
        ):
            continue
        if update_competition_status(
            db_path, competition_id=row["id"], status="archived", only_from=("discovered",)
        ):
            updated += 1

    return updated
