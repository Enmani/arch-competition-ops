from __future__ import annotations

import json

from support import build_source as _build_source


def test_collect_municipal_buyer_profile_documents_requires_explicit_urls() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        jurisdiction="mixed",
        base_url="https://example.gov.local/",
        scan_method="html",
        extractor="buyer_profile_parser",
    )

    try:
        collect_municipal_buyer_profile_documents(source, limit=1, profile_urls=[])
    except ValueError as exc:
        assert "municipal profile urls" in str(exc).lower()
    else:
        raise AssertionError("expected explicit municipal profile URL requirement")


def test_collect_municipal_buyer_profile_documents_expands_berlin_rss_into_detail_backed_payloads() -> (
    None
):
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        jurisdiction="germany",
        base_url="https://www.berlin.de/vergabeplattform/veroeffentlichungen/bekanntmachungen/feed.rss",
        scan_method="rss",
        extractor="buyer_profile_parser",
        languages=["de", "en"],
        regions=["europe", "germany"],
    )

    feed_url = source.base_url
    feed = """
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Leistungen der Objekt- und Fachplanung sowie besondere Leistungen</title>
      <description><![CDATA[
        Verfahrensart: Verhandlungsverfahren mit Teilnahmewettbewerb<br>
        Ablauf der Teilnahmefrist: 18.05.2026, 10:00 Uhr<br>
        Online seit: 17.04.2026
      ]]></description>
      <link>https://meinauftrag.rib.de/public/DetailsByPlatformIdAndTenderId/platformId/2/tenderId/203860</link>
      <pubDate>Fri, 17 Apr 2026 00:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Berlin TXL - UTR - Projektsteuerung - Gebäude L</title>
      <description><![CDATA[
        Verfahrensart: Verhandlungsverfahren mit Teilnahmewettbewerb<br>
        Ablauf der Teilnahmefrist: 03.07.2026, 12:00 Uhr<br>
        Online seit: 17.04.2026
      ]]></description>
      <link>https://meinauftrag.rib.de/public/DetailsByPlatformIdAndTenderId/platformId/2/tenderId/205148</link>
      <pubDate>Fri, 17 Apr 2026 00:00:00 +0000</pubDate>
    </item>
    <item>
      <title>Beschaffung von Druckertinte</title>
      <description><![CDATA[
        Verfahrensart: Öffentliche Ausschreibung (UVgO)<br>
        Ablauf der Angebotsfrist: 29.04.2026, 10:00 Uhr<br>
        Online seit: 15.04.2026
      ]]></description>
      <link>https://meinauftrag.rib.de/public/DetailsByPlatformIdAndTenderId/platformId/2/tenderId/205038</link>
      <pubDate>Wed, 15 Apr 2026 00:00:00 +0000</pubDate>
    </item>
  </channel>
</rss>
""".strip()

    responses = {
        feed_url: feed,
        "https://meinauftrag.rib.de/public/DetailsByPlatformIdAndTenderId/platformId/2/tenderId/203860": (
            "<html><body><h4>Leistungen der Objekt- und Fachplanung sowie besondere Leistungen</h4>"
            "<h6><strong>Contracting Authority</strong></h6>Tegel Projekt GmbH</body></html>"
        ),
        "https://meinauftrag.rib.de/public/DetailsByPlatformIdAndTenderId/platformId/2/tenderId/205148": (
            "<html><body><h4>Berlin TXL - UTR - Projektsteuerung - Gebäude L</h4>"
            "<h6><strong>Contracting Authority</strong></h6>Tegel Projekt GmbH</body></html>"
        ),
    }

    documents = collect_municipal_buyer_profile_documents(
        source,
        limit=5,
        fetch_text=lambda url: responses[url],
    )

    assert len(documents) == 2
    assert documents[0].source_url.endswith("tenderId/203860")
    assert documents[1].source_url.endswith("tenderId/205148")

    first_payload = json.loads(documents[0].payload)
    assert (
        first_payload["title"]
        == "Leistungen der Objekt- und Fachplanung sowie besondere Leistungen"
    )
    assert first_payload["procedureType"] == "Verhandlungsverfahren mit Teilnahmewettbewerb"
    assert first_payload["deadline"] == "2026-05-18"
    assert first_payload["officialNoticeId"] == "203860"
    assert first_payload["publishedAt"] == "2026-04-17"
    assert "Contracting Authority" in first_payload["detailHtml"]


