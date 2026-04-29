from __future__ import annotations

from dataclasses import dataclass

import arch_competition_ops.verifiers.simap as simap_verifier
from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.models import SourceDefinition
from arch_competition_ops.verifiers.simap import clear_verifier_caches, verify_simap_record


def test_verify_simap_record_uses_authority_sitemap_to_upgrade_official_url_and_prize_summary(
    monkeypatch,
) -> None:
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        verifier="simap_official_enricher",
        source_tier="primary",
        enabled=True,
        regions=["europe", "switzerland"],
        languages=["de", "fr", "it"],
    )
    payload = """
    {
      "officialNoticeId": "34414-01",
      "title": "Lotissement Herbstweg, rénovation partielle et densification ; concours ouvert",
      "buyer": "HBD - Amt für Hochbauten (AHB)",
      "procedureType": "open",
      "deadline": "2026-08-27",
      "description": "Projet pour la rénovation de la Wohnsiedlung Herbstweg.",
      "officialUrl": "https://konkurado.ch/de/ws-herbstweg",
      "documentsPortalUrl": "https://konkurado.ch/de/ws-herbstweg",
      "authorityEmail": "AHB-Beschaffungswesen@zuerich.ch",
      "cpv": ["71200000"]
    }
    """
    source_url = (
        "https://www.simap.ch/api/publications/v1/project/"
        "e66757fb-1910-4899-8fc3-7f4bfee043ff/publication-details/"
        "3b93fb04-442f-4a7c-910e-5e52f8bd8987"
    )
    record = parse_source_payload(source, payload, source_url=source_url)

    official_page_url = (
        "https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/"
        "hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html"
    )

    def fake_fetch_text(url: str) -> str:
        if url == "https://zuerich.ch/robots.txt":
            return ""
        if url == "https://www.zuerich.ch/robots.txt":
            return ""
        if url == "https://stadt-zuerich.ch/robots.txt":
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/robots.txt":
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/de.gsitemap.xml":
            return f"""
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{official_page_url}</loc></url>
</urlset>
""".strip()
        if url == official_page_url:
            return """
<html>
  <head>
    <title>Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich</title>
    <link rel="canonical" href="https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html"/>
  </head>
  <body>
    <h1>Erneuerung und Erweiterung Wohnsiedlung Herbstweg</h1>
    <ul>
      <li><strong>Preisgeld </strong>CHF 167 000 exkl. MWST</li>
    </ul>
  </body>
</html>
""".strip()
        raise AssertionError(f"unexpected url {url}")

    clear_verifier_caches()
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.simap._fetch_text",
        fake_fetch_text,
    )

    verified = verify_simap_record(
        source=source,
        payload=payload,
        source_url=source_url,
        record=record,
    )

    assert verified.official_url == official_page_url
    assert verified.prize_summary == "Preisgeld CHF 167 000 exkl. MWST"
    assert verified.documents_portal_url == "https://konkurado.ch/de/ws-herbstweg"
    assert verified.last_verified_at is not None
    assert "Official secondary verification" in (verified.evidence_note or "")


@dataclass
class _FakeBrowserPage:
    final_url: str
    html: str
    text: str
    title: str | None
    pdf_links: list[str]


def test_verify_simap_record_uses_browser_fallback_to_extract_prize_summary_and_pdf_link(
    monkeypatch,
) -> None:
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        verifier="simap_official_enricher",
        source_tier="primary",
        enabled=True,
        regions=["europe", "switzerland"],
        languages=["de", "fr", "it"],
    )
    payload = """
    {
      "officialNoticeId": "34414-01",
      "title": "Lotissement Herbstweg, rénovation partielle et densification ; concours ouvert",
      "buyer": "HBD - Amt für Hochbauten (AHB)",
      "procedureType": "open",
      "deadline": "2026-08-27",
      "description": "Projet pour la rénovation de la Wohnsiedlung Herbstweg.",
      "officialUrl": "https://konkurado.ch/de/ws-herbstweg",
      "documentsPortalUrl": "https://konkurado.ch/de/ws-herbstweg",
      "authorityEmail": "AHB-Beschaffungswesen@zuerich.ch",
      "cpv": ["71200000"]
    }
    """
    source_url = (
        "https://www.simap.ch/api/publications/v1/project/"
        "e66757fb-1910-4899-8fc3-7f4bfee043ff/publication-details/"
        "3b93fb04-442f-4a7c-910e-5e52f8bd8987"
    )
    record = parse_source_payload(source, payload, source_url=source_url)

    official_page_url = (
        "https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/"
        "hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html"
    )
    pdf_url = "https://www.stadt-zuerich.ch/content/dam/stzh/hbd/hochbau/wettbewerbe/herbstweg-programm.pdf"

    def fake_fetch_text(url: str) -> str:
        if url == "https://zuerich.ch/robots.txt":
            return ""
        if url == "https://www.zuerich.ch/robots.txt":
            return ""
        if url == "https://stadt-zuerich.ch/robots.txt":
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/robots.txt":
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/de.gsitemap.xml":
            return f"""
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{official_page_url}</loc></url>
</urlset>
""".strip()
        if url == official_page_url:
            return """
<html>
  <head>
    <title>Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich</title>
    <link rel="canonical" href="https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html"/>
  </head>
  <body>
    <div id="app"></div>
  </body>
</html>
""".strip()
        raise AssertionError(f"unexpected url {url}")

    def fake_render_page(*, url: str, storage_dir, timeout_ms: int = 20000) -> _FakeBrowserPage:
        assert url == official_page_url
        assert storage_dir.name == "crawlee"
        assert timeout_ms == 20000
        return _FakeBrowserPage(
            final_url=official_page_url,
            html=f"""
<html>
  <head>
    <title>Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich</title>
  </head>
  <body>
    <h1>Erneuerung und Erweiterung Wohnsiedlung Herbstweg</h1>
    <p>Preisgeld CHF 167 000 exkl. MWST</p>
    <a href="{pdf_url}">Wettbewerbsprogramm PDF</a>
  </body>
</html>
""".strip(),
            text="Erneuerung und Erweiterung Wohnsiedlung Herbstweg Preisgeld CHF 167 000 exkl. MWST",
            title="Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich",
            pdf_links=[pdf_url],
        )

    clear_verifier_caches()
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.simap._fetch_text",
        fake_fetch_text,
    )
    monkeypatch.setattr(simap_verifier, "render_page", fake_render_page, raising=False)

    verified = verify_simap_record(
        source=source,
        payload=payload,
        source_url=source_url,
        record=record,
    )

    assert verified.official_url == official_page_url
    assert verified.prize_summary == "Preisgeld CHF 167 000 exkl. MWST"
    assert verified.brief_pdf_url == pdf_url
    assert verified.documents_portal_url == "https://konkurado.ch/de/ws-herbstweg"
    assert verified.last_verified_at is not None
    assert "browser fallback" in (verified.evidence_note or "").lower()


