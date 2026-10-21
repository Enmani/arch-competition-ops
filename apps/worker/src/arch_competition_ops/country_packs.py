from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from arch_competition_ops.config_loader import load_yaml_file
from arch_competition_ops.settings import Settings

PACKS_DIR = Path("config") / "source_packs"
PLANNED_COUNTRIES_FILE = PACKS_DIR / "planned_countries.yml"


@dataclass(frozen=True)
class CountryPackCoverage:
    enabled: list[str]
    scaffold_only: list[str]
    planned_without_pack: list[str]


# AI maintenance note:
# - Coverage is derived from pack files (not from enabled source counts in unrelated manifests),
#   so several people can add countries in parallel and see what is still open.
# - A country gets a pack file only once it has a real or scaffold source. Countries we intend to
#   cover but have no source for yet are listed in planned_countries.yml instead of as empty files.
def load_country_pack_coverage(settings: Settings) -> CountryPackCoverage:
    countries_dir = settings.resolve_path(PACKS_DIR / "countries")

    enabled: list[str] = []
    scaffold_only: list[str] = []
    pack_names: set[str] = set()
    for path in sorted(countries_dir.glob("*.yml")):
        pack_names.add(path.stem)
        sources = load_yaml_file(path).get("sources")
        source_entries = [source for source in sources or [] if isinstance(source, dict)]
        if any(bool(source.get("enabled", True)) for source in source_entries):
            enabled.append(path.stem)
        else:
            scaffold_only.append(path.stem)

    planned_path = settings.resolve_path(PLANNED_COUNTRIES_FILE)
    planned = load_yaml_file(planned_path).get("countries", []) if planned_path.exists() else []
    planned_without_pack = sorted(
        name for name in planned if isinstance(name, str) and name not in pack_names
    )

    return CountryPackCoverage(
        enabled=enabled,
        scaffold_only=scaffold_only,
        planned_without_pack=planned_without_pack,
    )
