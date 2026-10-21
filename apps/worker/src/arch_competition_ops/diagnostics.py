"""``doctor`` and ``verify``: repository and configuration health checks."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arch_competition_ops.bootstrap import initialize_database
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.config_loader import (
    load_source_catalog,
    load_targeting_preferences,
    load_taxonomy,
)
from arch_competition_ops.extractors import PARSERS
from arch_competition_ops.review_queue import refresh_review_queue
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import find_duplicate_records
from arch_competition_ops.verifiers import VERIFIERS


@dataclass
class CheckResult:
    ok: bool
    label: str
    detail: str | None = None


def _required_directories(settings: Settings) -> list[Path]:
    return [
        settings.resolve_path(Path("data")),
        settings.resolve_path(Path("data") / "inbox"),
        settings.resolve_path(settings.html_archive_dir),
        settings.resolve_path(Path("artifacts") / "pdf"),
        settings.resolve_path(Path("artifacts") / "logs"),
        settings.resolve_path(Path("artifacts") / "automation"),
        settings.resolve_path(settings.browser_storage_dir),
        settings.resolve_path(Path("reports")),
    ]


def run_doctor(settings: Settings) -> list[CheckResult]:
    results: list[CheckResult] = []

    results.append(CheckResult(settings.root.exists(), "repository root", str(settings.root)))

    for directory in _required_directories(settings):
        directory.mkdir(parents=True, exist_ok=True)
        results.append(CheckResult(True, "directory ready", str(directory)))

    try:
        db_path = initialize_database(settings)
        results.append(CheckResult(True, "database schema", str(db_path)))
    except Exception as exc:  # noqa: BLE001 - a health check reports any failure instead of crashing
        results.append(CheckResult(False, "database schema", str(exc)))

    for loader, label in (
        (load_source_catalog, "source catalog"),
        (load_targeting_preferences, "targeting preferences"),
        (load_taxonomy, "taxonomy"),
    ):
        try:
            payload = loader(settings)
            results.append(CheckResult(True, label, type(payload).__name__))
        except Exception as exc:  # noqa: BLE001 - see above
            results.append(CheckResult(False, label, str(exc)))

    return results


def _unknown(values: list[str], allowed: set[str]) -> list[str]:
    return sorted({value for value in values if value not in allowed})


def _check_sources(settings: Settings) -> list[CheckResult]:
    results: list[CheckResult] = []
    sources = load_source_catalog(settings).sources
    taxonomy = load_taxonomy(settings)

    source_ids = [source.source_id for source in sources]
    duplicate_ids = sorted({value for value in source_ids if source_ids.count(value) > 1})
    if duplicate_ids:
        results.append(CheckResult(False, "unique source ids", ", ".join(duplicate_ids)))
    else:
        results.append(CheckResult(True, "unique source ids"))

    enabled_sources = [source for source in sources if source.enabled]
    if enabled_sources:
        results.append(CheckResult(True, "enabled sources", str(len(enabled_sources))))
    else:
        results.append(CheckResult(False, "enabled sources", "No enabled sources"))

    problems = {
        "kinds": _unknown([s.kind for s in sources], set(taxonomy.source_kinds)),
        "tiers": _unknown([s.source_tier for s in sources], set(taxonomy.source_tiers)),
        "scan_methods": _unknown([s.scan_method for s in sources], set(taxonomy.scan_methods)),
        "verifiers": _unknown([s.verifier for s in sources if s.verifier], set(VERIFIERS)),
    }
    problems = {name: values for name, values in problems.items() if values}
    if problems:
        detail = "; ".join(f"{name}={values}" for name, values in problems.items())
        results.append(CheckResult(False, "source taxonomy alignment", detail))
    else:
        results.append(CheckResult(True, "source taxonomy alignment"))

    # Every source (enabled or not) must name real implementations, so enabling a scaffold
    # source cannot be the first time a typo surfaces.
    wiring = {
        "collectors": _unknown([s.collector for s in sources], set(COLLECTORS)),
        "extractors": _unknown([s.extractor for s in sources], set(PARSERS)),
    }
    wiring = {name: values for name, values in wiring.items() if values}
    if wiring:
        detail = "; ".join(f"{name}={values}" for name, values in wiring.items())
        results.append(CheckResult(False, "source collector/extractor wiring", detail))
    else:
        results.append(CheckResult(True, "source collector/extractor wiring"))
    return results


def _check_filters(settings: Settings) -> CheckResult:
    taxonomy = load_taxonomy(settings)
    filters = load_targeting_preferences(settings)
    problems = {
        "competition_types": sorted(
            set(filters.competition_types) - set(taxonomy.competition_types)
        ),
        "audience": sorted(set(filters.audience) - set(taxonomy.audience)),
        "regions": sorted(set(filters.regions) - set(taxonomy.regions)),
        "opportunity_types": sorted(
            set(filters.opportunity_types) - set(taxonomy.opportunity_types)
        ),
        "procedure_types": sorted(set(filters.procedure_types) - set(taxonomy.procedure_types)),
        "evidence_levels": sorted(set(filters.evidence_levels) - set(taxonomy.evidence_levels)),
    }
    problems = {name: values for name, values in problems.items() if values}
    if problems:
        detail = "; ".join(f"{name}={values}" for name, values in problems.items())
        return CheckResult(False, "filters within taxonomy", detail)
    return CheckResult(True, "filters within taxonomy")


def run_verify(settings: Settings) -> list[CheckResult]:
    results = run_doctor(settings)
    db_path = settings.resolve_path(settings.db)

    try:
        results.extend(_check_sources(settings))
    except Exception as exc:  # noqa: BLE001 - report instead of crashing the whole verify run
        results.append(CheckResult(False, "source verification", str(exc)))

    try:
        results.append(_check_filters(settings))
    except Exception as exc:  # noqa: BLE001 - report instead of crashing the whole verify run
        results.append(CheckResult(False, "taxonomy verification", str(exc)))

    # dedup_key is a cross-source duplicate *signal* (title + buyer + deadline), not an identity,
    # so clusters are reported for the review queue rather than failing verification.
    duplicates = find_duplicate_records(db_path)
    detail = (
        f"{len(duplicates)} dedup-key clusters routed to the review queue" if duplicates else None
    )
    results.append(CheckResult(True, "database duplicates", detail))

    try:
        queue_candidates = refresh_review_queue(db_path)
        results.append(
            CheckResult(
                True, "ops review queue", f"{len(queue_candidates)} active worker candidates"
            )
        )
    except Exception as exc:  # noqa: BLE001 - report instead of crashing the whole verify run
        results.append(CheckResult(False, "ops review queue", str(exc)))

    return results
