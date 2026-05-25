from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_prefix="ARCH_COMPETITION_OPS_",
        extra="ignore",
    )

    root: Path = Field(default_factory=lambda: Path.cwd().resolve())
    db: Path = Path("data") / "competitions.sqlite"
    source_config: Path = Path("config") / "sources.yml"
    filters_config: Path = Path("config") / "filters.yml"
    taxonomy_config: Path = Path("config") / "taxonomy.yml"
    browser_storage_dir: Path = Path("artifacts") / "crawlee"
    geocode_cache: Path = Path("data") / "geocoding-cache.json"
    card_preview_prewarm_enabled: bool = True
    expired_competition_retention_days: int = 7
    expired_cleanup_state: Path = (
        Path("artifacts") / "automation" / "expired-competition-cleanup-state.json"
    )

    def resolve_path(self, path: Path) -> Path:
        if path.is_absolute():
            return path
        return (self.root / path).resolve()
