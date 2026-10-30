from __future__ import annotations

import argparse
import json
import logging
import sys
from collections.abc import Callable, Sequence
from pathlib import Path

import requests

from arch_competition_ops import __version__
from arch_competition_ops.automation import (
    DEFAULT_AUTOMATION_CONFIG_PATH,
    AutomationBatchResult,
    list_automation_batches,
    run_automation_batch,
)
from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.card_previews import prewarm_opportunity_card_previews
from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.country_packs import load_country_pack_coverage
from arch_competition_ops.demo import DemoSeedRefusedError, seed_demo_records
from arch_competition_ops.diagnostics import CheckResult, run_doctor, run_verify
from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.http import HttpError
from arch_competition_ops.ingest import (
    IngestError,
    IngestResult,
    SourceDisabledError,
    SourceNotFoundError,
    ingest_source,
)
from arch_competition_ops.locking import LockHeldError, is_locked, read_lock_holder
from arch_competition_ops.maintenance import (
    cleanup_expired_competitions,
    rebuild_review_queue,
    refresh_missing_geocodes,
)
from arch_competition_ops.normalizers.competition import configure_procedure_registry
from arch_competition_ops.postprocess.registry import POSTPROCESS_TASKS
from arch_competition_ops.screening import commands as screening_commands
from arch_competition_ops.screening.client import ScreeningError
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import list_competitions

EXIT_FAILURE = 1
EXIT_USAGE = 2
# EX_TEMPFAIL: another batch holds the ingest lock; retry later. Scripts can test for it.
EXIT_LOCK_HELD = 75


def _safe_print(message: str) -> None:
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(message.encode(encoding, errors="replace").decode(encoding, errors="replace"))


def _print_results(results: list[CheckResult]) -> int:
    exit_code = 0
    for result in results:
        marker = "OK" if result.ok else "FAIL"
        detail = f" :: {result.detail}" if result.detail else ""
        _safe_print(f"[{marker}] {result.label}{detail}")
        if not result.ok:
            exit_code = EXIT_FAILURE
    return exit_code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="arch-competition-ops")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    parser.add_argument("-v", "--verbose", action="store_true", help="log progress to stderr")

    subparsers = parser.add_subparsers(dest="command", required=True)
    screening_commands.add_parsers(subparsers)
    subparsers.add_parser("doctor", help="validate repository prerequisites")
    subparsers.add_parser("init-db", help="create the SQLite schema")
    subparsers.add_parser("verify", help="run repository integrity checks")
    seed_parser = subparsers.add_parser(
        "seed-demo", help="insert fictional demo records into an empty database"
    )
    seed_parser.add_argument(
        "--force", action="store_true", help="seed even if the database already has records"
    )
    subparsers.add_parser("refresh-review-queue", help="rebuild the operator review queue")
    geocode_parser = subparsers.add_parser(
        "refresh-geocodes",
        help="geocode stored opportunity locations and update coordinate fields",
    )
    geocode_parser.add_argument("--limit", type=int, default=50)
    preview_parser = subparsers.add_parser(
        "prewarm-card-previews",
        help="run the offline preview generator (packages/previews) for the given ids",
    )
    preview_parser.add_argument(
        "--competition-id", action="append", dest="competition_ids", default=[]
    )
    cleanup_parser = subparsers.add_parser(
        "cleanup-expired-competitions",
        help=(
            "delete opportunities (and cached previews) whose deadline is past the retention "
            "window; runs at most once per calendar day unless --force"
        ),
    )
    cleanup_parser.add_argument("--retention-days", type=int)
    cleanup_parser.add_argument("--limit", type=int, default=500)
    cleanup_parser.add_argument("--force", action="store_true", help="ignore the once-a-day guard")
    for task in POSTPROCESS_TASKS.values():
        task_parser = subparsers.add_parser(task.task_id, help=task.description)
        task_parser.add_argument("--limit", type=int, default=500)
    subparsers.add_parser("show-sources", help="list source definitions")
    subparsers.add_parser(
        "show-country-coverage", help="summarize enabled, scaffold-only and planned country packs"
    )
    ingest_parser = subparsers.add_parser(
        "ingest-source",
        help="fetch from a registered live source, parse notices, and upsert records",
    )
    ingest_parser.add_argument("--source-id", required=True)
    ingest_parser.add_argument("--limit", type=int, default=20)
    ingest_parser.add_argument("--publication-date-from")

    batch_parser = subparsers.add_parser(
        "ingest-batch",
        help="ingest every source of an automation batch under the cross-process ingest lock",
    )
    batch_parser.add_argument("--batch-id")
    batch_parser.add_argument("--config-path", default=str(DEFAULT_AUTOMATION_CONFIG_PATH))
    batch_parser.add_argument("--limit-per-source", type=int)
    batch_parser.add_argument("--publication-date-from")
    batch_parser.add_argument("--json", action="store_true")
    batch_parser.add_argument("--fail-fast", action="store_true")
    batch_parser.add_argument("--list-batches", action="store_true")

    subparsers.add_parser(
        "ingest-lock-status",
        help=f"exit 0 when no batch holds the ingest lock, {EXIT_LOCK_HELD} when one does",
    )

    list_parser = subparsers.add_parser("list", help="list current competition records")
    list_parser.add_argument("--limit", type=int, default=10)

    parse_parser = subparsers.add_parser(
        "parse-source-file",
        help="parse a local official notice payload with the registered source parser",
    )
    parse_parser.add_argument("--source-id", required=True)
    parse_parser.add_argument("--path", required=True)
    parse_parser.add_argument("--source-url")
    return parser


