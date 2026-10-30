from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_AI_SKILL = Path("config/skills/screen-architecture-opportunities/SKILL.md")


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

    openai_api_key: SecretStr = Field(
        default=SecretStr(""),
        validation_alias=AliasChoices("OPENAI_API_KEY", "ARCH_COMPETITION_OPS_OPENAI_API_KEY"),
        exclude=True,
    )
    ai_enabled: bool = False
    ai_model: str = "gpt-6-luna"
    ai_reasoning_effort: Literal["low", "medium", "high", "xhigh", "max"] = "high"
    ai_fetch_details: bool = True
    ai_triage_enabled: bool = True
    ai_candidate_multiplier: int = Field(default=5, ge=1, le=10)
    ai_triage_exclude_threshold: float = Field(default=0.98, ge=0.8, le=1)
    ai_daily_budget_usd: float = Field(default=1, ge=0, allow_inf_nan=False)
    ai_preferences: Path = DEFAULT_AI_SKILL
    ai_monthly_budget_usd: float = Field(default=31, ge=0, allow_inf_nan=False)
    ai_max_output_tokens: int = Field(default=12288, ge=512, le=16384)
    ai_max_input_chars: int = Field(default=30000, ge=1000, le=100000)
    ai_timeout_seconds: float = Field(default=120, gt=0, le=300, allow_inf_nan=False)

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
