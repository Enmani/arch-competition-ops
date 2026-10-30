"""Command-line surface for screening, results and model discovery."""

from __future__ import annotations

import argparse
import json
from collections.abc import Callable
from pathlib import Path

from openai import APIError, APIStatusError

from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.screening.catalog import MODELS
from arch_competition_ops.screening.client import ScreeningError, create_client
from arch_competition_ops.screening.service import assess_document, screen_competitions
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage.screening import list_screenings


def add_parsers(subparsers) -> None:
    analyze = subparsers.add_parser(
        "analyze-source-file", help="AI extraction and screening of a raw notice"
    )
    analyze.add_argument("--source-id", required=True)
    analyze.add_argument("--path", required=True)
    analyze.add_argument("--source-url", required=True)
    models = subparsers.add_parser("show-ai-models", help="list screening models and USD prices")
    models.add_argument("--live", action="store_true", help="check the account model list")
    models.add_argument("--json", action="store_true")
    screen = subparsers.add_parser(
        "screen-competitions", help="screen stored opportunities with AI"
    )
    screen.add_argument("--limit", type=int, default=20)
    screen.add_argument("--competition-id", action="append", dest="competition_ids")
    screen.add_argument("--model", choices=[model.id for model in MODELS])
    screen.add_argument(
        "--force", action="store_true", help="make a new paid request, ignoring cache"
    )
    screen.add_argument(
        "--dry-run", action="store_true", help="list candidates without network calls"
    )
    screen.add_argument("--no-fetch", action="store_true", help="assess stored fields only")
    screen.add_argument("--json", action="store_true")
    results = subparsers.add_parser(
        "list-ai-screenings", help="show the latest AI advice per record"
    )
    results.add_argument("--limit", type=int, default=20)
    results.add_argument("--decision", choices=["recommend", "exclude", "needs_review"])
    results.add_argument("--json", action="store_true")


def handle(settings: Settings, args: argparse.Namespace, emit: Callable[[str], None]) -> int:
    if args.command == "analyze-source-file":
        source = next(
            (s for s in load_source_catalog(settings).sources if s.source_id == args.source_id),
            None,
        )
        if source is None:
            raise ValueError(f"Unknown source id: {args.source_id}")
        assessment = assess_document(
            settings,
            source=source,
            source_url=args.source_url,
            payload=settings.resolve_path(Path(args.path)).read_text(encoding="utf-8"),
        )
        emit(
            json.dumps(
                {
                    "record": assessment.record.model_dump(mode="json"),
                    "assessment": assessment.decision.model_dump(),
                    "model": assessment.model,
                    "cached": assessment.cached,
                    "estimated_cost_usd": assessment.cost_usd,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
        return 0
    if args.command == "show-ai-models":
        available = None
        if args.live:
            try:
                with create_client(settings) as client:
                    available = {model.id for model in client.models.list()}
            except APIStatusError as exc:
                raise ScreeningError(
                    f"OpenAI model lookup failed (HTTP {exc.status_code})"
                ) from None
            except APIError:
                raise ScreeningError("OpenAI model lookup failed (connection/API error)") from None
        rows = [
            {
                "model": model.id,
                "input_usd_per_million_tokens": model.input_per_million,
                "output_usd_per_million_tokens": model.output_per_million,
                "purpose": model.purpose,
                "default": model.id == settings.ai_model,
                "listed_for_account": model.id in available if available is not None else None,
            }
            for model in MODELS
        ]
        if args.json:
            emit(json.dumps(rows, ensure_ascii=False, indent=2))
        else:
            emit("Standard short-context USD / 1M tokens; prices checked 2026-10-30")
            for row in rows:
                marker = " (default)" if row["default"] else ""
                access = f" | listed={row['listed_for_account']}" if args.live else ""
                emit(
                    f"{row['model']}{marker} | input=${row['input_usd_per_million_tokens']} "
                    f"output=${row['output_usd_per_million_tokens']}{access} | {row['purpose']}"
                )
        return 0
    if args.command == "screen-competitions":
        result = screen_competitions(
            settings,
            limit=args.limit,
            competition_ids=args.competition_ids,
            model_id=args.model,
            force=args.force,
            dry_run=args.dry_run,
            fetch_source=not args.no_fetch,
        )
        if args.json:
            emit(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        else:
            emit(
                f"AI {result.model}: completed={result.completed}, cached={result.cached}, "
                f"planned={result.planned}, estimated_cost_usd={result.cost_usd:.6f}"
            )
            for item in result.results:
                emit(
                    f"{item.get('decision', 'planned')} | {item['competition_id']} | "
                    f"{item['title']}"
                )
                if "summary_zh" in item:
                    emit(item["summary_zh"])
            for error in result.errors:
                emit(f"[FAIL] {error}")
        return 1 if result.errors else 0
    rows = list_screenings(
        settings.resolve_path(settings.db),
        limit=args.limit,
        decision=args.decision,
    )
    # Full prompts stay in the local ledger; the result listing only exposes assessment metadata.
    for row in rows:
        row.pop("input_json", None)
        row["result"] = json.loads(row.pop("result_json"))
    if args.json:
        emit(json.dumps(rows, ensure_ascii=False, indent=2))
    else:
        if not rows:
            emit("No AI screening results")
        for row in rows:
            advice = row["result"]
            emit(
                f"{advice['decision']} | {row['competition_id']} | {row['title']} | {row['model']}"
            )
            emit(advice["summary_zh"])
            for reason in advice["reasons_zh"]:
                emit(f"- {reason}")
            for evidence in advice["evidence"]:
                emit(f"  [{evidence['field']}] {evidence['quote']}")
            if advice["missing_information"]:
                emit("  Missing: " + ", ".join(advice["missing_information"]))
    return 0