def test_collect_municipal_buyer_profile_documents_expands_frankfurt_nettender_listing() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        jurisdiction="germany",
        base_url=(
            "https://www.vergabe.stadt-frankfurt.de/NetServer/"
            "PublicationSearchControllerServlet?function=SearchPublications&Gesetzesgrundlage=All"
            "&Category=InvitationToTender&thContext=publications"
        ),
        scan_method="html",
        extractor="buyer_profile_parser",
        languages=["de", "en"],
        regions=["europe", "germany"],
    )

    listing = """
<table>
  <tr class="tableRow clickable-row publicationDetail" data-oid="54321-NetTender-frankfurt-001" data-category="InvitationToTender">
    <td>16.04.2026</td>
    <td class="tender">Ingenieurleistungen Freianlagen Schulcampus (66-2026-00024)</td>
    <td class="tenderAuthority">Amt 66 - Amt für Straßenbau und Erschließung</td>
    <td class="tenderType">UVgO/VgV, Offenes Verfahren</td>
    <td class="tenderDeadline">08.05.2026 12:00</td>
  </tr>
  <tr class="tableRow clickable-row publicationDetail" data-oid="54321-NetTender-frankfurt-002" data-category="InvitationToTender">
    <td>16.04.2026</td>
    <td class="tender">Lieferung von Büromaterial</td>
    <td class="tenderAuthority">Amt 20 - Kämmerei</td>
    <td class="tenderType">UVgO/VgV, Offenes Verfahren</td>
    <td class="tenderDeadline">30.04.2026 12:00</td>
  </tr>
</table>
""".strip()

    data_provider_url = "https://www.vergabe.stadt-frankfurt.de/NetServer/DataProvider"
    detail_url = (
        "https://www.vergabe.stadt-frankfurt.de/NetServer/PublicationControllerServlet"
        "?function=Detail&TOID=54321-NetTender-frankfurt-001&Category=InvitationToTender"
    )
    detail_html = """
<html>
  <body>
    <h2 class="smallGrey">Ingenieurleistungen Freianlagen Schulcampus 66-2026-00024</h2>
    <table>
      <tr><td>Beschaffer</td><td>Offizielle Bezeichnung: Stadt Frankfurt am Main, Amt für Straßenbau und Erschließung<br></td></tr>
      <tr><td>Beschreibung</td><td>Interne Kennung: 66-2026-00024<br>Titel: Ingenieurleistungen Freianlagen Schulcampus<br>Art des Auftrags: Dienstleistungen</td></tr>
      <tr><td>Fristen</td><td>Frist für den Eingang der Angebote: 08.05.2026 12:00 Uhr</td></tr>
      <tr><td>CPV</td><td>CPV-Code Hauptteil: 71322000-1</td></tr>
      <tr><td>Beschreibung der Beschaffung</td><td>Beschreibung: Freianlagenplanung für die Erweiterung eines Schulcampus.</td></tr>
    </table>
  </body>
</html>
""".strip()

    documents = collect_municipal_buyer_profile_documents(
        source,
        limit=5,
        fetch_text=lambda url: {
            source.base_url: listing,
            detail_url: detail_html,
        }[url],
        post_text=lambda url, data: {
            (data_provider_url, "54321-NetTender-frankfurt-001"): (
                "PublicationControllerServlet?function=Detail&TOID=54321-NetTender-frankfurt-001"
                "&Category=InvitationToTender"
            ),
            (data_provider_url, "54321-NetTender-frankfurt-002"): (
                "PublicationControllerServlet?function=Detail&TOID=54321-NetTender-frankfurt-002"
                "&Category=InvitationToTender"
            ),
        }[(url, data["OID"])],
    )

    assert len(documents) == 1
    assert documents[0].source_url == detail_url

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Ingenieurleistungen Freianlagen Schulcampus (66-2026-00024)"
    assert payload["authority"] == "Amt 66 - Amt für Straßenbau und Erschließung"
    assert payload["publishedAt"] == "2026-04-16"
    assert payload["deadline"] == "2026-05-08"
    assert payload["sourceListingUrl"] == source.base_url
    assert "Offizielle Bezeichnung" in payload["detailHtml"]


