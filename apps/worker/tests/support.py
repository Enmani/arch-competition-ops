"""Helpers shared by the worker tests (imported by plain module name; tests/ is on sys.path)."""

from __future__ import annotations

import json
import shutil
from datetime import timedelta
from pathlib import Path

from arch_competition_ops import clock
from arch_competition_ops.http import HttpTransportError
from arch_competition_ops.models import SourceDefinition

REPO_ROOT = Path(__file__).resolve().parents[3]

# Source definitions the ingest/CLI tests write into a temporary config/sources.yml. They mirror
# the real catalog entries (config/source_packs) closely enough for the pipeline under test.
_SOURCE_YAML = {
    "ted_design_notices": """
  - source_id: ted_design_notices
    name: TED Design and Procurement Notices
    kind: official_procurement
    jurisdiction: eu
    base_url: https://ted.europa.eu/
    collector: ted_search_api
    scan_method: api
    extractor: ted_notice_parser
    source_tier: primary
    enabled: true
    regions: [europe]
    languages: [en]
""",
    "simap_public_design_notices": """
  - source_id: simap_public_design_notices
    name: simap Swiss Public Procurement
    kind: official_procurement
    jurisdiction: switzerland
    base_url: https://www.simap.ch/
    collector: simap_project_api
    scan_method: api
    extractor: simap_notice_parser
{verifier}    source_tier: primary
    enabled: true
    regions: [europe, switzerland]
    languages: [de, fr, it]
""",
}


def write_source_catalog(root: Path, *source_ids: str, verifier: str | None = None) -> None:
    """Write ``config/sources.yml`` (and ``data/``) under ``root`` with the named sources."""
    (root / "config").mkdir(exist_ok=True)
    (root / "data").mkdir(exist_ok=True)
    verifier_line = f"    verifier: {verifier}\n" if verifier else ""
    blocks = [
        _SOURCE_YAML[source_id].replace("{verifier}", verifier_line) for source_id in source_ids
    ]
    text = "sources:" + ("".join(blocks) if blocks else " []\n")
    (root / "config" / "sources.yml").write_text(text, encoding="utf-8")
    # A checkout always has the shared procedure registry next to sources.yml.
    shutil.copy(REPO_ROOT / "config" / "procedure-type-registry.json", root / "config")


def build_source(
    source_id: str,
    *,
    name: str,
    jurisdiction: str,
    base_url: str,
    scan_method: str,
    extractor: str,
    collector: str,
    source_tier: str = "primary",
    regions: list[str] | None = None,
    languages: list[str] | None = None,
    enabled: bool = True,
) -> SourceDefinition:
    return SourceDefinition(
        source_id=source_id,
        name=name,
        kind="official_procurement",
        jurisdiction=jurisdiction,
        base_url=base_url,
        scan_method=scan_method,
        extractor=extractor,
        collector=collector,
        source_tier=source_tier,
        enabled=enabled,
        regions=regions or ["europe"],
        languages=languages or ["en"],
    )


OFFICIAL_PAGE_URL = (
    "https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/"
    "hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html"
)
SIMAP_SOURCE_URL = (
    "https://www.simap.ch/api/publications/v1/project/"
    "e66757fb-1910-4899-8fc3-7f4bfee043ff/publication-details/"
    "3b93fb04-442f-4a7c-910e-5e52f8bd8987"
)


def herbstweg_simap_payload() -> str:
    """A simap notice whose authority (Stadt Zurich) publishes its own page for the project."""
    return json.dumps(
        {
            "officialNoticeId": "34414-01",
            "title": "Lotissement Herbstweg, rénovation partielle et densification ; concours ouvert",
            "buyer": "HBD - Amt für Hochbauten (AHB)",
            "procedureType": "open",
            "deadline": (clock.today() + timedelta(days=60)).isoformat(),
            "description": "Projet pour la rénovation de la Wohnsiedlung Herbstweg.",
            "officialUrl": "https://konkurado.ch/de/ws-herbstweg",
            "documentsPortalUrl": "https://konkurado.ch/de/ws-herbstweg",
            "authorityEmail": "AHB-Beschaffungswesen@zuerich.ch",
            "cpv": ["71200000"],
        },
        ensure_ascii=False,
    )


def stadt_zuerich_site(page_html: str):
    """Offline fetcher: robots/sitemap of stadt-zuerich.ch plus one official page."""

    sitemap = (
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
        f"<url><loc>{OFFICIAL_PAGE_URL}</loc></url></urlset>"
    )

    def fetch(url: str) -> str:
        if url in ("https://zuerich.ch/robots.txt", "https://www.zuerich.ch/robots.txt"):
            return ""
        if url in (
            "https://stadt-zuerich.ch/robots.txt",
            "https://www.stadt-zuerich.ch/robots.txt",
        ):
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/de.gsitemap.xml":
            return sitemap
        if url == OFFICIAL_PAGE_URL:
            return page_html
        raise HttpTransportError("offline test fake: no such page", url=url)

    return fetch


MINIMAL_TAXONOMY = "\n".join(
    f"{key}: [{values}]"
    for key, values in {
        "regions": "europe",
        "languages": "en",
        "source_kinds": "official_procurement",
        "source_tiers": "primary, secondary",
        "scan_methods": "api, html",
        "competition_statuses": "discovered",
        "competition_types": "architecture",
        "opportunity_types": "unknown",
        "procedure_types": "open",
        "implementation_paths": "",
        "evidence_levels": "official_notice",
        "audience": "professionals",
        "project_types": "",
        "building_categories": "",
    }.items()
)


def write_minimal_config(root: Path, sources_yaml: str) -> None:
    """A config/ directory just complete enough for doctor/verify to run."""
    (root / "config").mkdir(exist_ok=True)
    (root / "config" / "sources.yml").write_text(sources_yaml, encoding="utf-8")
    (root / "config" / "filters.yml").write_text("targeting: {}\n", encoding="utf-8")
    (root / "config" / "taxonomy.yml").write_text(MINIMAL_TAXONOMY + "\n", encoding="utf-8")