# -- command handlers ---------------------------------------------------------------------------


def _print_ingest_result(result: IngestResult) -> None:
    _safe_print(
        f"Ingested {len(result.ingested_ids)} records from {result.source_id} "
        f"(status={result.status}, documents={result.document_count}, "
        f"expired={result.skipped_expired}, filtered={result.filtered_out}, "
        f"failures={result.parse_failure_count})"
    )
    for ingested_id in result.ingested_ids:
        _safe_print(f"- {ingested_id}")
    for failure in result.failures:
        _safe_print(f"[WARN] {failure.stage} failed for {failure.source_url} :: {failure.error}")
    for note in result.notes:
        _safe_print(f"[NOTE] {note}")


def _handle_ingest_source(settings: Settings, args: argparse.Namespace) -> int:
    result = ingest_source(
        settings,
        source_id=args.source_id,
        limit=args.limit,
        publication_date_from=args.publication_date_from,
    )
    _print_ingest_result(result)
    return EXIT_FAILURE if result.has_failures else 0


def _print_batch_result(result: AutomationBatchResult) -> None:
    _safe_print(
        f"Batch {result.batch_id} :: sources={result.total_sources} :: "
        f"ingested={result.total_ingested} :: failures={len(result.failed)}"
    )
    for run in result.succeeded:
        marker = "PARTIAL" if run.failure_count else "OK"
        _safe_print(
            f"[{marker}] {run.source_id} :: ingested={run.ingested_count} :: "
            f"skipped_documents={run.failure_count} :: "
            f"window_from={run.publication_date_from or 'none'}"
        )
        for note in run.notes:
            _safe_print(f"  [NOTE] {note}")
    for failure in result.failed:
        _safe_print(f"[FAIL] {failure.source_id} :: {failure.error}")


def _handle_ingest_batch(settings: Settings, args: argparse.Namespace) -> int:
    config_path = Path(args.config_path)

    if args.list_batches:
        batches = list_automation_batches(settings, config_path=config_path)
        payload = [batch.model_dump() for batch in batches]
        if args.json:
            _safe_print(json.dumps(payload, indent=2))
        else:
            for batch in payload:
                _safe_print(
                    f"{batch['batch_id']} | limit={batch['limit_per_source']} | "
                    f"window_days={batch['publication_window_days']} | "
                    f"kinds={','.join(batch['include_kinds']) or '-'} | "
                    f"sources={','.join(batch['include_source_ids']) or '-'}"
                )
        return 0

    if not args.batch_id:
        _safe_print("error: --batch-id is required unless --list-batches is used")
        return EXIT_USAGE

    result = run_automation_batch(
        settings,
        batch_id=args.batch_id,
        config_path=config_path,
        limit_per_source=args.limit_per_source,
        publication_date_from=args.publication_date_from,
        continue_on_error=not args.fail_fast,
    )
    if args.json:
        _safe_print(json.dumps(result.to_dict(), indent=2))
    else:
        _print_batch_result(result)
    return EXIT_FAILURE if result.has_failures else 0


