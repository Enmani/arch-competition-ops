from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml

from arch_competition_ops.models import SourceCatalog, TargetingPreferences, Taxonomy
from arch_competition_ops.settings import Settings

# AI maintenance note:
# - Keep config/sources.yml as a thin manifest.
# - Add country work in config/source_packs/countries/{country}.yml, not by appending to one giant YAML.
# - Put bulky URL sets and buyer allowlists in config/source_lists/ and load them by path.
# - This loader is the single expansion point for pack includes and external list refs.

def load_yaml_file(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(f"Missing config file: {path}")

    payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    if payload is None:
        return {}
    if not isinstance(payload, dict):
        raise ValueError(f"Config file must contain a mapping: {path}")
    return payload


def load_line_list(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Missing list file: {path}")

    values: list[str] = []
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        values.append(line)
    return values


def _expand_single_source_refs(settings: Settings, raw_source: dict[str, Any]) -> dict[str, Any]:
    source = dict(raw_source)

    url_list_path = source.get("url_list_path")
    if isinstance(url_list_path, str) and url_list_path.strip():
        source["url_list"] = load_line_list(settings.resolve_path(Path(url_list_path)))

    buyer_allowlist_path = source.get("buyer_allowlist_path")
    if isinstance(buyer_allowlist_path, str) and buyer_allowlist_path.strip():
        source["buyer_allowlist"] = load_line_list(
            settings.resolve_path(Path(buyer_allowlist_path))
        )

    return source


def _collect_sources_from_data(
    settings: Settings,
    data: dict[str, Any],
    *,
    visited_includes: set[Path] | None = None,
) -> list[dict[str, Any]]:
    visited = visited_includes or set()
    merged_sources: list[dict[str, Any]] = []

    raw_sources = data.get("sources", [])
    if isinstance(raw_sources, list):
        for raw_source in raw_sources:
            if isinstance(raw_source, dict):
                merged_sources.append(_expand_single_source_refs(settings, raw_source))

    include_paths = data.get("include_paths", [])
    if isinstance(include_paths, list):
        for raw_include_path in include_paths:
            if not isinstance(raw_include_path, str) or not raw_include_path.strip():
                continue

            include_path = settings.resolve_path(Path(raw_include_path))
            if include_path in visited:
                raise ValueError(f"Cyclic source include detected: {include_path}")

            include_data = load_yaml_file(include_path)
            merged_sources.extend(
                _collect_sources_from_data(
                    settings,
                    include_data,
                    visited_includes=visited | {include_path},
                )
            )

    include_globs = data.get("include_globs", [])
    if isinstance(include_globs, list):
        for raw_include_glob in include_globs:
            if not isinstance(raw_include_glob, str) or not raw_include_glob.strip():
                continue

            matches = sorted(settings.root.glob(raw_include_glob))
            for include_path in matches:
                if include_path in visited:
                    raise ValueError(f"Cyclic source include detected: {include_path}")

                include_data = load_yaml_file(include_path)
                merged_sources.extend(
                    _collect_sources_from_data(
                        settings,
                        include_data,
                        visited_includes=visited | {include_path},
                    )
                )

    return merged_sources


def load_source_catalog(settings: Settings) -> SourceCatalog:
    data = load_yaml_file(settings.resolve_path(settings.source_config))
    return SourceCatalog.model_validate({
        "sources": _collect_sources_from_data(settings, data),
    })


def load_targeting_preferences(settings: Settings) -> TargetingPreferences:
    data = load_yaml_file(settings.resolve_path(settings.filters_config))
    targeting = data.get("targeting", {})
    return TargetingPreferences.model_validate(targeting)


def load_taxonomy(settings: Settings) -> Taxonomy:
    data = load_yaml_file(settings.resolve_path(settings.taxonomy_config))
    return Taxonomy.model_validate(data)
