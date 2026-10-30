"""``polish-titles``: derive display titles for stored opportunities."""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable

from arch_competition_ops.settings import Settings
from arch_competition_ops.titles.service import DEFAULT_MAX_BATCHES, polish_titles


def add_parsers(subparsers) -> None:
    parser = subparsers.add_parser(
        "polish-titles",
        help="clean titles with rules, then condense long ones with AI (batched, cached, budgeted)",
    )
    parser.add_argument("--competition-id", action="append", dest="competition_ids")
    parser.add_argument("--no-ai", action="store_true", help="rules only; no network calls")
    parser.add_argument(
        "--max-batches",
        type=int,
        default=DEFAULT_MAX_BATCHES,
        help="AI requests of 20 titles each",
    )
    parser.add_argument("--force", action="store_true", help="re-derive even when up to date")
    parser.add_argument("--dry-run", action="store_true", help="count work without writing")
    parser.add_argument("--json", action="store_true")


def handle(settings: Settings, args: argparse.Namespace, emit: Callable[[str], None]) -> int:
    summary = polish_titles(
        settings,
        competition_ids=args.competition_ids,
        use_ai=not args.no_ai,
        max_batches=args.max_batches,
        force=args.force,
        dry_run=args.dry_run,
    )
    if args.json:
        emit(json.dumps(summary.to_dict(), ensure_ascii=False, indent=2))
    else:
        emit(
            f"Titles: cleaned={summary.cleaned}, condensed={summary.condensed}, "
            f"rejected={summary.rejected}, pending_ai={summary.pending_ai}, "
            f"batches={summary.batches} (cached={summary.cached_batches}), "
            f"estimated_cost_usd={summary.cost_usd:.6f}"
        )
        for error in summary.errors:
            emit(f"[FAIL] {error}")
    return 1 if summary.errors else 0
