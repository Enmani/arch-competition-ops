from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, PrivateAttr, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_TAXONOMY = Path("config/taxonomy.yml")
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
    taxonomy_config: Path = DEFAULT_TAXONOMY
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
    anthropic_api_key: SecretStr = Field(
        default=SecretStr(""), validation_alias="ANTHROPIC_API_KEY", exclude=True
    )
    ai_provider: Literal["openai", "anthropic"] = "anthropic"
    ai_enabled: bool = False
    ai_model: str = "claude-haiku-5-5"
    ai_reasoning_effort: Literal["low", "medium", "high", "xhigh", "max"] = "low"
    ai_fetch_details: bool = True
    # The batch sets its paid limits once, before parallel assessments start.
    _source_daily_limit: int | None = PrivateAttr(default=None)
    _reading_run_since: str | None = PrivateAttr(default=None)
    discovery_page_cap: int = Field(default=40, ge=1, le=200)
    discovery_window_days: int = Field(default=7, ge=1, le=30)
    unread_max_age_days: int = Field(default=30, ge=1)
    ai_notice_max_attempts: int = Field(default=3, ge=1)
    ai_candidate_cap: int = Field(default=2000, ge=1, le=10000)
    ai_daily_budget_usd: float = Field(default=5, ge=0, allow_inf_nan=False)
    ai_preferences: Path = DEFAULT_AI_SKILL
    ai_monthly_budget_usd: float = Field(default=100, ge=0, allow_inf_nan=False)
    ai_max_output_tokens: int = Field(
        default_factory=lambda values: 16000 if values.get("ai_provider") == "anthropic" else 12288,
        ge=512,
        le=16384,
    )
    ai_max_input_chars: int = Field(default=30000, ge=1000, le=100000)
    ai_timeout_seconds: float = Field(default=120, gt=0, le=300, allow_inf_nan=False)
    # Detailed assessments in flight at once during one source's ingest; 1 is serial. Higher
    # values shorten a large run but raise the chance of provider rate limits (HTTP 429).
    ai_concurrency: int = Field(default=1, ge=1, le=16)

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
