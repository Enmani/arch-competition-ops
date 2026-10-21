from __future__ import annotations

import pytest
from conftest import REPO_ROOT
from support import build_source as _build_source

from arch_competition_ops.cli import main
from arch_competition_ops.collectors import CollectedSourceDocument, collect_source_documents
from arch_competition_ops.collectors.registry import COLLECTORS, UnknownCollectorError
from arch_competition_ops.collectors.scaffold import collect_scaffold_only_documents
from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.settings import Settings


def test_registry_keys_are_collector_families_not_source_ids() -> None:
    source_ids = {
        source.source_id for source in load_source_catalog(Settings(root=REPO_ROOT)).sources
    }

    # Two families deliberately share their name with the only source that uses them.
    assert source_ids & set(COLLECTORS) <= {"ggzy_public_notices", "municipal_buyer_profiles"}
    assert {"ted_search_api", "boamp_opendatasoft", "simap_project_api"} <= set(COLLECTORS)


def test_all_configured_sources_resolve_to_a_registered_collector_family() -> None:
    catalog = load_source_catalog(Settings(root=REPO_ROOT))

    unresolved = [
        source.source_id for source in catalog.sources if source.collector not in COLLECTORS
    ]

    assert unresolved == []


def test_collector_lookup_uses_only_the_collector_field_never_the_source_id() -> None:
    source = _build_source(
        "ted_design_notices",
        name="TED",
        jurisdiction="eu",
        base_url="https://ted.europa.eu/",
        scan_method="api",
        extractor="ted_notice_parser",
        collector="not_a_registered_family",
    )

    with pytest.raises(UnknownCollectorError, match="not_a_registered_family"):
        collect_source_documents(source, limit=1)


def test_collect_source_documents_supports_explicit_collector_families(monkeypatch) -> None:
    source = _build_source(
        "gets_open_tenders",
        name="GETS Open Tenders",
        jurisdiction="new_zealand",
        base_url="https://www.gets.govt.nz/ExternalRSSFeed.htm",
        scan_method="rss",
        extractor="generic_listing_html",
        collector="gets_rss",
        regions=["oceania", "new_zealand"],
    )

    called: dict[str, str] = {}

    def fake_collect(*_args, **_kwargs) -> list[CollectedSourceDocument]:
        called["collector"] = "gets_rss"
        return [
            CollectedSourceDocument(
                source_url="https://www.gets.govt.nz/MDC/ExternalTenderDetails.htm?id=33799335",
                payload='{"title":"Stormwater Upgrade Design Haybittle Street Feilding"}',
            )
        ]

    monkeypatch.setitem(COLLECTORS, "gets_rss", fake_collect)

    documents = collect_source_documents(source, limit=1)

    assert called == {"collector": "gets_rss"}
    assert len(documents) == 1


def test_collect_scaffold_only_documents_returns_empty_for_disabled_sources() -> None:
    source = _build_source(
        "belgium_public_procurement",
        name="Belgian eProcurement Public Portal",
        jurisdiction="belgium",
        base_url="https://int.publicprocurement.be/",
        scan_method="api",
        extractor="generic_listing_html",
        collector="disabled_scaffold",
        regions=["europe", "belgium"],
        languages=["nl", "fr", "de", "en"],
    ).model_copy(update={"enabled": False})

    assert collect_scaffold_only_documents(source, limit=3) == []


def test_collect_scaffold_only_documents_rejects_accidentally_enabled_sources() -> None:
    source = _build_source(
        "belgium_public_procurement",
        name="Belgian eProcurement Public Portal",
        jurisdiction="belgium",
        base_url="https://int.publicprocurement.be/",
        scan_method="api",
        extractor="generic_listing_html",
        collector="disabled_scaffold",
        regions=["europe", "belgium"],
        languages=["nl", "fr", "de", "en"],
    )

    try:
        collect_scaffold_only_documents(source, limit=3)
    except ValueError as exc:
        assert "scaffold-only collector" in str(exc)
    else:
        raise AssertionError("expected enabled scaffold collector guard")


def test_show_country_coverage_command_reports_enabled_scaffold_and_planned_countries(
    tmp_path,
    monkeypatch,
    capsys,
) -> None:
    monkeypatch.chdir(tmp_path)
    packs_dir = tmp_path / "config" / "source_packs"
    countries_dir = packs_dir / "countries"
    countries_dir.mkdir(parents=True)

    (countries_dir / "canada.yml").write_text(
        """
sources:
  - source_id: canadabuys_tender_notices
    name: CanadaBuys Tender Notices
    kind: official_procurement
    jurisdiction: canada
    base_url: https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv
    scan_method: csv
    collector: canadabuys_csv
    extractor: generic_listing_html
    source_tier: primary
    enabled: true
    regions: [north_america, canada]
    languages: [en, fr]
""".strip(),
        encoding="utf-8",
    )
    (countries_dir / "australia.yml").write_text(
        """
sources:
  - source_id: austender_atm_feed
    name: AusTender Approaches to Market
    kind: official_procurement
    jurisdiction: australia
    base_url: https://www.tenders.gov.au/public_data/rss/rss.xml
    scan_method: rss
    collector: generic_rss_feed
    extractor: generic_listing_html
    source_tier: primary
    enabled: false
    regions: [oceania, australia]
    languages: [en]
""".strip(),
        encoding="utf-8",
    )
    (packs_dir / "planned_countries.yml").write_text(
        "countries:\n  - canada\n  - australia\n  - andorra\n", encoding="utf-8"
    )

    exit_code = main(["show-country-coverage"])

    output = capsys.readouterr().out

    assert exit_code == 0
    assert "Enabled country packs: 1" in output
    assert "Scaffold-only country packs: 1" in output
    assert "Planned countries without a pack: 1" in output
    assert "canada" in output
    assert "australia" in output
    assert "andorra" in output
