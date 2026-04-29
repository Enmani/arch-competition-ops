from __future__ import annotations

from pathlib import Path

from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.settings import Settings


EUROPEAN_COUNTRY_PACKS = [
    "albania",
    "andorra",
    "armenia",
    "austria",
    "azerbaijan",
    "belarus",
    "belgium",
    "bosnia_and_herzegovina",
    "bulgaria",
    "croatia",
    "cyprus",
    "czechia",
    "denmark",
    "estonia",
    "finland",
    "france",
    "georgia",
    "germany",
    "greece",
    "hungary",
    "iceland",
    "ireland",
    "italy",
    "kosovo",
    "latvia",
    "liechtenstein",
    "lithuania",
    "luxembourg",
    "malta",
    "moldova",
    "monaco",
    "montenegro",
    "netherlands",
    "north_macedonia",
    "norway",
    "poland",
    "portugal",
    "romania",
    "russia",
    "san_marino",
    "serbia",
    "slovakia",
    "slovenia",
    "spain",
    "sweden",
    "switzerland",
    "turkiye",
    "ukraine",
    "united_kingdom",
    "vatican_city",
]

EXTRA_REGION_COUNTRY_PACKS = [
    "australia",
    "canada",
    "new_zealand",
]


def test_load_source_catalog_merges_manifest_include_globs_and_external_lists(tmp_path) -> None:
    (tmp_path / "config" / "source_packs" / "countries").mkdir(parents=True)
    (tmp_path / "config" / "source_lists").mkdir(parents=True)

    (tmp_path / "config" / "sources.yml").write_text(
        """
include_paths:
  - config/source_packs/core.yml
include_globs:
  - config/source_packs/countries/*.yml
""".strip(),
        encoding="utf-8",
    )
    (tmp_path / "config" / "source_packs" / "core.yml").write_text(
        """
sources:
  - source_id: ted_design_notices
    name: TED Design and Procurement Notices
    kind: official_procurement
    jurisdiction: eu
    base_url: https://ted.europa.eu/
    scan_method: api
    extractor: ted_notice_parser
    source_tier: primary
    enabled: true
    regions: [europe]
    languages: [en]
""".strip(),
        encoding="utf-8",
        )
    (tmp_path / "config" / "source_packs" / "italy.yml").write_text(
        "",
        encoding="utf-8",
    )
    (tmp_path / "config" / "source_packs" / "countries" / "italy.yml").write_text(
        """
sources:
  - source_id: serviziocontrattipubblici_hub
    name: Servizio Contratti Pubblici
    kind: official_procurement
    jurisdiction: italy
    base_url: https://www.serviziocontrattipubblici.it/
    buyer_allowlist_path: config/source_lists/italy_city_authorities.txt
    scan_method: html
    extractor: procurement_hub_parser
    source_tier: primary
    enabled: true
    regions: [europe, italy]
    languages: [it, en]
""".strip(),
        encoding="utf-8",
    )
    (tmp_path / "config" / "source_lists" / "italy_city_authorities.txt").write_text(
        "comune di milano\nroma capitale\n",
        encoding="utf-8",
    )

    catalog = load_source_catalog(Settings(root=tmp_path))

    assert [source.source_id for source in catalog.sources] == [
        "ted_design_notices",
        "serviziocontrattipubblici_hub",
    ]
    italy_source = next(
        source for source in catalog.sources if source.source_id == "serviziocontrattipubblici_hub"
    )
    assert italy_source.buyer_allowlist == ["comune di milano", "roma capitale"]


def test_repo_has_country_pack_file_for_every_european_country() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    countries_dir = repo_root / "config" / "source_packs" / "countries"

    pack_names = {path.stem for path in countries_dir.glob("*.yml")}

    assert set(EUROPEAN_COUNTRY_PACKS).issubset(pack_names)


def test_repo_has_scaffold_pack_files_for_canada_and_oceania() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    countries_dir = repo_root / "config" / "source_packs" / "countries"

    pack_names = {path.stem for path in countries_dir.glob("*.yml")}

    assert set(EXTRA_REGION_COUNTRY_PACKS).issubset(pack_names)


def test_municipal_buyer_profiles_include_expanded_german_city_portals() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    catalog = load_source_catalog(Settings(root=repo_root))

    source = next(
        candidate for candidate in catalog.sources if candidate.source_id == "municipal_buyer_profiles"
    )
    urls = source.url_list

    assert urls == [
        "https://www.berlin.de/vergabeplattform/veroeffentlichungen/bekanntmachungen/feed.rss",
        (
            "https://www.vergabe.stadt-frankfurt.de/NetServer/PublicationSearchControllerServlet"
            "?function=SearchPublications&Gesetzesgrundlage=All&Category=InvitationToTender"
            "&thContext=publications"
        ),
        "https://lhs-vpbw.vmstart.de/NetServer/PublicationSearchControllerServlet?function=SearchPublications",
        "https://www.hamburg.de/politik-und-verwaltung/ausschreibungen/lieferungen-und-leistungen-vgv-uvgo-",
        (
            "https://vergabe.muenchen.de/NetServer/PublicationSearchControllerServlet"
            "?function=SearchPublications&Gesetzesgrundlage=VOF&Category=InvitationToTender"
            "&thContext=publications"
        ),
        (
            "https://vergabeplattform.stadt-koeln.de/NetServer/PublicationSearchControllerServlet"
            "?Category=InvitationToTender&Gesetzesgrundlage=All&function=SearchPublications"
            "&thContext=publications"
        ),
        (
            "https://vergabe.duesseldorf.de/NetServer/PublicationSearchControllerServlet"
            "?Category=InvitationToTender&Gesetzesgrundlage=All&function=SearchPublications"
            "&thContext=publications"
        ),
    ]


def test_serviziocontrattipubblici_hub_loads_curated_italian_city_allowlist() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    catalog = load_source_catalog(Settings(root=repo_root))

    source = next(
        candidate for candidate in catalog.sources if candidate.source_id == "serviziocontrattipubblici_hub"
    )

    assert source.buyer_allowlist == [
        "comune di milano",
        "comune di torino",
        "comune di bologna",
        "comune di firenze",
        "roma capitale",
        "comune di napoli",
        "comune di genova",
        "comune di venezia",
        "comune di bari",
        "comune di palermo",
        "comune di parma",
        "comune di ravenna",
        "comune di catania",
        "comune di verona",
        "comune di padova",
        "comune di trieste",
        "comune di modena",
        "comune di reggio emilia",
        "comune di cagliari",
        "comune di perugia",
    ]


def test_catalog_loads_recent_non_eu_and_additional_europe_sources() -> None:
    repo_root = Path(__file__).resolve().parents[3]
    catalog = load_source_catalog(Settings(root=repo_root))

    source_ids = {source.source_id for source in catalog.sources}

    assert {
        "canadabuys_tender_notices",
        "gets_open_tenders",
        "uk_contracts_finder_tenders",
        "austender_atm_feed",
        "tenderned_contract_notices",
        "doffin_notices",
        "pcsp_syndicated_notices",
    }.issubset(source_ids)
