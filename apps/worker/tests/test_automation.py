from __future__ import annotations

from pathlib import Path

from arch_competition_ops.automation import load_automation_config, resolve_batch_sources, run_automation_batch
from arch_competition_ops.settings import Settings


def test_load_automation_config_reads_default_batches(tmp_path) -> None:
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "config" / "automation.yml").write_text(
        """
batches:
  - batch_id: official_daytime
    include_kinds: [official_procurement]
    limit_per_source: 10
    publication_window_days: 7
""".strip(),
        encoding="utf-8",
    )

    settings = Settings(root=tmp_path)
    config = load_automation_config(settings)

    assert len(config.batches) == 1
    assert config.batches[0].batch_id == "official_daytime"
    assert config.batches[0].limit_per_source == 10


def test_resolve_batch_sources_filters_enabled_sources_by_kind(tmp_path) -> None:
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "config" / "sources.yml").write_text(
        """
sources:
  - source_id: ted_design_notices
    name: TED
    kind: official_procurement
    jurisdiction: eu
    base_url: https://ted.europa.eu/
    scan_method: api
    extractor: ted_notice_parser
    enabled: true
  - source_id: municipal_buyer_profiles
    name: Municipal
    kind: authority_portal
    jurisdiction: germany
    base_url: https://example.gov/
    scan_method: html
    extractor: buyer_profile_parser
    enabled: true
  - source_id: bustler_competitions
    name: Bustler
    kind: aggregator
    jurisdiction: global
    base_url: https://example.com/
    scan_method: html
    extractor: generic_listing_html
    enabled: false
""".strip(),
        encoding="utf-8",
    )
    (tmp_path / "config" / "automation.yml").write_text(
        """
batches:
  - batch_id: official_daytime
    include_kinds: [official_procurement]
  - batch_id: secondary_nightly
    include_kinds: [authority_portal, aggregator]
""".strip(),
        encoding="utf-8",
    )

    settings = Settings(root=tmp_path)

    official_batch, official_sources = resolve_batch_sources(settings, batch_id="official_daytime")
    secondary_batch, secondary_sources = resolve_batch_sources(settings, batch_id="secondary_nightly")

    assert official_batch.batch_id == "official_daytime"
    assert [source.source_id for source in official_sources] == ["ted_design_notices"]
    assert secondary_batch.batch_id == "secondary_nightly"
    assert [source.source_id for source in secondary_sources] == ["municipal_buyer_profiles"]


def test_run_automation_batch_uses_default_window_and_accumulates_results(tmp_path, monkeypatch) -> None:
    (tmp_path / "config").mkdir(parents=True)
    (tmp_path / "config" / "sources.yml").write_text(
        """
sources:
  - source_id: ted_design_notices
    name: TED
    kind: official_procurement
    jurisdiction: eu
    base_url: https://ted.europa.eu/
    scan_method: api
    extractor: ted_notice_parser
    enabled: true
  - source_id: simap_public_design_notices
    name: SIMAP
    kind: official_procurement
    jurisdiction: switzerland
    base_url: https://www.simap.ch/
    scan_method: api
    extractor: simap_notice_parser
    enabled: true
""".strip(),
        encoding="utf-8",
    )
    (tmp_path / "config" / "automation.yml").write_text(
        """
batches:
  - batch_id: official_daytime
    include_kinds: [official_procurement]
    limit_per_source: 11
    publication_window_days: 7
""".strip(),
        encoding="utf-8",
    )

    captured_calls: list[tuple[str, int, str | None]] = []

    def fake_ingest_source(settings: Settings, *, source_id: str, limit: int, publication_date_from: str | None):
        del settings
        captured_calls.append((source_id, limit, publication_date_from))
        return [f"{source_id}-001"]

    monkeypatch.setattr("arch_competition_ops.automation.ingest_source", fake_ingest_source)

    settings = Settings(root=tmp_path)
    result = run_automation_batch(settings, batch_id="official_daytime")

    assert result.batch_id == "official_daytime"
    assert result.total_sources == 2
    assert result.total_ingested == 2
    assert len(result.failed) == 0
    assert len(result.succeeded) == 2
    assert captured_calls[0][0] == "ted_design_notices"
    assert captured_calls[1][0] == "simap_public_design_notices"
    assert all(call[1] == 11 for call in captured_calls)
    assert all(call[2] is not None for call in captured_calls)
