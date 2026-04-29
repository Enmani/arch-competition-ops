from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arch_competition_ops.config_loader import load_yaml_file
from arch_competition_ops.settings import Settings


@dataclass(frozen=True)
class CountryPackCoverage:
    enabled: list[str]
    scaffold_only: list[str]
    empty: list[str]


# AI maintenance note:
# - Keep country-pack coverage based on pack files, not enabled source counts in unrelated manifests.
# - This lets multiple AIs add or scaffold countries in parallel and quickly see what remains empty.
def load_country_pack_coverage(settings: Settings) -> CountryPackCoverage:
    countries_dir = settings.resolve_path(Path("config") / "source_packs" / "countries")

    enabled: list[str] = []
    scaffold_only: list[str] = []
    empty: list[str] = []
    for path in sorted(countries_dir.glob("*.yml")):
        data = load_yaml_file(path)
        sources = data.get("sources")
        if not isinstance(sources, list) or not any(isinstance(source, dict) for source in sources):
            empty.append(path.stem)
            continue

        enabled_sources = [
            source
            for source in sources
            if isinstance(source, dict) and bool(source.get("enabled", True))
        ]
        if enabled_sources:
            enabled.append(path.stem)
        else:
            scaffold_only.append(path.stem)

    return CountryPackCoverage(enabled=enabled, scaffold_only=scaffold_only, empty=empty)