def _handle_ingest_lock_status(settings: Settings, _args: argparse.Namespace) -> int:
    lock_path = settings.resolve_path(settings.ingest_lock)
    if not is_locked(lock_path):
        _safe_print("free")
        return 0
    holder = read_lock_holder(lock_path)
    detail = (
        f" pid={holder.pid} started_at={holder.started_at} label={holder.label}" if holder else ""
    )
    _safe_print(f"held{detail}")
    return EXIT_LOCK_HELD


def _handle_cleanup(settings: Settings, args: argparse.Namespace) -> int:
    result = cleanup_expired_competitions(
        settings, retention_days=args.retention_days, limit=args.limit, force=args.force
    )
    if result.already_ran_today:
        _safe_print(f"Expired competition cleanup already ran on {result.last_run_date}; skipped")
        return 0
    _safe_print(
        "Expired competition cleanup completed "
        f"(attempted={result.attempted}, deleted={result.deleted_competitions}, "
        f"preview_files={result.deleted_preview_files}, "
        f"static_preview_files={result.deleted_static_preview_files}, skipped={result.skipped})"
    )
    return 0


def _handle_list(settings: Settings, args: argparse.Namespace) -> int:
    rows = list_competitions(settings.resolve_path(settings.db), limit=args.limit)
    if not rows:
        _safe_print("No competition records in the database")
        return 0
    for row in rows:
        deadline = row["deadline_at"] or "unknown"
        authority = row["authority_name"] or row["organizer"] or "unknown"
        score = (
            f"{row['qualification_score']:.2f}" if row["qualification_score"] is not None else "n/a"
        )
        _safe_print(
            f"{row['id']} | {row['status']} | {row['opportunity_type']} | "
            f"{deadline} | score={score} | {row['title']} | {authority}"
        )
    return 0


def _handle_parse_source_file(settings: Settings, args: argparse.Namespace) -> int:
    source = next(
        (
            item
            for item in load_source_catalog(settings).sources
            if item.source_id == args.source_id
        ),
        None,
    )
    if source is None:
        _safe_print(f"Unknown source id: {args.source_id}")
        return EXIT_FAILURE

    payload_path = Path(args.path)
    if not payload_path.is_absolute():
        payload_path = (settings.root / payload_path).resolve()
    if not payload_path.exists():
        _safe_print(f"Missing payload file: {payload_path}")
        return EXIT_FAILURE

    payload = payload_path.read_text(encoding="utf-8")
    record = parse_source_payload(source, payload, source_url=args.source_url or source.base_url)
    _safe_print(record.model_dump_json(indent=2, exclude_none=True))
    return 0


def _handle_show_country_coverage(settings: Settings, _args: argparse.Namespace) -> int:
    coverage = load_country_pack_coverage(settings)
    for label, names in (
        ("Enabled country packs", coverage.enabled),
        ("Scaffold-only country packs", coverage.scaffold_only),
        ("Planned countries without a pack", coverage.planned_without_pack),
    ):
        _safe_print(f"{label}: {len(names)}")
        if names:
            _safe_print(", ".join(names))
    return 0


def _handle_show_sources(settings: Settings, _args: argparse.Namespace) -> int:
    for source in load_source_catalog(settings).sources:
        state = "enabled" if source.enabled else "disabled"
        _safe_print(
            f"{source.source_id} :: {source.kind} :: {state} :: "
            f"{source.collector} :: {source.base_url}"
        )
    return 0


