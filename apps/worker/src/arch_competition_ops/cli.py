from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Sequence

from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.country_packs import load_country_pack_coverage
from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops import __version__
from arch_competition_ops.operations import (
    ingest_source,
    initialize_database,
    rebuild_review_queue,
    refresh_missing_geocodes,
    run_doctor,
    run_verify,
    seed_demo_records,
)
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import list_competitions


def _safe_print(message: str) -> None:
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(message.encode(encoding, errors="replace").decode(encoding, errors="replace"))


def _print_results(results: list) -> int:
    exit_code = 0
    for result in results:
        marker = "OK" if result.ok else "FAIL"
        detail = f" :: {result.detail}" if result.detail else ""
        _safe_print(f"[{marker}] {result.label}{detail}")
        if not result.ok:
            exit_code = 1
    return exit_code


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="arch-competition-ops")
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")

    subparsers = parser.add_subparsers(dest="command", required=True)
    subparsers.add_parser("doctor", help="validate repository prerequisites")
    subparsers.add_parser("init-db", help="create the SQLite schema")
    subparsers.add_parser("verify", help="run repository integrity checks")
    subparsers.add_parser("seed-demo", help="insert demo competition records")
    subparsers.add_parser("refresh-review-queue", help="rebuild the operator review queue")
    geocode_parser = subparsers.add_parser(
        "refresh-geocodes",
        help="geocode stored opportunity locations and update coordinate fields",
    )
    geocode_parser.add_argument("--limit", type=int, default=50)
    subparsers.add_parser("show-sources", help="list enabled source definitions")
    subparsers.add_parser("show-country-coverage", help="summarize active and empty country pack files")
    ingest_parser = subparsers.add_parser(
        "ingest-source",
        help="fetch from a registered live source, parse notices, and upsert records",
    )
    ingest_parser.add_argument("--source-id", required=True)
    ingest_parser.add_argument("--limit", type=int, default=20)
    ingest_parser.add_argument("--publication-date-from")

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


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings()

    if args.command == "doctor":
        return _print_results(run_doctor(settings))

    if args.command == "init-db":
        db_path = initialize_database(settings)
        _safe_print(f"Initialized database at {db_path}")
        return 0

    if args.command == "verify":
        return _print_results(run_verify(settings))

    if args.command == "seed-demo":
        seeded_ids = seed_demo_records(settings)
        _safe_print(f"Seeded {len(seeded_ids)} demo records")
        for seeded_id in seeded_ids:
            _safe_print(f"- {seeded_id}")
        return 0

    if args.command == "refresh-review-queue":
        queue_items = rebuild_review_queue(settings)
        _safe_print(f"Rebuilt {len(queue_items)} active review queue items")
        for item in queue_items[:20]:
            _safe_print(f"- {item['reason_code']} :: {item['queue_id']} :: {item['title']}")
        return 0

    if args.command == "refresh-geocodes":
        updated_count = refresh_missing_geocodes(settings, limit=args.limit)
        _safe_print(f"Updated geocodes for {updated_count} records")
        return 0

    if args.command == "show-sources":
        for source in load_source_catalog(settings).sources:
            state = "enabled" if source.enabled else "disabled"
            _safe_print(f"{source.source_id} :: {source.kind} :: {state} :: {source.base_url}")
        return 0

    if args.command == "show-country-coverage":
        coverage = load_country_pack_coverage(settings)
        _safe_print(f"Enabled country packs: {len(coverage.enabled)}")
        if coverage.enabled:
            _safe_print(", ".join(coverage.enabled))
        _safe_print(f"Scaffold-only country packs: {len(coverage.scaffold_only)}")
        if coverage.scaffold_only:
            _safe_print(", ".join(coverage.scaffold_only))
        _safe_print(f"Empty country packs: {len(coverage.empty)}")
        if coverage.empty:
            _safe_print(", ".join(coverage.empty))
        return 0

    if args.command == "ingest-source":
        try:
            ingested_ids = ingest_source(
                settings,
                source_id=args.source_id,
                limit=args.limit,
                publication_date_from=args.publication_date_from,
            )
        except ValueError as exc:
            _safe_print(str(exc))
            return 1

        _safe_print(f"Ingested {len(ingested_ids)} records from {args.source_id}")
        for ingested_id in ingested_ids:
            _safe_print(f"- {ingested_id}")
        return 0

    if args.command == "list":
        rows = list_competitions(settings.resolve_path(settings.db), limit=args.limit)
        if not rows:
            _safe_print("No competition records in the database")
            return 0
        for row in rows:
            deadline = row["deadline_at"] or "unknown"
            authority = row["authority_name"] or row["organizer"]
            score = (
                f"{row['qualification_score']:.2f}"
                if row["qualification_score"] is not None
                else "n/a"
            )
            _safe_print(
                f"{row['id']} | {row['status']} | {row['opportunity_type']} | "
                f"{deadline} | score={score} | {row['title']} | {authority}"
            )
        return 0

    if args.command == "parse-source-file":
        source_catalog = load_source_catalog(settings)
        source = next(
            (candidate for candidate in source_catalog.sources if candidate.source_id == args.source_id),
            None,
        )
        if source is None:
            _safe_print(f"Unknown source id: {args.source_id}")
            return 1

        payload_path = Path(args.path)
        if not payload_path.is_absolute():
            payload_path = (settings.root / payload_path).resolve()
        if not payload_path.exists():
            _safe_print(f"Missing payload file: {payload_path}")
            return 1

        payload = payload_path.read_text(encoding="utf-8")
        record = parse_source_payload(source, payload, source_url=args.source_url or source.base_url)
        _safe_print(record.model_dump_json(indent=2, exclude_none=True))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
