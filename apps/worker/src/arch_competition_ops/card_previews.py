"""Opportunity card preview prewarming through the offline Node CLI.

Previews are never rendered by Python or by the Web request path. After an ingest the worker runs
``packages/previews/bin/prewarm.mjs`` with a fixed argument vector (no shell, no composed Node
source) and sends the new competition ids as ``{"competitionIds": [...]}`` on stdin. The CLI reads
the same SQLite file, writes images and ``manifest.json`` under ``artifacts/previews`` and prints
one final JSON line such as ``{"attempted": 3, "generated": 2, "skipped": 1, "failed": 0}``.

The cache-busting revision lives in ``packages/previews/src/version.ts`` and in the manifest; this
module does not need it, so nothing parses TypeScript source any more. The step is opt-in
(``ARCH_PREVIEW_PREWARM=1``) and a failure is a warning only: it never affects what was ingested.
"""

from __future__ import annotations

import json
import logging
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from arch_competition_ops.settings import Settings

logger = logging.getLogger(__name__)

PrewarmStatus = Literal["ok", "skipped", "failed"]

PREWARM_SCRIPT = Path("packages") / "previews" / "bin" / "prewarm.mjs"
EXIT_LOCKED = 75  # another preview run holds the lock (see packages/previews/src/cli.ts)


@dataclass(frozen=True)
class CardPreviewPrewarmResult:
    status: PrewarmStatus
    attempted: int
    detail: str
    generated: int | None = None
    skipped: int | None = None
    failed: int | None = None


def build_prewarm_argv(settings: Settings) -> list[str]:
    """The one argument vector the worker ever uses; ids travel on stdin, never in argv."""
    return [
        settings.preview_node,
        str(settings.root / PREWARM_SCRIPT),
        "--db",
        str(settings.resolve_path(settings.db)),
        "--only-from-stdin",
    ]


def _parse_counts(stdout: str) -> dict[str, object]:
    for line in reversed(stdout.strip().splitlines()):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(payload, dict):
            return payload
    return {}


def _as_count(value: object) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def prewarm_opportunity_card_previews(
    settings: Settings,
    *,
    competition_ids: list[str],
) -> CardPreviewPrewarmResult:
    unique_ids = [value for value in dict.fromkeys(competition_ids) if value]
    if not unique_ids:
        return CardPreviewPrewarmResult("skipped", 0, "no competition ids to prewarm")

    if not settings.preview_prewarm:
        detail = "ARCH_PREVIEW_PREWARM is not enabled; preview prewarm skipped"
        logger.info(detail)
        return CardPreviewPrewarmResult("skipped", len(unique_ids), detail)

    script = settings.root / PREWARM_SCRIPT
    if not script.is_file():
        detail = f"preview prewarm script not found: {script}"
        logger.warning(detail)
        return CardPreviewPrewarmResult("failed", len(unique_ids), detail)

    try:
        completed = subprocess.run(
            build_prewarm_argv(settings),
            input=json.dumps({"competitionIds": unique_ids}),
            capture_output=True,
            text=True,
            encoding="utf-8",
            cwd=settings.root,
            timeout=settings.preview_prewarm_timeout_seconds,
            check=False,
        )
    except (OSError, ValueError, subprocess.TimeoutExpired) as exc:
        detail = f"preview prewarm could not run: {exc}"
        logger.warning(detail)
        return CardPreviewPrewarmResult("failed", len(unique_ids), detail)

    if completed.returncode != 0:
        stderr_tail = (completed.stderr or "").strip()[-500:]
        reason = "another preview run is active" if completed.returncode == EXIT_LOCKED else ""
        detail = (
            f"preview prewarm exited with {completed.returncode}: {reason or stderr_tail}".rstrip()
        )
        logger.warning(detail)
        return CardPreviewPrewarmResult("failed", len(unique_ids), detail)

    counts = _parse_counts(completed.stdout)
    return CardPreviewPrewarmResult(
        "ok",
        _as_count(counts.get("attempted")) or len(unique_ids),
        "preview prewarm completed",
        generated=_as_count(counts.get("generated")),
        skipped=_as_count(counts.get("skipped")),
        failed=_as_count(counts.get("failed")),
    )
