"""Derive display titles for stored opportunities: rules for everything, then one bilingual AI pass.

Every title gets a Chinese and an English display title once (a translation for short titles, a
condensed form for long ones). A row already derived by the current model is skipped, and a changed
source title clears the derived columns (storage/merge.py), so only new or changed titles are paid.
"""

from __future__ import annotations

import sqlite3
from collections.abc import Collection
from contextlib import nullcontext
from dataclasses import asdict, dataclass, field
from typing import Any

from openai import OpenAI

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.locking import exclusive_lock
from arch_competition_ops.screening.client import ScreeningError
from arch_competition_ops.screening.providers import create_screening_client, screening_model
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.screening import ScreeningBudgetExceeded
from arch_competition_ops.storage.titles import list_title_candidates, write_display_titles
from arch_competition_ops.titles.clean import CLEANER_VERSION, clean_title
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
    """Clean stale titles, then translate/condense new ones in at most ``max_batches`` requests."""
    summary = TitleBatchSummary()
    model = screening_model(settings, settings.ai_model)
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
                if source != ai_token:
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
            pending.append(_title_input(row, cleaned))
        summary.cleaned = len(updates)
        summary.pending_ai = len(pending)
        if dry_run:
            return summary
        write_display_titles(db_path, updates)
        if not use_ai or not pending or max_batches < 1:
            return summary

        # Stage 2: AI, for every title not yet derived by this model.
        try:
            session = (
                nullcontext(client) if client is not None else create_screening_client(settings)
            )
        except ValueError as exc:
            summary.errors.append(str(exc))
            return summary
        titles_by_id = {row["id"]: row["title"] for row in rows}
        with session as api:
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
                summary.condensed += sum(
                    pair.title_en is not None or pair.title_zh is not None
                    for pair in result.titles.values()
                )
                write_display_titles(
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