def _handle_seed_demo(settings: Settings, args: argparse.Namespace) -> int:
    seeded_ids = seed_demo_records(settings, force=args.force)
    _safe_print(f"Seeded {len(seeded_ids)} demo records")
    for seeded_id in seeded_ids:
        _safe_print(f"- {seeded_id}")
    return 0


def _handle_refresh_review_queue(settings: Settings, _args: argparse.Namespace) -> int:
    queue_items = rebuild_review_queue(settings)
    _safe_print(f"Rebuilt {len(queue_items)} active review queue items")
    for item in queue_items[:20]:
        _safe_print(f"- {item['reason_code']} :: {item['queue_id']} :: {item['title']}")
    return 0


def _handle_prewarm(settings: Settings, args: argparse.Namespace) -> int:
    result = prewarm_opportunity_card_previews(settings, competition_ids=args.competition_ids)
    _safe_print(
        f"Card preview prewarm {result.status} (attempted={result.attempted}, "
        f"generated={result.generated}, skipped={result.skipped}) :: {result.detail}"
    )
    return EXIT_FAILURE if result.status == "failed" else 0


def _handler_for(args: argparse.Namespace) -> Callable[[Settings, argparse.Namespace], int]:
    if args.command in {
        "show-ai-models",
        "screen-competitions",
        "list-ai-screenings",
        "analyze-source-file",
    }:
        return lambda settings, args: screening_commands.handle(settings, args, _safe_print)
    simple: dict[str, Callable[[Settings, argparse.Namespace], int]] = {
        "doctor": lambda settings, _args: _print_results(run_doctor(settings)),
        "verify": lambda settings, _args: _print_results(run_verify(settings)),
        "init-db": lambda settings, _args: (
            _safe_print(f"Initialized database at {initialize_database(settings)}") or 0
        ),
        "seed-demo": _handle_seed_demo,
        "refresh-review-queue": _handle_refresh_review_queue,
        "refresh-geocodes": lambda settings, a: (
            _safe_print(
                f"Updated geocodes for {refresh_missing_geocodes(settings, limit=a.limit)} records"
            )
            or 0
        ),
        "prewarm-card-previews": _handle_prewarm,
        "cleanup-expired-competitions": _handle_cleanup,
        "show-sources": _handle_show_sources,
        "show-country-coverage": _handle_show_country_coverage,
        "ingest-source": _handle_ingest_source,
        "ingest-batch": _handle_ingest_batch,
        "ingest-lock-status": _handle_ingest_lock_status,
        "list": _handle_list,
        "parse-source-file": _handle_parse_source_file,
    }
    if args.command in simple:
        return simple[args.command]

    task = POSTPROCESS_TASKS[args.command]

    def run_task(settings: Settings, a: argparse.Namespace) -> int:
        updated = task.execute(settings, limit=a.limit)
        _safe_print(f"{task.task_id}: updated {updated} records")
        return 0

    return run_task


def _configure_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.INFO if verbose else logging.WARNING,
        format="%(levelname)s %(name)s: %(message)s",
        stream=sys.stderr,
    )


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    _configure_logging(args.verbose)
    settings = Settings()
    configure_procedure_registry(settings.root)

    try:
        return _handler_for(args)(settings, args)
    except LockHeldError as exc:
        _safe_print(f"error: {exc}")
        return EXIT_LOCK_HELD
    except (SourceNotFoundError, SourceDisabledError, DemoSeedRefusedError) as exc:
        _safe_print(f"error: {exc}")
        return EXIT_USAGE
    except (IngestError, ScreeningError) as exc:
        # The cause is a network/API/database problem the operator can act on; no traceback.
        _safe_print(f"error: {exc}")
        return EXIT_FAILURE
    except (HttpError, requests.RequestException, OSError) as exc:
        _safe_print(f"error: network or file access failed: {exc}")
        return EXIT_FAILURE
    except ValueError as exc:
        _safe_print(f"error: {exc}")
        return EXIT_USAGE


if __name__ == "__main__":
    raise SystemExit(main())
