from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from arch_competition_ops.automation import (
    DEFAULT_AUTOMATION_CONFIG_PATH,
    list_automation_batches,
    run_automation_batch,
)
from arch_competition_ops.settings import Settings


def _safe_print(message: str) -> None:
    encoding = getattr(sys.stdout, "encoding", None) or "utf-8"
    print(message.encode(encoding, errors="replace").decode(encoding, errors="replace"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="ingest_batch")
    parser.add_argument("--batch-id")
    parser.add_argument("--config-path", default=str(DEFAULT_AUTOMATION_CONFIG_PATH))
    parser.add_argument("--limit-per-source", type=int)
    parser.add_argument("--publication-date-from")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--fail-fast", action="store_true")
    parser.add_argument("--list-batches", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    settings = Settings()
    config_path = Path(args.config_path)

    if args.list_batches:
        batches = list_automation_batches(settings, config_path=config_path)
        payload = [
            {
                "batch_id": batch.batch_id,
                "description": batch.description,
                "include_kinds": list(batch.include_kinds),
                "include_source_ids": list(batch.include_source_ids),
                "exclude_source_ids": list(batch.exclude_source_ids),
                "enabled_only": batch.enabled_only,
                "limit_per_source": batch.limit_per_source,
                "publication_window_days": batch.publication_window_days,
            }
            for batch in batches
        ]
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
        raise SystemExit("--batch-id is required unless --list-batches is used")

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
        _safe_print(
            f"Batch {result.batch_id} :: sources={result.total_sources} :: "
            f"ingested={result.total_ingested} :: failures={len(result.failed)}"
        )
        for run in result.succeeded:
            _safe_print(
                f"[OK] {run.source_id} :: ingested={run.ingested_count} :: "
                f"window_from={run.publication_date_from or 'none'}"
            )
        for failure in result.failed:
            _safe_print(f"[FAIL] {failure.source_id} :: {failure.error}")

    return 1 if result.failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
