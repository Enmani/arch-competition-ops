"""Derive display titles for stored opportunities: rules for everything, AI only where needed."""

from __future__ import annotations

import sqlite3
from collections.abc import Collection
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from typing import Any

from openai import OpenAI

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.locking import exclusive_lock
from arch_competition_ops.screening.catalog import get_model
from arch_competition_ops.screening.client import ScreeningError, create_client
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.screening import ScreeningBudgetExceeded
from arch_competition_ops.storage.titles import list_title_candidates, write_display_titles
from arch_competition_ops.titles.clean import CLEANER_VERSION, clean_title, needs_condensing
from arch_competition_ops.titles.rewrite import (
    AI_VERSION,
    BATCH_SIZE,
    TitleInput,
    condense_batch,
)

DEFAULT_MAX_BATCHES = 5


@dataclass
class TitleBatchSummary:
    cleaned: int = 0
    condensed: int = 0
    rejected: int = 0
    pending_ai: int = 0
    batches: int = 0
    cached_batches: int = 0
    cost_usd: float = 0
    errors: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def ai_source_token(model_id: str) -> str:
    return f"{CLEANER_VERSION}+{AI_VERSION}:{model_id}"


def _title_input(row: sqlite3.Row, cleaned: str) -> TitleInput:
    return TitleInput(
        competition_id=row["id"],
        source_title=row["title"],
        cleaned_title=cleaned,
        country=row["jurisdiction"],
    )


def polish_titles(
    settings: Settings,
    *,
    competition_ids: Collection[str] | None = None,
    use_ai: bool = False,
    max_batches: int = DEFAULT_MAX_BATCHES,
    force: bool = False,
    dry_run: bool = False,
    client: OpenAI | None = None,
) -> TitleBatchSummary:
    """Clean every stale title, then condense long ones with at most ``max_batches`` requests."""
    summary = TitleBatchSummary()
    model = get_model(settings.ai_model)
    ai_token = ai_source_token(model.id)
    db_path = initialize_database(settings)

    with exclusive_lock(db_path.with_suffix(".titles.lock"), label="display titles"):
        rows = list_title_candidates(db_path, competition_ids=competition_ids)

        # Stage 1: rules, for each row whose stored state is not from this cleaner version.
        updates: list[dict[str, Any]] = []
        pending: list[TitleInput] = []
        for row in rows:
            source = row["display_title_source"]
            current = source is not None and source.startswith(CLEANER_VERSION)
            if current and not force:
                cleaned = row["display_title"] or clean_title(row["title"])
                if source != ai_token and needs_condensing(row["title"], cleaned):
                    pending.append(_title_input(row, cleaned))
                continue
            cleaned = clean_title(row["title"])
            updates.append(
                {
                    "id": row["id"],
                    "title": row["title"],
                    "display_title": cleaned,
                    "display_title_source": CLEANER_VERSION,
                }
            )
            if needs_condensing(row["title"], cleaned):
                pending.append(_title_input(row, cleaned))
        summary.cleaned = len(updates)
        summary.pending_ai = len(pending)
        if dry_run:
            return summary
        write_display_titles(db_path, updates)
        if not use_ai or not pending or max_batches < 1:
            return summary

        # Stage 2: AI, only for what the rules could not shorten.
        if client is None and not settings.openai_api_key.get_secret_value().strip():
            summary.errors.append("OPENAI_API_KEY is not set; kept rule-cleaned titles")
            return summary
        titles_by_id = {row["id"]: row["title"] for row in rows}
        with nullcontext(client) if client is not None else create_client(settings) as api:
            for start in range(0, min(len(pending), max_batches * BATCH_SIZE), BATCH_SIZE):
                chunk = pending[start : start + BATCH_SIZE]
                try:
                    result = condense_batch(api, settings, db_path, model, chunk)
                except (ScreeningError, ScreeningBudgetExceeded) as exc:
                    summary.errors.append(str(exc))
                    summary.cost_usd += getattr(exc, "cost_usd", 0)
                    break
                summary.batches += 1
                summary.cached_batches += int(result.cached)
                summary.cost_usd += result.cost_usd
                summary.rejected += result.rejected
                cleaned_by_id = {item.competition_id: item.cleaned_title for item in chunk}
                summary.condensed += write_display_titles(
                    db_path,
                    [
                        {
                            "id": competition_id,
                            "title": titles_by_id[competition_id],
                            "display_title": cleaned_by_id[competition_id],
                            "display_title_zh": pair.title_zh,
                            "display_title_en": pair.title_en,
                            "display_title_source": ai_token,
                        }
                        for competition_id, pair in result.titles.items()
                    ],
                )
    return summary