def test_collect_municipal_buyer_profile_documents_expands_stuttgart_nettender_listing() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        jurisdiction="germany",
        base_url="https://lhs-vpbw.vmstart.de/NetServer/PublicationSearchControllerServlet?function=SearchPublications",
        scan_method="html",
        extractor="buyer_profile_parser",
        languages=["de", "en"],
        regions=["europe", "germany"],
    )

    listing = """
<table>
  <tr class="tableRow clickable-row publicationDetail" data-oid="54321-NetTender-stuttgart-001" data-category="ContractAward">
    <td>16.04.2026</td>
    <td class="tender">Projektsteuerung Neubau Stadtteilbibliothek (2026-013-Fe-B)</td>
    <td class="tenderAuthority">Dienstleistungszentrum</td>
    <td class="tenderType">Beschränkte Ausschreibung</td>
    <td class="tenderType">UVgO/VgV</td>
    <td class="tenderDeadline"></td>
  </tr>
  <tr class="tableRow clickable-row publicationDetail" data-oid="54321-NetTender-stuttgart-002" data-category="InvitationToTender">
    <td>14.04.2026</td>
    <td class="tender">Ingenieurleistungen Stadtbahnhaltestelle Möhringen (2026-039-WS-Ö)</td>
    <td class="tenderAuthority">Dienstleistungszentrum</td>
    <td class="tenderType">Öffentliche Ausschreibung</td>
    <td class="tenderType">UVgO/VgV</td>
    <td class="tenderDeadline">05.05.2026 12:00</td>
  </tr>
</table>
""".strip()

    data_provider_url = "https://lhs-vpbw.vmstart.de/NetServer/DataProvider"
    detail_url = (
        "https://lhs-vpbw.vmstart.de/NetServer/PublicationControllerServlet"
        "?function=Detail&TOID=54321-NetTender-stuttgart-002&Category=InvitationToTender"
    )
    detail_html = """
<html>
  <body>
    <h2 class="smallGrey">Ingenieurleistungen Stadtbahnhaltestelle Möhringen 2026-039-WS-Ö</h2>
    <table>
      <tr><td>Vergabenr.</td><td>2026-039-WS-Ö</td></tr>
      <tr><td>Name und Anschrift:</td><td>Landeshauptstadt Stuttgart, Haupt- und Personalamt, Abt. Allgemeiner Service, Zentraler Einkauf<br>70173 Stuttgart<br>Deutschland</td></tr>
      <tr><td>Art der Leistung:</td><td>Ingenieurleistungen für die Neuordnung einer Stadtbahnhaltestelle.</td></tr>
      <tr><td>Angebote sind einzureichen bis:</td><td>05.05.2026 12:00</td></tr>
      <tr><td>unter (URL:)</td><td><a href="https://lhs-vpbw.vmstart.de/NetServer/TenderingProcedureDetails?function=_Details&TenderOID=54321-Tender-stuttgart-002">Vergabeunterlagen</a></td></tr>
    </table>
  </body>
</html>
""".strip()

    documents = collect_municipal_buyer_profile_documents(
        source,
        limit=5,
        fetch_text=lambda url: {
            source.base_url: listing,
            detail_url: detail_html,
        }[url],
        post_text=lambda url, data: {
            (data_provider_url, "54321-NetTender-stuttgart-001"): (
                "PublicationControllerServlet?function=Detail&TOID=54321-NetTender-stuttgart-001"
                "&Category=ContractAward"
            ),
            (data_provider_url, "54321-NetTender-stuttgart-002"): (
                "PublicationControllerServlet?function=Detail&TOID=54321-NetTender-stuttgart-002"
                "&Category=InvitationToTender"
            ),
        }[(url, data["OID"])],
    )

    assert len(documents) == 1
    assert documents[0].source_url == detail_url

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Ingenieurleistungen Stadtbahnhaltestelle Möhringen (2026-039-WS-Ö)"
    assert payload["authority"] == "Dienstleistungszentrum"
    assert payload["publishedAt"] == "2026-04-14"
    assert payload["deadline"] == "2026-05-05"
    assert payload["procedureType"] == "Öffentliche Ausschreibung / UVgO/VgV"


