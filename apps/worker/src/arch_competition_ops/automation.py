from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date, timedelta
from pathlib import Path

from pydantic import BaseModel, Field

from arch_competition_ops.config_loader import load_source_catalog, load_yaml_file
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.operations import ingest_source
from arch_competition_ops.settings import Settings


DEFAULT_AUTOMATION_CONFIG_PATH = Path("config") / "automation.yml"


class AutomationBatchDefinition(BaseModel):
    batch_id: str
    description: str | None = None
    include_kinds: list[str] = Field(default_factory=list)
    include_source_ids: list[str] = Field(default_factory=list)
    exclude_source_ids: list[str] = Field(default_factory=list)
    enabled_only: bool = True
    limit_per_source: int = Field(default=20, ge=1)
    publication_window_days: int | None = Field(default=None, ge=1)


class AutomationConfig(BaseModel):
    batches: list[AutomationBatchDefinition] = Field(default_factory=list)


@dataclass
class AutomationSourceRun:
    source_id: str
    ingested_count: int
    ingested_ids: list[str] = field(default_factory=list)
    publication_date_from: str | None = None


@dataclass
class AutomationSourceFailure:
    source_id: str
    error: str


@dataclass
class AutomationBatchResult:
    batch_id: str
    source_ids: list[str]
    publication_date_from: str | None
    limit_per_source: int
    succeeded: list[AutomationSourceRun] = field(default_factory=list)
    failed: list[AutomationSourceFailure] = field(default_factory=list)

    @property
    def total_sources(self) -> int:
        return len(self.source_ids)

    @property
    def total_ingested(self) -> int:
        return sum(run.ingested_count for run in self.succeeded)

    def to_dict(self) -> dict[str, object]:
        return {
            "batch_id": self.batch_id,
            "source_ids": list(self.source_ids),
            "publication_date_from": self.publication_date_from,
            "limit_per_source": self.limit_per_source,
            "total_sources": self.total_sources,
            "total_ingested": self.total_ingested,
            "succeeded": [asdict(run) for run in self.succeeded],
            "failed": [asdict(failure) for failure in self.failed],
        }


def load_automation_config(
    settings: Settings,
    *,
    config_path: Path = DEFAULT_AUTOMATION_CONFIG_PATH,
) -> AutomationConfig:
    data = load_yaml_file(settings.resolve_path(config_path))
    return AutomationConfig.model_validate(data)


def _get_batch_definition(config: AutomationConfig, batch_id: str) -> AutomationBatchDefinition:
    for batch in config.batches:
        if batch.batch_id == batch_id:
            return batch
    raise ValueError(f"Unknown automation batch: {batch_id}")


def list_automation_batches(
    settings: Settings,
    *,
    config_path: Path = DEFAULT_AUTOMATION_CONFIG_PATH,
) -> list[AutomationBatchDefinition]:
    return load_automation_config(settings, config_path=config_path).batches


def resolve_batch_sources(
    settings: Settings,
    *,
    batch_id: str,
    config_path: Path = DEFAULT_AUTOMATION_CONFIG_PATH,
) -> tuple[AutomationBatchDefinition, list[SourceDefinition]]:
    config = load_automation_config(settings, config_path=config_path)
    batch = _get_batch_definition(config, batch_id)
    catalog = load_source_catalog(settings)
    include_source_ids = set(batch.include_source_ids)
    include_kinds = set(batch.include_kinds)
    exclude_source_ids = set(batch.exclude_source_ids)
    known_source_ids = {source.source_id for source in catalog.sources}
    missing_source_ids = sorted(include_source_ids - known_source_ids)
    if missing_source_ids:
        raise ValueError(
            f"Automation batch '{batch_id}' references unknown source ids: {', '.join(missing_source_ids)}"
        )

    selected_sources: list[SourceDefinition] = []
    for source in catalog.sources:
        if source.source_id in exclude_source_ids:
            continue
        if batch.enabled_only and not source.enabled:
            continue

        matches_source_id = source.source_id in include_source_ids
        matches_kind = source.kind in include_kinds
        if include_source_ids or include_kinds:
            if not (matches_source_id or matches_kind):
                continue

        selected_sources.append(source)

    if not selected_sources:
        raise ValueError(f"Automation batch '{batch_id}' resolved to no sources")

    return batch, selected_sources


def _default_publication_date_from(window_days: int | None) -> str | None:
    if window_days is None:
        return None
    return (date.today() - timedelta(days=window_days)).isoformat()


def run_automation_batch(
    settings: Settings,
    *,
    batch_id: str,
    config_path: Path = DEFAULT_AUTOMATION_CONFIG_PATH,
    limit_per_source: int | None = None,
    publication_date_from: str | None = None,
    continue_on_error: bool = True,
) -> AutomationBatchResult:
    batch, sources = resolve_batch_sources(
        settings,
        batch_id=batch_id,
        config_path=config_path,
    )
    effective_limit = limit_per_source or batch.limit_per_source
    effective_publication_date_from = publication_date_from or _default_publication_date_from(
        batch.publication_window_days
    )
    result = AutomationBatchResult(
        batch_id=batch.batch_id,
        source_ids=[source.source_id for source in sources],
        publication_date_from=effective_publication_date_from,
        limit_per_source=effective_limit,
    )

    for source in sources:
        try:
            ingested_ids = ingest_source(
                settings,
                source_id=source.source_id,
                limit=effective_limit,
                publication_date_from=effective_publication_date_from,
            )
        except Exception as exc:  # noqa: BLE001
            result.failed.append(
                AutomationSourceFailure(
                    source_id=source.source_id,
                    error=str(exc),
                )
            )
            if not continue_on_error:
                raise
            continue

        result.succeeded.append(
            AutomationSourceRun(
                source_id=source.source_id,
                ingested_count=len(ingested_ids),
                ingested_ids=ingested_ids,
                publication_date_from=effective_publication_date_from,
            )
        )

    return result
