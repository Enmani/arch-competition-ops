from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Worker settings. Environment variables use the ``ARCH_COMPETITION_OPS_`` prefix.

    The database path is ``ARCH_COMPETITION_OPS_DB`` everywhere (worker, Web app, scripts); there
    is no second variable for it.
    """

    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="ARCH_COMPETITION_OPS_",
        extra="ignore",
        populate_by_name=True,
    )

    root: Path = Field(default_factory=lambda: Path.cwd().resolve())
    db: Path = Path("data") / "competitions.sqlite"
    source_config: Path = Path("config") / "sources.yml"
    filters_config: Path = Path("config") / "filters.yml"
    taxonomy_config: Path = Path("config") / "taxonomy.yml"
    browser_storage_dir: Path = Path("artifacts") / "crawlee"
    geocode_cache: Path = Path("data") / "geocoding-cache.json"
    html_archive_dir: Path = Path("artifacts") / "html"
    expired_competition_retention_days: int = 7
    expired_cleanup_state: Path = (
        Path("artifacts") / "automation" / "expired-competition-cleanup-state.json"
    )
    ingest_lock: Path = Path("artifacts") / "automation" / "ingest.lock"

    # Opportunity card previews are generated offline by packages/previews (a Node CLI). When
    # ARCH_PREVIEW_PREWARM=1 the worker runs that CLI, with fixed arguments and no shell, after
    # each ingest for the newly ingested ids. The variable names are shared with the Web side's
    # preview tooling, so they deliberately ignore the worker prefix.
    preview_prewarm: bool = Field(default=False, validation_alias="ARCH_PREVIEW_PREWARM")
    preview_node: str = Field(default="node", validation_alias="ARCH_PREVIEW_NODE")
    preview_prewarm_timeout_seconds: float = 900.0
    # Where the preview CLI writes images and manifest.json (also read by the Web app).
    preview_dir: Path = Field(
        default=Path("artifacts") / "previews", validation_alias="ARCH_PREVIEWS_DIR"
    )

    def resolve_path(self, path: Path) -> Path:
        if path.is_absolute():
            return path
        return (self.root / path).resolve()