def test_verify_simap_record_keeps_source_official_url_when_browser_match_adds_no_material_evidence(
    monkeypatch,
) -> None:
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        verifier="simap_official_enricher",
        source_tier="primary",
        enabled=True,
        regions=["europe", "switzerland"],
        languages=["de", "fr", "it"],
    )
    payload = """
    {
      "officialNoticeId": "31783-01",
      "title": "BAV 40334 Coopération Leimbach Mitte, rénovation complète, réaffectation et extension ; concours de projets sélectif pour les planificateurs généraux",
      "buyer": "HBD - Amt für Hochbauten (AHB)",
      "procedureType": "selective",
      "deadline": "2026-04-21",
      "description": "Concours sélectif pour les planificateurs généraux.",
      "officialUrl": "https://konkurado.ch/de/kooperation-leimbach-mitte",
      "documentsPortalUrl": "https://konkurado.ch/de/kooperation-leimbach-mitte",
      "authorityEmail": "AHB-Beschaffungswesen@zuerich.ch",
      "cpv": ["71200000"]
    }
    """
    source_url = (
        "https://www.simap.ch/api/publications/v1/project/"
        "9377df5f-df26-44bb-8f63-343316cb2788/publication-details/"
        "2ff28b79-d7d5-4a17-b93b-b6e1034bf972"
    )
    record = parse_source_payload(source, payload, source_url=source_url)

    official_page_url = (
        "https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/"
        "hochbauvorhaben/planung-ausfuehrung/schulanlage-leimbach.html"
    )

    def fake_fetch_text(url: str) -> str:
        if url == "https://zuerich.ch/robots.txt":
            return ""
        if url == "https://www.zuerich.ch/robots.txt":
            return ""
        if url == "https://stadt-zuerich.ch/robots.txt":
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/robots.txt":
            return "Sitemap: https://www.stadt-zuerich.ch/de.gsitemap.xml"
        if url == "https://www.stadt-zuerich.ch/de.gsitemap.xml":
            return f"""
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{official_page_url}</loc></url>
</urlset>
""".strip()
        if url == official_page_url:
            return """
<html>
  <head>
    <title>Schulanlage Leimbach | Stadt Zürich</title>
    <link rel="canonical" href="https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/hochbauvorhaben/planung-ausfuehrung/schulanlage-leimbach.html"/>
  </head>
  <body>
    <h1>Schulanlage Leimbach</h1>
    <p>Der Architekturwettbewerb wurde 2022 abgeschlossen.</p>
  </body>
</html>
""".strip()
        raise AssertionError(f"unexpected url {url}")

    def fake_render_page(*, url: str, storage_dir, timeout_ms: int = 20000) -> _FakeBrowserPage:
        assert url == official_page_url
        assert storage_dir.name == "crawlee"
        assert timeout_ms == 20000
        return _FakeBrowserPage(
            final_url=official_page_url,
            html="""
<html>
  <head>
    <title>Schulanlage Leimbach | Stadt Zürich</title>
  </head>
  <body>
    <h1>Schulanlage Leimbach</h1>
    <p>Der Architekturwettbewerb wurde 2022 abgeschlossen.</p>
  </body>
</html>
""".strip(),
            text="Schulanlage Leimbach Der Architekturwettbewerb wurde 2022 abgeschlossen.",
            title="Schulanlage Leimbach | Stadt Zürich",
            pdf_links=[],
        )

    clear_verifier_caches()
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.simap._fetch_text",
        fake_fetch_text,
    )
    monkeypatch.setattr(simap_verifier, "render_page", fake_render_page, raising=False)

    verified = verify_simap_record(
        source=source,
        payload=payload,
        source_url=source_url,
        record=record,
    )

    assert verified.official_url == "https://konkurado.ch/de/kooperation-leimbach-mitte"
    assert verified.prize_summary is None
    assert verified.brief_pdf_url is None
    assert verified.documents_portal_url == "https://konkurado.ch/de/kooperation-leimbach-mitte"
    assert verified.last_verified_at is None
    assert "Official secondary verification" not in (verified.evidence_note or "")
    assert "browser fallback" not in (verified.evidence_note or "").lower()