def test_collect_municipal_buyer_profile_documents_expands_hamburg_listing() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        jurisdiction="germany",
        base_url=(
            "https://www.hamburg.de/politik-und-verwaltung/ausschreibungen/"
            "lieferungen-und-leistungen-vgv-uvgo-"
        ),
        scan_method="html",
        extractor="buyer_profile_parser",
        languages=["de", "en"],
        regions=["europe", "germany"],
    )

    detail_url = (
        "https://www.hamburg.de/politik-und-verwaltung/ausschreibungen/"
        "lieferungen-und-leistungen-vgv-uvgo-/julius-ludowieg-strasse-projektsteuerung-"
        "in-anlehnung-an-2-3-aho-heft-nr-9-1156936"
    )
    listing = """
<div class="km1-teaser km1-teaser-list__teaser">
  <div class="km1-teaser__content">
    <span class="km1-topline">GMH | Gebäudemanagement Hamburg</span>
    <a href="/politik-und-verwaltung/ausschreibungen/lieferungen-und-leistungen-vgv-uvgo-/julius-ludowieg-strasse-projektsteuerung-in-anlehnung-an-2-3-aho-heft-nr-9-1156936" class="km1-teaser__heading-link">
      <h3 class="km1-heading km1-heading--3 km1-teaser__heading">Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9</h3>
    </a>
    <p class="km1-paragraph km1-teaser__paragraph">Einreichungsfrist: 20.04.2026, 14:00 Uhr</p>
  </div>
</div>
<div class="km1-teaser km1-teaser-list__teaser">
  <div class="km1-teaser__content">
    <span class="km1-topline">Beschaffungs- und Vergabecenter Finanzbehörde</span>
    <a href="/politik-und-verwaltung/ausschreibungen/lieferungen-und-leistungen-vgv-uvgo-/digitalisierung-von-mikrofilmen-fuer-das-staatsarchiv--1153570" class="km1-teaser__heading-link">
      <h3 class="km1-heading km1-heading--3 km1-teaser__heading">Digitalisierung von Mikrofilmen für das Staatsarchiv</h3>
    </a>
    <p class="km1-paragraph km1-teaser__paragraph">Einreichungsfrist: 23.04.2026, 10:00 Uhr</p>
  </div>
</div>
""".strip()

    detail_html = """
<html>
  <body>
    <span class="km1-topline">GMH | Gebäudemanagement Hamburg</span>
    <h1 class="km1-heading km1-article__heading">Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9</h1>
    <div class="km1-richtext">
      <h2><strong>Kurzüberblick</strong></h2>
      <p>Einreichungsfrist: <strong>20.04.2026, 14:00 Uhr</strong></p>
      <p>Verfahrensinhalt: Umbaumaßnahmen für eine Stadtteilschule am Standort Julius-Ludowieg-Str. in Hamburg - Projektsteuerung und Projektleitung in Anlehnung an §§ 2+3 AHO Heft Nr. 9</p>
      <p>Ausschreibungsnummer: <strong>GMH VgV VV 015-26 AO</strong></p>
      <p>Die vollständigen Ausschreibungsunterlagen stehen auf unserem <a href="https://fbhh-evergabe.web.hamburg.de/evergabe.bieter/eva/supplierportal/fhh/tabs/home" target="_blank" rel="noopener">Bieterportal</a> zur Verfügung.</p>
      <p>Ausschreibende Stelle: GMH | Gebäudemanagement Hamburg</p>
    </div>
  </body>
</html>
""".strip()

    documents = collect_municipal_buyer_profile_documents(
        source,
        limit=5,
        fetch_text=lambda url: {
            source.base_url: listing,
            detail_url: detail_html,
        }[url],
    )

    assert len(documents) == 1
    assert documents[0].source_url == detail_url

    payload = json.loads(documents[0].payload)
    assert (
        payload["title"]
        == "Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9"
    )
    assert payload["authority"] == "GMH | Gebäudemanagement Hamburg"
    assert payload["deadline"] == "2026-04-20"
    assert payload["sourceListingUrl"] == source.base_url
    assert "Ausschreibungsnummer" in payload["detailHtml"]
