from __future__ import annotations

import sqlite3
from types import SimpleNamespace

import pytest
from support import (
    OFFICIAL_PAGE_URL,
    SIMAP_SOURCE_URL,
    herbstweg_simap_payload,
    stadt_zuerich_site,
    write_source_catalog,
)

from arch_competition_ops.cli import main
from arch_competition_ops.collectors import CollectedSourceDocument
from arch_competition_ops.settings import Settings
from arch_competition_ops.verifiers.authority_pages import clear_verifier_caches

PDF_URL = (
    "https://www.stadt-zuerich.ch/content/dam/stzh/hbd/hochbau/wettbewerbe/herbstweg-programm.pdf"
)
PAGE_WITH_PRIZE = (
    """
<html>
  <head>
    <title>Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich</title>
    <link rel="canonical" href="%s"/>
  </head>
  <body>
    <h1>Erneuerung und Erweiterung Wohnsiedlung Herbstweg</h1>
    <ul><li><strong>Preisgeld </strong>CHF 167 000 exkl. MWST</li></ul>
  </body>
</html>
""".strip()
    % OFFICIAL_PAGE_URL
)
EMPTY_APP_PAGE = PAGE_WITH_PRIZE.split("<body>")[0] + '<body><div id="app"></div></body></html>'


@pytest.fixture
def simap_workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    write_source_catalog(
        tmp_path, "simap_public_design_notices", verifier="simap_official_enricher"
    )
    clear_verifier_caches()
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda *_a, **_k: [CollectedSourceDocument(SIMAP_SOURCE_URL, herbstweg_simap_payload())],
    )
    monkeypatch.setattr(
        "arch_competition_ops.ingest.enrich_record_geocode", lambda record, **_kwargs: record
    )
    yield tmp_path
    clear_verifier_caches()


def _stored_row(workspace, columns: str):
    settings = Settings(root=workspace)
    connection = sqlite3.connect(settings.resolve_path(settings.db))
    connection.row_factory = sqlite3.Row
    try:
        return connection.execute(f"SELECT {columns} FROM competitions").fetchone()
    finally:
        connection.close()


def test_ingest_source_applies_official_secondary_verifier_before_upsert(
    simap_workspace, monkeypatch
) -> None:
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.authority_pages._fetch_text",
        stadt_zuerich_site(PAGE_WITH_PRIZE),
    )

    assert (
        main(["ingest-source", "--source-id", "simap_public_design_notices", "--limit", "1"]) == 0
    )

    row = _stored_row(
        simap_workspace,
        "official_url, source_url, prize_summary, documents_portal_url, source_id, organizer",
    )
    assert row["official_url"] == OFFICIAL_PAGE_URL
    assert row["source_url"].endswith("publication-details/3b93fb04-442f-4a7c-910e-5e52f8bd8987")
    assert row["prize_summary"] == "Preisgeld CHF 167 000 exkl. MWST"
    assert row["documents_portal_url"] == "https://konkurado.ch/de/ws-herbstweg"
    assert row["source_id"] == "simap_public_design_notices"
    assert row["organizer"] == "HBD - Amt für Hochbauten (AHB)"


def test_ingest_source_applies_browser_fallback_before_upsert(simap_workspace, monkeypatch) -> None:
    def fake_render_page(*, url: str, storage_dir, timeout_ms: int = 20000):
        assert url == OFFICIAL_PAGE_URL
        assert storage_dir.name == "crawlee"
        return SimpleNamespace(
            final_url=OFFICIAL_PAGE_URL,
            html=PAGE_WITH_PRIZE.replace("</body>", f'<a href="{PDF_URL}">Programm PDF</a></body>'),
            text="Erneuerung und Erweiterung Wohnsiedlung Herbstweg Preisgeld CHF 167 000 exkl. MWST",
            title="Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich",
            pdf_links=[PDF_URL],
        )

    monkeypatch.setattr(
        "arch_competition_ops.verifiers.authority_pages._fetch_text",
        stadt_zuerich_site(EMPTY_APP_PAGE),
    )
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.authority_pages.render_page", fake_render_page
    )

    assert (
        main(["ingest-source", "--source-id", "simap_public_design_notices", "--limit", "1"]) == 0
    )

    row = _stored_row(
        simap_workspace,
        "official_url, prize_summary, brief_pdf_url, documents_portal_url, evidence_note",
    )
    assert row["official_url"] == OFFICIAL_PAGE_URL
    assert row["prize_summary"] == "Preisgeld CHF 167 000 exkl. MWST"
    assert row["brief_pdf_url"] == PDF_URL
    assert row["documents_portal_url"] == "https://konkurado.ch/de/ws-herbstweg"
    assert "browser fallback" in row["evidence_note"].lower()
