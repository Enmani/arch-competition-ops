from __future__ import annotations

import json
import sqlite3
from datetime import date
from pathlib import Path
from types import SimpleNamespace

from arch_competition_ops.cli import main
from arch_competition_ops.collectors import CollectedSourceDocument, collect_source_documents
from arch_competition_ops.collectors.canadabuys import collect_canadabuys_documents
from arch_competition_ops.collectors.contracts_finder import collect_contracts_finder_documents
from arch_competition_ops.collectors.doffin import collect_doffin_documents
from arch_competition_ops.collectors.generic_rss import collect_generic_rss_documents
from arch_competition_ops.collectors.pcsp import collect_pcsp_documents
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.collectors.scaffold import collect_scaffold_only_documents
from arch_competition_ops.collectors.ted import collect_ted_documents
from arch_competition_ops.collectors.tenderned import collect_tenderned_documents
from arch_competition_ops.config_loader import load_source_catalog
from arch_competition_ops.models import CompetitionRecord, SourceDefinition
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import list_competitions, upsert_competition


def _build_source(
    source_id: str,
    *,
    name: str,
    jurisdiction: str,
    base_url: str,
    scan_method: str,
    extractor: str,
    collector: str | None = None,
    source_tier: str = "primary",
    regions: list[str] | None = None,
    languages: list[str] | None = None,
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
        enabled=True,
        regions=regions or ["europe"],
        languages=languages or ["en"],
    )


def test_registry_contains_all_enabled_live_sources() -> None:
    expected = {
        "ted_design_notices",
        "boamp_design_notices",
        "simap_public_design_notices",
        "anac_bdncp_contracts",
        "serviziocontrattipubblici_hub",
        "municipal_buyer_profiles",
        "competitions_archi",
        "tenderned_publications_api",
        "doffin_search_api",
        "pcsp_atom_feed",
    }

    assert expected.issubset(set(COLLECTORS))


def test_all_configured_sources_resolve_to_a_registered_collector_family() -> None:
    settings = Settings()
    unresolved = []

    for source in load_source_catalog(settings).sources:
        collector_key = source.source_id if source.source_id in COLLECTORS else source.collector
        if collector_key in COLLECTORS:
            continue
        unresolved.append(source.source_id)

    assert unresolved == []


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


def test_show_country_coverage_command_reports_enabled_scaffold_and_empty_packs(
    tmp_path,
    monkeypatch,
    capsys,
) -> None:
    monkeypatch.chdir(tmp_path)
    countries_dir = tmp_path / "config" / "source_packs" / "countries"
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
    (countries_dir / "andorra.yml").write_text("sources: []\n", encoding="utf-8")

    exit_code = main(["show-country-coverage"])

    output = capsys.readouterr().out

    assert exit_code == 0
    assert "Enabled country packs: 1" in output
    assert "Scaffold-only country packs: 1" in output
    assert "Empty country packs: 1" in output
    assert "canada" in output
    assert "australia" in output
    assert "andorra" in output


def test_collect_generic_rss_documents_excludes_non_design_marketplace_feeds() -> None:
    source = _build_source(
        "gets_open_tenders",
        name="GETS Open Tenders",
        jurisdiction="new_zealand",
        base_url="https://www.gets.govt.nz/ExternalRSSFeed.htm",
        scan_method="rss",
        extractor="generic_listing_html",
        collector="generic_rss_feed",
        regions=["oceania", "new_zealand"],
    )
    rss_feed = """
<rss version="2.0">
  <channel>
    <item>
      <title>NZ Government Marketplace - Standing Open Invitation to Apply</title>
      <link>https://www.gets.govt.nz/DIA/ExternalTenderDetails.htm?id=33732411</link>
      <description><![CDATA[
        <table>
          <tr><td><b>RFx ID: </b></td><td>33732411</td></tr>
          <tr><td><b>Organisation: </b></td><td>Department of Internal Affairs</td></tr>
          <tr><td><b>Close date: </b></td><td>Friday, 25 May 2029 5:00 PM +12:00</td></tr>
          <tr><td valign="top"><b>Categories: </b></td><td>43000000 - Information Technology Broadcasting and Telecommunications<br>81110000 - Computer services</td></tr>
          <tr><td valign="top"><b>Overview: </b></td><td>The Marketplace simplifies how the NZ Government buys ICT services.</td></tr>
        </table>
      ]]></description>
      <pubDate>Tue, 24 Mar 2026 21:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
""".strip()

    documents = collect_generic_rss_documents(
        source,
        limit=5,
        fetch_text=lambda _url: rss_feed,
    )

    assert documents == []


def test_collect_generic_rss_documents_excludes_digital_and_maintenance_false_positives() -> None:
    source = _build_source(
        "gets_open_tenders",
        name="GETS Open Tenders",
        jurisdiction="new_zealand",
        base_url="https://www.gets.govt.nz/ExternalRSSFeed.htm",
        scan_method="rss",
        extractor="generic_listing_html",
        collector="generic_rss_feed",
        regions=["oceania", "new_zealand"],
    )
    rss_feed = """
<rss version="2.0">
  <channel>
    <item>
      <title>Future Procurement Opportunities - Health Digital Investment Plan</title>
      <link>https://www.gets.govt.nz/HEALTHNZ/ExternalTenderDetails.htm?id=33099110</link>
      <description><![CDATA[
        <table>
          <tr><td><b>RFx ID: </b></td><td>33099110</td></tr>
          <tr><td><b>Organisation: </b></td><td>Health New Zealand (Te Whatu Ora)</td></tr>
          <tr><td valign="top"><b>Categories: </b></td><td>85000000 - Healthcare Services</td></tr>
          <tr><td valign="top"><b>Overview: </b></td><td>Health New Zealand’s digital strategic direction is to consolidate, standardise, and fill gaps in the existing application landscape.</td></tr>
        </table>
      ]]></description>
      <pubDate>Tue, 24 Mar 2026 21:00:00 GMT</pubDate>
    </item>
    <item>
      <title>ROAD NETWORK MAINTENANCE &amp; RENEWAL2026/RO/01</title>
      <link>https://www.gets.govt.nz/GDC/ExternalTenderDetails.htm?id=33920315</link>
      <description><![CDATA[
        <table>
          <tr><td><b>RFx ID: </b></td><td>33920315</td></tr>
          <tr><td><b>Organisation: </b></td><td>Gore District Council</td></tr>
          <tr><td valign="top"><b>Categories: </b></td><td>30120000 - Roads and landscape<br>72141100 - Infrastructure building and surfacing and paving services</td></tr>
          <tr><td valign="top"><b>Overview: </b></td><td>Road network maintenance, renewals and improvements.</td></tr>
        </table>
      ]]></description>
      <pubDate>Thu, 16 Apr 2026 19:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>
""".strip()

    documents = collect_generic_rss_documents(
        source,
        limit=5,
        fetch_text=lambda _url: rss_feed,
    )

    assert documents == []


def test_collect_canadabuys_documents_excludes_accommodation_services() -> None:
    source = _build_source(
        "canadabuys_tender_notices",
        name="CanadaBuys Tender Notices",
        jurisdiction="canada",
        base_url="https://canadabuys.canada.ca/opendata/pub/openTenderNotice-ouvertAvisAppelOffres.csv",
        scan_method="csv",
        extractor="generic_listing_html",
        collector="canadabuys_csv",
        regions=["north_america", "canada"],
        languages=["en", "fr"],
    )
    csv_text = """
title-titre-eng,title-titre-fra,referenceNumber-numeroReference,solicitationNumber-numeroSollicitation,publicationDate-datePublication,tenderClosingDate-appelOffresDateCloture,procurementCategory-categorieApprovisionnement,unspscDescription-eng,noticeURL-URLavis-eng
W0100-266428 Accommodation Services,W0100-266428 Services Des Locaux,WS5649365008-Doc5649659942,WS5649365008,2026-04-10,2026-05-04T14:00:00,*SRV,"*Hotels and lodging and meeting facilities",https://portal.us.bn.cloud.ariba.com/dashboard/public/appext/comsapsbncdiscoveryui#/RfxEvent/preview/1110010517?anId=ANONYMOUS
""".strip()

    documents = collect_canadabuys_documents(
        source,
        limit=5,
        fetch_text=lambda _url: csv_text,
    )

    assert documents == []


def test_collect_contracts_finder_documents_excludes_non_design_building_works() -> None:
    source = _build_source(
        "uk_contracts_finder_tenders",
        name="UK Contracts Finder Tenders",
        jurisdiction="united_kingdom",
        base_url="https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search",
        scan_method="api",
        extractor="generic_listing_html",
        collector="contracts_finder_ocds",
        regions=["europe", "united_kingdom"],
    )
    api_response = {
        "releases": [
            {
                "ocid": "ocds-b5fd17-f43b47dc-a591-4652-b9c1-a31602c9a4c0",
                "date": "2026-04-17T17:27:10+01:00",
                "tender": {
                    "title": "CA17613 - Woolwich PolyMAT - External Canopy Works",
                    "description": "External canopy replacement works for a school site.",
                    "classification": {"scheme": "CPV", "id": "45223800", "description": "Assembly and erection of prefabricated structures"},
                    "tenderPeriod": {"endDate": "2026-05-14T12:00:00+01:00"},
                    "documents": [{"url": "https://www.contractsfinder.service.gov.uk/Notice/example"}],
                },
                "buyer": {"name": "Woolwich Polytechnic School"},
            }
        ]
    }

    documents = collect_contracts_finder_documents(
        source,
        limit=5,
        fetch_json=lambda _url: api_response,
    )

    assert documents == []


def test_collect_contracts_finder_documents_includes_estimated_value_text_from_ocds_release() -> None:
    source = _build_source(
        "uk_contracts_finder_tenders",
        name="UK Contracts Finder Tenders",
        jurisdiction="united_kingdom",
        base_url="https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search",
        scan_method="api",
        extractor="generic_listing_html",
        collector="contracts_finder_ocds",
        regions=["europe", "united_kingdom"],
    )
    api_response = {
        "releases": [
            {
                "ocid": "ocds-b5fd17-f76102bd",
                "date": "2026-04-17T17:27:10+01:00",
                "tender": {
                    "title": "Marden Parish Council Pavilion Refurbishment",
                    "description": "Extension and alterations to a public pavilion building.",
                    "classification": {"scheme": "CPV", "id": "71242000", "description": "Project and design preparation"},
                    "tenderPeriod": {"endDate": "2026-05-09T12:00:00+01:00"},
                    "documents": [{"url": "https://www.contractsfinder.service.gov.uk/Notice/f76102bd-3540-4b82-9256-cdc20e19bd42"}],
                    "value": {"amount": 1000000, "currency": "GBP"},
                },
                "buyer": {"name": "Marden Parish Council"},
            }
        ]
    }

    documents = collect_contracts_finder_documents(
        source,
        limit=5,
        fetch_json=lambda _url: api_response,
    )

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["estimatedValueEur"] is None
    assert payload["estimatedValueText"] == "GBP 1,000,000"


def test_collect_contracts_finder_documents_caps_live_query_limit_to_100() -> None:
    source = _build_source(
        "uk_contracts_finder_tenders",
        name="UK Contracts Finder Tenders",
        jurisdiction="united_kingdom",
        base_url="https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search",
        scan_method="api",
        extractor="generic_listing_html",
        collector="contracts_finder_ocds",
        regions=["europe", "united_kingdom"],
    )
    captured: dict[str, str] = {}

    def fake_fetch_json(url: str) -> dict:
        captured["url"] = url
        return {"releases": []}

    documents = collect_contracts_finder_documents(
        source,
        limit=20,
        fetch_json=fake_fetch_json,
    )

    assert documents == []
    assert "limit=100" in captured["url"]


def test_collect_tenderned_documents_transforms_design_relevant_service_notices() -> None:
    source = _build_source(
        "tenderned_contract_notices",
        name="TenderNed Contract Notices",
        jurisdiction="netherlands",
        base_url="https://www.tenderned.nl/papi/tenderned-rs-tns/v2/publicaties",
        scan_method="api",
        extractor="generic_listing_html",
        collector="tenderned_publications_api",
        regions=["europe", "netherlands"],
        languages=["nl", "en"],
    )

    list_response = {
        "content": [
            {
                "publicatieId": "421000",
                "publicatieDatum": "2026-04-18",
                "typePublicatie": {"code": "AAO", "omschrijving": "Aankondiging opdracht"},
                "aanbestedingNaam": "Architectenselectie schoolcampus en sporthal",
                "opdrachtgeverNaam": "Gemeente Utrecht",
                "sluitingsDatum": "2026-05-30T10:00:00",
                "procedure": {"code": "OPE", "omschrijving": "Openbaar"},
                "typeOpdracht": {"code": "D", "omschrijving": "Diensten"},
                "publicatiestatus": {"code": "PUB", "omschrijving": "Gepubliceerd"},
                "link": {"href": "https://www.tenderned.nl/aankondigingen/overzicht/421000"},
                "opdrachtBeschrijving": "Selectie van een architect voor een nieuwe schoolcampus en sporthal.",
            },
            {
                "publicatieId": "421001",
                "publicatieDatum": "2026-04-18",
                "typePublicatie": {"code": "AAO", "omschrijving": "Aankondiging opdracht"},
                "aanbestedingNaam": "Brokerdienstverlening",
                "opdrachtgeverNaam": "Waterschap Delta",
                "sluitingsDatum": "2026-05-30T10:00:00",
                "procedure": {"code": "OPE", "omschrijving": "Openbaar"},
                "typeOpdracht": {"code": "D", "omschrijving": "Diensten"},
                "publicatiestatus": {"code": "PUB", "omschrijving": "Gepubliceerd"},
                "link": {"href": "https://www.tenderned.nl/aankondigingen/overzicht/421001"},
                "opdrachtBeschrijving": "Brokerdienstverlening voor inhuur.",
            },
        ],
        "last": True,
    }
    detail_response = {
        "publicatieId": 421000,
        "aanbestedingNaam": "Architectenselectie schoolcampus en sporthal",
        "opdrachtgeverNaam": "Gemeente Utrecht",
        "opdrachtBeschrijving": "Selectie van een architect voor een nieuwe schoolcampus en sporthal.",
        "sluitingsDatum": "2026-05-30T10:00:00",
        "procedureCode": {"code": "OPE", "omschrijving": "Openbaar"},
        "typeOpdrachtCode": {"code": "D", "omschrijving": "Diensten"},
        "cpvCodes": [
            {"isHoofdOpdracht": True, "code": "71220000-6", "omschrijving": "Architectonische ontwerpdiensten"},
            {"isHoofdOpdracht": False, "code": "71420000-8", "omschrijving": "Landschapsarchitectuurdiensten"},
        ],
        "links": {
            "pdf": {"href": "/papi/tenderned-rs-tns/v2/publicaties/421000/pdf", "title": "pdf"},
        },
        "link": {"href": "https://www.tenderned.nl/aankondigingen/overzicht/421000"},
    }

    documents = collect_tenderned_documents(
        source,
        limit=5,
        fetch_json=lambda url: (
            list_response
            if "publicaties?" in url
            else detail_response
        ),
    )

    assert len(documents) == 1
    assert documents[0].source_url.endswith("/421000")

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Architectenselectie schoolcampus en sporthal"
    assert payload["buyer"] == "Gemeente Utrecht"
    assert payload["noticeId"] == "421000"
    assert payload["deadline"] == "2026-05-30"
    assert payload["cpv"] == ["71220000", "71420000"]
    assert payload["officialUrl"] == "https://www.tenderned.nl/aankondigingen/overzicht/421000"
    assert payload["briefPdfUrl"].endswith("/421000/pdf")


def test_collect_doffin_documents_transforms_filtered_notice_hits() -> None:
    source = _build_source(
        "doffin_notices",
        name="Doffin Notices",
        jurisdiction="norway",
        base_url="https://api.doffin.no/webclient/api/v2/search-api/search",
        scan_method="api",
        extractor="generic_listing_html",
        collector="doffin_search_api",
        regions=["europe", "norway"],
        languages=["no", "en"],
    )

    search_response = {
        "hits": [
            {
                "id": "2026-106919",
                "heading": "Rammeavtale planfagleg rådgjevingsteneste",
                "description": (
                    "Øygarden kommune ønskjer å etablere rammeavtale med føretak som i hovudsak "
                    "leverer rådgjeving innan planlegging og reguleringsplanar."
                ),
                "deadline": "2026-05-18T10:00:00Z",
                "publicationDate": "2026-04-17",
                "buyer": [{"name": "Øygarden kommune"}],
            },
            {
                "id": "2026-107035",
                "heading": "Konsulenttjenester for Naturtypekartlegging",
                "description": "Kartlegging av naturtyper i kommunen.",
                "deadline": "2026-05-04T10:00:58Z",
                "publicationDate": "2026-04-19",
                "buyer": [{"name": "Loppa Kommune"}],
            },
        ]
    }
    detail_responses = {
        "https://api.doffin.no/webclient/api/v2/notices-api/notices/2026-106919": {
            "id": "2026-106919",
            "heading": "Rammeavtale planfagleg rådgjevingsteneste",
            "description": (
                "Øygarden kommune ønskjer å etablere rammeavtale med føretak som i hovudsak "
                "leverer rådgjeving innan planlegging og reguleringsplanar."
            ),
            "deadline": "2026-05-18T10:00:00Z",
            "publicationDate": "2026-04-17",
            "buyer": [{"name": "Øygarden kommune"}],
            "core": {
                "estimatedValue": {
                    "amount": 40000000.0,
                    "code": "NOK",
                    "fullLocalizedText": "4.0E7 NOK",
                }
            },
            "allCpvCodes": ["71240000", "71410000"],
            "competitionDocsUrl": "https://eu.eu-supply.com/app/rfq/rwlentrance_s.asp?PID=429110",
        },
        "https://api.doffin.no/webclient/api/v2/notices-api/notices/2026-107035": {
            "id": "2026-107035",
            "heading": "Konsulenttjenester for Naturtypekartlegging",
            "description": "Kartlegging av naturtyper i kommunen.",
            "deadline": "2026-05-04T10:00:58Z",
            "publicationDate": "2026-04-19",
            "buyer": [{"name": "Loppa Kommune"}],
            "allCpvCodes": ["73200000"],
            "competitionDocsUrl": "https://tendsign.com/doc.aspx?MeFormsNoticeId=89526",
        },
    }

    documents = collect_doffin_documents(
        source,
        limit=5,
        fetch_search_json=lambda _url, _body: search_response,
        fetch_detail_json=lambda url: detail_responses[url],
    )

    assert len(documents) == 1
    assert documents[0].source_url.endswith("/2026-106919")

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Rammeavtale planfagleg rådgjevingsteneste"
    assert payload["buyer"] == "Øygarden kommune"
    assert payload["noticeId"] == "2026-106919"
    assert payload["deadline"] == "2026-05-18"
    assert payload["cpv"] == ["71240000", "71410000"]
    assert payload["estimatedValueEur"] is None
    assert payload["estimatedValueText"] == "4.0E7 NOK"
    assert payload["officialUrl"] == "https://www.doffin.no/notices/2026-106919"


def test_collect_pcsp_documents_transforms_public_design_relevant_entries() -> None:
    source = _build_source(
        "pcsp_syndicated_notices",
        name="PCSP Syndicated Notices",
        jurisdiction="spain",
        base_url=(
            "https://contrataciondelsectorpublico.gob.es/sindicacion/"
            "sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom"
        ),
        scan_method="atom",
        extractor="generic_listing_html",
        collector="pcsp_atom_feed",
        regions=["europe", "spain"],
        languages=["es", "ca", "gl", "eu"],
    )

    feed_xml = """
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/19522224</id>
    <title>Servicio de redaccion del proyecto basico y de ejecucion para la biblioteca municipal</title>
    <updated>2026-04-19T19:56:42.911+02:00</updated>
    <link href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=design123"/>
    <summary>Id licitacion: BIB-2026-001; Organo de Contratacion: Ayuntamiento de Demo; Importe: 2235848.83 EUR; Estado: PUB</summary>
  </entry>
  <entry>
    <id>https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/19529999</id>
    <title>Servicio de limpieza viaria</title>
    <updated>2026-04-19T19:15:23.752+02:00</updated>
    <link href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=clean999"/>
    <summary>Id licitacion: CLEAN-2026-001; Organo de Contratacion: Ayuntamiento de Demo; Importe: 856430.39 EUR; Estado: PUB</summary>
  </entry>
  <entry>
    <id>https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/19522224-duplicate</id>
    <title>Servicio de redaccion del proyecto basico y de ejecucion para la biblioteca municipal</title>
    <updated>2026-04-19T19:56:42.911+02:00</updated>
    <link href="https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&amp;idEvl=design123"/>
    <summary>Id licitacion: BIB-2026-001; Organo de Contratacion: Ayuntamiento de Demo; Importe: 2235848.83 EUR; Estado: PUB</summary>
  </entry>
</feed>
""".strip()
    relevant_detail_html = """
<html>
  <body>
    <span id="viewns:test:label_OC">Contracting Party</span><span id="viewns:test:text_OC">Ayuntamiento de Demo</span>
    <span id="viewns:test:label_Expediente">File</span><span id="viewns:test:text_Expediente">BIB-2026-001</span>
    <span id="viewns:test:label_ObjetoContrato">Subject of the contract</span><span id="viewns:test:text_ObjetoContrato">Servicio de redacción del proyecto básico y de ejecución para la biblioteca municipal</span>
    <span id="viewns:test:label_Estado">State of the Tender</span><span id="viewns:test:text_Estado">Publicada</span>
    <span id="viewns:test:label_ValorContrato">Estimated value of the contract</span><span id="viewns:test:text_ValorContrato">2235848.83</span>
    <span id="viewns:test:label_TipoContrato">Type of Contract</span><span id="viewns:test:text_TipoContrato">Servicios</span>
    <span id="viewns:test:label_CPV">CPV code</span><span id="viewns:test:text_CPV">71221000-3 Architectural services for buildings.</span>
    <span id="viewns:test:label_Procedimiento">Procurement procedure</span><span id="viewns:test:text_Procedimiento">Abierto</span>
    <span id="viewns:test:label_PresentacionOferta">Method of presenting the offer</span><span id="viewns:test:text_PresentacionOferta">Electrónica</span>
    <span id="viewns:test:label_FechaPresentacionOferta">End date for the submission of offers</span><span id="viewns:test:text_FechaPresentacionOfertaConHora">11/06/2026 23:59</span>
  </body>
</html>
""".strip()
    irrelevant_detail_html = """
<html>
  <body>
    <span id="viewns:test:label_OC">Contracting Party</span><span id="viewns:test:text_OC">Ayuntamiento de Demo</span>
    <span id="viewns:test:label_Expediente">File</span><span id="viewns:test:text_Expediente">CLEAN-2026-001</span>
    <span id="viewns:test:label_ObjetoContrato">Subject of the contract</span><span id="viewns:test:text_ObjetoContrato">Servicio de limpieza viaria</span>
    <span id="viewns:test:label_CPV">CPV code</span><span id="viewns:test:text_CPV">90910000-9 Cleaning services.</span>
    <span id="viewns:test:label_Procedimiento">Procurement procedure</span><span id="viewns:test:text_Procedimiento">Abierto</span>
    <span id="viewns:test:label_FechaPresentacionOferta">End date for the submission of offers</span><span id="viewns:test:text_FechaPresentacionOfertaConHora">11/06/2026 23:59</span>
  </body>
</html>
""".strip()

    documents = collect_pcsp_documents(
        source,
        limit=5,
        fetch_text=lambda url: {
            source.base_url: feed_xml,
            "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=design123": relevant_detail_html,
            "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl=clean999": irrelevant_detail_html,
        }[url],
    )

    assert len(documents) == 1
    assert documents[0].source_url.endswith("design123")

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Servicio de redacción del proyecto básico y de ejecución para la biblioteca municipal"
    assert payload["buyer"] == "Ayuntamiento de Demo"
    assert payload["noticeId"] == "BIB-2026-001"
    assert payload["deadline"] == "2026-06-11"
    assert payload["cpv"] == ["71221000"]
    assert payload["officialUrl"].endswith("design123")
    assert payload["procedureType"] == "Abierto"


def test_collect_ted_documents_transforms_search_results_into_parser_payloads() -> None:
    source = _build_source(
        "ted_design_notices",
        name="TED Design and Procurement Notices",
        jurisdiction="eu",
        base_url="https://ted.europa.eu/",
        scan_method="api",
        extractor="ted_notice_parser",
    )
    response = {
        "notices": [
            {
                "notice-identifier": "671cfb3c-1ca2-4d4b-835e-015ca35ad0c4",
                "procedure-type": "open",
                "classification-cpv": ["71247000"],
                "estimated-value-lot": ["223000"],
                "publication-date": "2026-04-17+02:00",
                "organisation-name-buyer": {"eng": ["Comune Demo Nord"]},
                "notice-title": {"eng": "Civic Library Upgrade Design Services"},
                "links": {
                    "htmlDirect": {
                        "ENG": "https://ted.europa.eu/en/notice/261998-2026/html",
                    }
                },
            }
        ]
    }

    documents = collect_ted_documents(
        source,
        limit=1,
        publication_date_from="2026-01-01",
        fetch_json=lambda _url, body: response if "20260101" in body["query"] else None,
    )

    assert len(documents) == 1
    assert documents[0].source_url == "https://ted.europa.eu/en/notice/261998-2026/html"

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Civic Library Upgrade Design Services"
    assert payload["buyer"] == "Comune Demo Nord"
    assert payload["noticeId"] == "671cfb3c-1ca2-4d4b-835e-015ca35ad0c4"
    assert payload["cpv"] == ["71247000"]
    assert payload["estimatedValueEur"] == "223000"


def test_collect_boamp_documents_transforms_records_into_parser_payloads() -> None:
    from arch_competition_ops.collectors.boamp import collect_boamp_documents

    source = _build_source(
        "boamp_design_notices",
        name="BOAMP Design and Public Procurement Notices",
        jurisdiction="france",
        base_url="https://www.boamp.fr/",
        scan_method="api",
        extractor="boamp_notice_parser",
        languages=["fr"],
    )
    response = {
        "results": [
            {
                "idweb": "26-38966",
                "id": "26_38966",
                "objet": (
                    "MISSION D'ASSISTANCE A MAITRISE D'OUVRAGE RELATIVE A LA "
                    "RESTRUCTURATION LOURDE D'UN COLLEGE"
                ),
                "dateparution": "2026-04-18",
                "datelimitereponse": "2026-05-18T09:30:00+00:00",
                "nomacheteur": "Département de la Sarthe",
                "procedure_libelle": "Procédure Ouverte",
                "nature_libelle": "Avis de marché",
                "type_marche": ["SERVICES"],
                "descripteur_libelle": ["Assistance à maîtrise d'ouvrage", "Etude"],
                "donnees": json.dumps(
                    {
                        "cpv": ["71241000"],
                        "EFORMS": {
                            "ContractNotice": {
                                "cac:ProcurementProject": {
                                    "cac:RequestedTenderTotal": {
                                        "ext:UBLExtensions": {
                                            "ext:UBLExtension": {
                                                "ext:ExtensionContent": {
                                                    "efext:EformsExtension": {
                                                        "efbc:FrameworkMaximumAmount": {
                                                            "@currencyID": "EUR",
                                                            "#text": "380000",
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                    },
                    ensure_ascii=False,
                ),
            }
        ]
    }

    documents = collect_boamp_documents(
        source,
        limit=1,
        fetch_json=lambda _url: response,
    )

    assert len(documents) == 1
    assert documents[0].source_url == "https://www.boamp.fr/"

    payload = json.loads(documents[0].payload)
    assert payload["title"].startswith("MISSION D'ASSISTANCE A MAITRISE D'OUVRAGE")
    assert payload["buyer"] == "Département de la Sarthe"
    assert payload["officialNoticeId"] == "26_38966"
    assert payload["deadline"] == "2026-05-18"
    assert payload["cpv"] == ["71241000"]
    assert payload["estimatedValueEur"] == 380000
    assert payload["estimatedValueText"] == "EUR 380,000"


def test_collect_boamp_documents_caps_live_query_limit_to_100() -> None:
    from arch_competition_ops.collectors.boamp import collect_boamp_documents

    source = _build_source(
        "boamp_design_notices",
        name="BOAMP Design and Public Procurement Notices",
        jurisdiction="france",
        base_url="https://www.boamp.fr/",
        scan_method="api",
        extractor="boamp_notice_parser",
        languages=["fr"],
    )
    captured: dict[str, str] = {}

    def fake_fetch_json(url: str) -> dict:
        captured["url"] = url
        return {"results": []}

    documents = collect_boamp_documents(
        source,
        limit=20,
        fetch_json=fake_fetch_json,
    )

    assert documents == []
    assert "limit=100" in captured["url"]


def test_collect_simap_documents_transforms_public_search_results() -> None:
    from arch_competition_ops.collectors.simap import collect_simap_documents

    source = _build_source(
        "simap_public_design_notices",
        name="simap Swiss Public Procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        languages=["de", "fr", "it"],
    )

    def fake_fetch_json(url: str) -> dict:
        if "project-search" in url:
            return {
                "projects": [
                    {
                        "id": "687b9eda-d729-4da8-a4f2-d9b7439d86f4",
                        "publicationId": "92abd495-bda7-474e-94f6-3279ba2ad4bc",
                        "projectNumber": "32422",
                        "projectType": "competition",
                        "projectSubType": "project_competition",
                        "processType": "open",
                        "publicationDate": "2026-03-02",
                        "publicationNumber": "32422-01",
                        "pubType": "competition",
                        "title": {"en": "Museum extension / Project competition"},
                        "procOfficeName": {"en": "Ville de Lausanne"},
                        "orderAddress": {"countryId": "CH", "cantonId": "VD"},
                    }
                ],
                "pagination": {"lastItem": None},
            }
        if "project-header" in url:
            return {
                "latestPublication": {
                    "publicationNumber": "32422-01",
                    "id": "publication-32422-01",
                    "dates": {"offerDeadline": "2026-05-22T16:00:00+02:00"},
                    "title": {"en": "Museum extension / Project competition"},
                }
            }
        if "publication-details" in url:
            return {
                "project-info": {
                    "title": {"en": "Museum extension / Project competition"},
                    "procOfficeAddress": {
                        "name": {"en": "Ville de Lausanne"},
                        "email": "competition@lausanne.ch",
                    },
                    "documentsSourceUrl": "https://procurement.lausanne.ch/competitions/museum-extension",
                },
                "procurement": {
                    "orderDescription": {
                        "en": "Open project competition for the museum extension and public realm upgrade."
                    }
                },
                "dates": {"offerDeadline": "2026-05-22T16:00:00+02:00"},
                "base": {
                    "publicationNumber": "32422-01",
                    "processType": "open",
                    "projectSubType": "project_competition",
                },
                "terms": {
                    "compensation": {"currency": "CHF", "price": 120000},
                    "compensationNote": {"en": "Honorarium and prize pool: CHF 120000."},
                },
            }
        raise AssertionError(f"unexpected url {url}")

    documents = collect_simap_documents(
        source,
        limit=1,
        fetch_json=fake_fetch_json,
    )

    assert len(documents) == 1
    assert "publication-details" in documents[0].source_url

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Museum extension / Project competition"
    assert payload["buyer"] == "Ville de Lausanne"
    assert payload["officialNoticeId"] == "32422-01"
    assert payload["deadline"] == "2026-05-22"
    assert payload["projectSubType"] == "project_competition"
    assert payload["officialUrl"] == "https://procurement.lausanne.ch/competitions/museum-extension"
    assert payload["documentsPortalUrl"] == "https://procurement.lausanne.ch/competitions/museum-extension"
    assert payload["description"] == "Open project competition for the museum extension and public realm upgrade."
    assert payload["prizeSummary"] == "Honorarium and prize pool: CHF 120000."
    assert payload["authorityEmail"] == "competition@lausanne.ch"


def test_collect_simap_documents_skips_projects_without_latest_publication_detail() -> None:
    from arch_competition_ops.collectors.simap import collect_simap_documents

    source = _build_source(
        "simap_public_design_notices",
        name="simap Swiss Public Procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        languages=["de", "fr", "it"],
    )

    def fake_fetch_json(url: str) -> dict:
        if "project-search" in url:
            return {
                "projects": [
                    {
                        "id": "missing-publication",
                        "publicationDate": "2026-04-20",
                        "pubType": "competition",
                        "title": {"en": "School Campus Competition"},
                        "procOfficeName": {"en": "Ville de Demo"},
                    }
                ],
                "pagination": {"lastItem": None},
            }
        if "project-header" in url:
            return {"latestPublication": None}
        raise AssertionError(f"unexpected url {url}")

    documents = collect_simap_documents(
        source,
        limit=5,
        fetch_json=fake_fetch_json,
    )

    assert documents == []


def test_collect_simap_documents_extracts_budget_text_from_order_description() -> None:
    from arch_competition_ops.collectors.simap import collect_simap_documents

    source = _build_source(
        "simap_public_design_notices",
        name="simap Swiss Public Procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        languages=["de", "fr", "it"],
    )

    def fake_fetch_json(url: str) -> dict:
        if "project-search" in url:
            return {
                "projects": [
                    {
                        "id": "maur-project",
                        "publicationId": "maur-publication",
                        "publicationDate": "2026-04-20",
                        "pubType": "competition",
                        "title": {"fr": "Extension du complexe sportif et de loisirs Looren, 8124 Maur"},
                        "procOfficeName": {"fr": "Gemeindeverwaltung Maur"},
                    }
                ],
                "pagination": {"lastItem": None},
            }
        if "project-header" in url:
            return {
                "latestPublication": {
                    "publicationNumber": "34499-01",
                    "id": "maur-publication",
                    "dates": {"offerDeadline": "2026-05-05T16:00:00+02:00"},
                    "title": {"fr": "Extension du complexe sportif et de loisirs Looren, 8124 Maur"},
                }
            }
        if "publication-details" in url:
            return {
                "project-info": {
                    "title": {"fr": "Extension du complexe sportif et de loisirs Looren, 8124 Maur"},
                    "procOfficeAddress": {"name": {"fr": "Gemeindeverwaltung Maur"}},
                },
                "procurement": {
                    "orderDescription": {
                        "fr": (
                            "<p>L'objectif budgétaire de 16 millions de francs suisses pour la "
                            "réalisation de l'ensemble du projet de construction doit être impérativement respecté.</p>"
                        )
                    }
                },
                "dates": {"offerDeadline": "2026-05-05T16:00:00+02:00"},
                "base": {
                    "publicationNumber": "34499-01",
                    "processType": "selective",
                    "projectSubType": "project_competition",
                },
                "terms": {
                    "totalPriceNote": {
                        "fr": (
                            "Le montant total mis à disposition du jury est de CHF 130'000 hors TVA."
                        )
                    }
                },
            }
        raise AssertionError(f"unexpected url {url}")

    documents = collect_simap_documents(
        source,
        limit=5,
        fetch_json=fake_fetch_json,
    )

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["estimatedValueText"] == (
        "L'objectif budgétaire de 16 millions de francs suisses pour la réalisation de "
        "l'ensemble du projet de construction doit être impérativement respecté."
    )
    assert payload["prizeSummary"] == "Le montant total mis à disposition du jury est de CHF 130'000 hors TVA."


def test_collect_scp_documents_streams_official_csv_rows() -> None:
    from arch_competition_ops.collectors.scp import collect_scp_documents

    source = _build_source(
        "serviziocontrattipubblici_hub",
        name="Servizio Contratti Pubblici",
        jurisdiction="italy",
        base_url="https://www.serviziocontrattipubblici.it/",
        scan_method="html",
        extractor="procurement_hub_parser",
        languages=["it", "en"],
    )
    csv_payload = """
dt_upd,id_avviso,rup,codice_fiscale_stazione_appaltante,denominazione_stazione_appaltante,provincia_stazione_appaltante,codice_istat_stazione_appaltante,ufficio,cig,cup,tipo_avviso,data_avviso,data_pubblicazione_scp,descrizione_avviso,scadenza_avviso,url_avviso
29/05/2025,700204,Rossi Mario,97231970589,Comune di Torino,TO,001272,LLPP,AA11BB22,,Avviso,2026-04-10 01:00:00,2026-04-10 09:47:31.565,"Servizi di progettazione architettonica e direzione lavori per scuola civica",2026-05-15 01:00:00,https://www.serviziocontrattipubblici.it/notice/700204
29/05/2025,700205,Rossi Mario,97231970589,Comune di Torino,TO,001272,LLPP,AA11BB23,,Avviso,2026-04-10 01:00:00,2026-04-10 09:47:31.565,"Fornitura di cancelleria per uffici",2026-05-15 01:00:00,https://www.serviziocontrattipubblici.it/notice/700205
""".strip()

    documents = collect_scp_documents(
        source,
        limit=1,
        fetch_text=lambda _url: csv_payload,
    )

    assert len(documents) == 1
    assert documents[0].source_url == "https://www.serviziocontrattipubblici.it/notice/700204"

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Servizi di progettazione architettonica e direzione lavori per scuola civica"
    assert payload["buyer"] == "Comune di Torino"
    assert payload["officialNoticeId"] == "700204"
    assert payload["deadline"] == "2026-05-15"


def test_collect_scp_documents_can_focus_on_curated_italian_authorities() -> None:
    from arch_competition_ops.collectors.scp import collect_scp_documents

    source = _build_source(
        "serviziocontrattipubblici_hub",
        name="Servizio Contratti Pubblici",
        jurisdiction="italy",
        base_url="https://www.serviziocontrattipubblici.it/",
        scan_method="html",
        extractor="procurement_hub_parser",
        languages=["it", "en"],
    )
    source.buyer_allowlist = ["comune di milano", "roma capitale"]
    csv_payload = """
dt_upd,id_avviso,rup,codice_fiscale_stazione_appaltante,denominazione_stazione_appaltante,provincia_stazione_appaltante,codice_istat_stazione_appaltante,ufficio,cig,cup,tipo_avviso,data_avviso,data_pubblicazione_scp,descrizione_avviso,scadenza_avviso,url_avviso
29/05/2025,700204,Rossi Mario,97231970589,Comune di Torino,TO,001272,LLPP,AA11BB22,,Avviso,2026-04-10 01:00:00,2026-04-10 09:47:31.565,"Servizi di progettazione architettonica e direzione lavori per scuola civica",2026-05-15 01:00:00,https://www.serviziocontrattipubblici.it/notice/700204
29/05/2025,700206,Rossi Mario,97231970589,Comune di Milano,MI,015146,LLPP,AA11BB24,,Avviso,2026-04-10 01:00:00,2026-04-10 09:47:31.565,"Servizi di progettazione per biblioteca di quartiere",2026-05-21 01:00:00,https://www.serviziocontrattipubblici.it/notice/700206
29/05/2025,700207,Rossi Mario,97231970589,Roma Capitale,RM,058091,LLPP,AA11BB25,,Avviso,2026-04-10 01:00:00,2026-04-10 09:47:31.565,"Servizi di architettura e ingegneria per mercato coperto",2026-05-23 01:00:00,https://www.serviziocontrattipubblici.it/notice/700207
""".strip()

    documents = collect_scp_documents(
        source,
        limit=5,
        fetch_text=lambda _url: csv_payload,
    )

    assert len(documents) == 2
    payloads = [json.loads(document.payload) for document in documents]
    assert [payload["buyer"] for payload in payloads] == ["Comune di Milano", "Roma Capitale"]
    assert [payload["officialNoticeId"] for payload in payloads] == ["700206", "700207"]


def test_collect_anac_documents_transforms_public_api_items() -> None:
    from arch_competition_ops.collectors.anac import collect_anac_documents

    source = _build_source(
        "anac_bdncp_contracts",
        name="ANAC BDNCP",
        jurisdiction="italy",
        base_url="https://pubblicitalegale.anticorruzione.it/",
        scan_method="html",
        extractor="bdncp_notice_parser",
        languages=["it"],
    )
    response = {
        "content": [
            {
                "idAvviso": "fb7c96cb-1af5-4008-a0c4-2d4197479540",
                "codiceScheda": "P1",
                "dataScadenza": "2026-05-22T10:00:00+00:00",
                "dataPubblicazione": "2026-04-17T06:00:00.707+00:00",
                "template": [
                    {
                        "template": {
                            "metadata": {
                                "titolo": "Servizi di progettazione per nuovo polo civico",
                                "descrizione": "Affidamento servizi di architettura e ingegneria",
                            },
                            "sections": [
                                {
                                    "name": "SEZ. A - Committente",
                                    "fields": {
                                        "soggetti_sa": [
                                            {
                                                "denominazione_amministrazione": "Comune di Ravenna",
                                            }
                                        ]
                                    },
                                },
                                {
                                    "name": "SEZ. B - Dati Generali",
                                    "fields": {
                                        "documenti_di_gara_link": "https://example.it/gara/123",
                                    },
                                },
                                {
                                    "name": "SEZ. C - Oggetto",
                                    "items": [
                                        {
                                            "descrizione": "Servizi di progettazione per nuovo polo civico",
                                            "natura_principale": "Servizi",
                                            "valore_affidamento": 560000,
                                            "cig": "BB4B32B78B",
                                        }
                                    ],
                                },
                            ],
                        }
                    }
                ],
            }
        ]
    }

    documents = collect_anac_documents(
        source,
        limit=1,
        fetch_json=lambda _url: response,
    )

    assert len(documents) == 1
    assert documents[0].source_url == "https://example.it/gara/123"

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Servizi di progettazione per nuovo polo civico"
    assert payload["buyer"] == "Comune di Ravenna"
    assert payload["officialNoticeId"] == "fb7c96cb-1af5-4008-a0c4-2d4197479540"
    assert payload["estimatedValueEur"] == 560000
    assert payload["deadline"] == "2026-05-22"


def test_collect_competitions_archi_documents_uses_feed_entries_as_secondary_discovery() -> None:
    from arch_competition_ops.collectors.competitions_archi import collect_competitions_archi_documents

    source = _build_source(
        "competitions_archi",
        name="Competitions.archi",
        jurisdiction="global",
        base_url="https://competitions.archi/",
        scan_method="html",
        extractor="generic_listing_html",
        source_tier="secondary",
    )
    feed = """
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <item>
      <title>Open call for civic waterfront professional competition</title>
      <link>https://competitions.archi/competition/open-call-civic-waterfront</link>
      <pubDate>Thu, 16 Apr 2026 13:06:21 +0000</pubDate>
      <category>All competitions</category>
      <category>For professionals</category>
      <description><![CDATA[Applications close on 6 May 2026. Built project commission expected after jury phase.]]></description>
    </item>
    <item>
      <title>Student summer workshop</title>
      <link>https://competitions.archi/competition/student-summer-workshop</link>
      <pubDate>Thu, 16 Apr 2026 13:06:21 +0000</pubDate>
      <category>For students</category>
      <description><![CDATA[Summer workshop for students.]]></description>
    </item>
  </channel>
</rss>
""".strip()

    documents = collect_competitions_archi_documents(
        source,
        limit=1,
        fetch_text=lambda _url: feed,
    )

    assert len(documents) == 1
    assert documents[0].source_url == "https://competitions.archi/competition/open-call-civic-waterfront"

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Open call for civic waterfront professional competition"
    assert payload["publishedAt"] == "2026-04-16"
    assert "For professionals" in payload["categories"]


def test_collect_municipal_buyer_profile_documents_requires_explicit_urls() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
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


def test_collect_municipal_buyer_profile_documents_expands_berlin_rss_into_detail_backed_payloads() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
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
    assert first_payload["title"] == "Leistungen der Objekt- und Fachplanung sowie besondere Leistungen"
    assert first_payload["procedureType"] == "Verhandlungsverfahren mit Teilnahmewettbewerb"
    assert first_payload["deadline"] == "2026-05-18"
    assert first_payload["officialNoticeId"] == "203860"
    assert first_payload["publishedAt"] == "2026-04-17"
    assert "Contracting Authority" in first_payload["detailHtml"]


def test_collect_municipal_buyer_profile_documents_expands_frankfurt_nettender_listing() -> None:
    from arch_competition_ops.collectors.municipal import collect_municipal_buyer_profile_documents

    source = _build_source(
        "municipal_buyer_profiles",
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
    listing = f"""
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
    assert payload["title"] == "Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9"
    assert payload["authority"] == "GMH | Gebäudemanagement Hamburg"
    assert payload["deadline"] == "2026-04-20"
    assert payload["sourceListingUrl"] == source.base_url
    assert "Ausschreibungsnummer" in payload["detailHtml"]


def test_ingest_source_command_fetches_and_upserts_records(tmp_path, monkeypatch) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text(
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

    def fake_collect(*_args, **_kwargs) -> list[CollectedSourceDocument]:
        payload = json.dumps(
            {
                "noticeId": "DEMO-TED-INGEST-001",
                "title": "Municipal Waterfront Design Competition",
                "buyer": "Comune Demo Nord",
                "procedureType": "design_contest",
                "deadline": "2026-06-30",
                "estimatedValueEur": "1850000",
                "eligibility": "Lead consultant must hold architect registration.",
                "implementationPath": "winner_or_winners_progress_to_negotiated_service_award",
                "cpv": ["71230000"],
            }
        )
        return [
            CollectedSourceDocument(
                source_url="https://ted.europa.eu/en/notice/261998-2026/html",
                payload=payload,
            )
        ]

    monkeypatch.setattr(
        "arch_competition_ops.operations.collect_source_documents",
        fake_collect,
    )

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"])

    assert exit_code == 0
    settings = Settings(root=tmp_path)
    rows = list_competitions(settings.resolve_path(settings.db), limit=5)
    assert len(rows) == 1
    assert rows[0]["title"] == "Municipal Waterfront Design Competition"


def test_ingest_source_records_source_health_with_parse_failures_and_duplicate_pressure(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text(
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

    documents = [
        CollectedSourceDocument(
            source_url="https://ted.europa.eu/en/notice/1/html",
            payload=json.dumps({"case": "first"}),
        ),
        CollectedSourceDocument(
            source_url="https://ted.europa.eu/en/notice/2/html",
            payload=json.dumps({"case": "duplicate"}),
        ),
        CollectedSourceDocument(
            source_url="https://ted.europa.eu/en/notice/3/html",
            payload=json.dumps({"case": "bad"}),
        ),
    ]

    def fake_collect(*_args, **_kwargs) -> list[CollectedSourceDocument]:
        return documents

    def fake_parse(_source, payload: str, *, source_url: str) -> CompetitionRecord:
        case = json.loads(payload)["case"]
        if case == "bad":
            raise ValueError("parser exploded on bad payload")
        return CompetitionRecord(
            title="Municipal Waterfront Design Competition",
            organizer="Comune Demo Nord",
            source_url=source_url,
            official_url="https://ted.europa.eu/en/official/demo",
            status="discovered",
            opportunity_type="public_design_contest",
            deadline_at=date(2026, 6, 30),
            extraction_confidence=0.91,
            evidence_level="official_notice",
        )

    monkeypatch.setattr(
        "arch_competition_ops.operations.collect_source_documents",
        fake_collect,
    )
    monkeypatch.setattr(
        "arch_competition_ops.operations.parse_source_payload",
        fake_parse,
    )
    monkeypatch.setattr(
        "arch_competition_ops.operations.verify_record",
        lambda **kwargs: kwargs["record"],
    )

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "3"])

    assert exit_code == 1

    settings = Settings(root=tmp_path)
    rows = list_competitions(settings.resolve_path(settings.db), limit=5)
    assert len(rows) == 1

    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.row_factory = sqlite3.Row
        run_row = connection.execute(
            """
            SELECT source_id, status, document_count, upserted_count, parse_failure_count,
                   duplicate_group_count, max_duplicate_group_size, last_error
            FROM source_runs
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
        health_row = connection.execute(
            """
            SELECT source_id, last_status, last_document_count, last_upserted_count,
                   last_parse_failure_count, duplicate_group_count, max_duplicate_group_size,
                   last_success_at, last_error
            FROM source_health
            WHERE source_id = 'ted_design_notices'
            """
        ).fetchone()

    assert run_row["source_id"] == "ted_design_notices"
    assert run_row["status"] == "completed_with_failures"
    assert run_row["document_count"] == 3
    assert run_row["upserted_count"] == 2
    assert run_row["parse_failure_count"] == 1
    assert run_row["duplicate_group_count"] == 1
    assert run_row["max_duplicate_group_size"] == 2
    assert "parser exploded" in run_row["last_error"]

    assert health_row["source_id"] == "ted_design_notices"
    assert health_row["last_status"] == "completed_with_failures"
    assert health_row["last_document_count"] == 3
    assert health_row["last_upserted_count"] == 2
    assert health_row["last_parse_failure_count"] == 1
    assert health_row["duplicate_group_count"] == 1
    assert health_row["max_duplicate_group_size"] == 2
    assert health_row["last_success_at"] is not None
    assert "parser exploded" in health_row["last_error"]


def test_ingest_source_reports_duplicate_pressure_against_existing_canonical_rows(
    tmp_path,
    monkeypatch,
) -> None:
    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text(
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

    settings = Settings(root=tmp_path)
    db_path = settings.resolve_path(settings.db)
    duplicate_title = "Municipal Waterfront Design Competition"
    duplicate_organizer = "Comune Demo Nord"
    duplicate_deadline = date(2026, 6, 30)
    for competition_id in ("existing-a", "existing-b"):
        upsert_competition(
            db_path,
            CompetitionRecord(
                competition_id=competition_id,
                title=duplicate_title,
                organizer=duplicate_organizer,
                source_url=f"https://ted.europa.eu/en/notice/{competition_id}/html",
                official_url="https://ted.europa.eu/en/official/demo",
                status="verified",
                opportunity_type="public_design_contest",
                deadline_at=duplicate_deadline,
                extraction_confidence=0.91,
                evidence_level="official_notice",
            ),
        )

    documents = [
        CollectedSourceDocument(
            source_url="https://ted.europa.eu/en/notice/live/html",
            payload=json.dumps({"case": "live"}),
        )
    ]

    def fake_collect(*_args, **_kwargs) -> list[CollectedSourceDocument]:
        return documents

    def fake_parse(_source, payload: str, *, source_url: str) -> CompetitionRecord:
        assert json.loads(payload)["case"] == "live"
        return CompetitionRecord(
            title=duplicate_title,
            organizer=duplicate_organizer,
            source_url=source_url,
            official_url="https://ted.europa.eu/en/official/demo",
            status="discovered",
            opportunity_type="public_design_contest",
            deadline_at=duplicate_deadline,
            extraction_confidence=0.91,
            evidence_level="official_notice",
        )

    monkeypatch.setattr(
        "arch_competition_ops.operations.collect_source_documents",
        fake_collect,
    )
    monkeypatch.setattr(
        "arch_competition_ops.operations.parse_source_payload",
        fake_parse,
    )
    monkeypatch.setattr(
        "arch_competition_ops.operations.verify_record",
        lambda **kwargs: kwargs["record"],
    )

    exit_code = main(["ingest-source", "--source-id", "ted_design_notices", "--limit", "1"])

    assert exit_code == 0

    with sqlite3.connect(db_path) as connection:
        connection.row_factory = sqlite3.Row
        run_row = connection.execute(
            """
            SELECT status, document_count, upserted_count, parse_failure_count,
                   duplicate_group_count, max_duplicate_group_size
            FROM source_runs
            ORDER BY id DESC
            LIMIT 1
            """
        ).fetchone()
        health_row = connection.execute(
            """
            SELECT last_status, last_document_count, last_upserted_count,
                   last_parse_failure_count, duplicate_group_count, max_duplicate_group_size
            FROM source_health
            WHERE source_id = 'ted_design_notices'
            """
        ).fetchone()
        duplicate_row = connection.execute(
            """
            SELECT COUNT(*) AS duplicate_count
            FROM competitions
            WHERE title = ? AND organizer = ?
            """,
            (duplicate_title, duplicate_organizer),
        ).fetchone()

    assert duplicate_row["duplicate_count"] == 3
    assert run_row["status"] == "success"
    assert run_row["document_count"] == 1
    assert run_row["upserted_count"] == 1
    assert run_row["parse_failure_count"] == 0
    assert run_row["duplicate_group_count"] == 1
    assert run_row["max_duplicate_group_size"] == 3
    assert health_row["last_status"] == "success"
    assert health_row["last_document_count"] == 1
    assert health_row["last_upserted_count"] == 1
    assert health_row["last_parse_failure_count"] == 0
    assert health_row["duplicate_group_count"] == 1
    assert health_row["max_duplicate_group_size"] == 3


def test_ingest_source_applies_official_secondary_verifier_before_upsert(tmp_path, monkeypatch) -> None:
    from arch_competition_ops.verifiers.simap import clear_verifier_caches

    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text(
        """
sources:
  - source_id: simap_public_design_notices
    name: simap Swiss Public Procurement
    kind: official_procurement
    jurisdiction: switzerland
    base_url: https://www.simap.ch/
    scan_method: api
    extractor: simap_notice_parser
    verifier: simap_official_enricher
    source_tier: primary
    enabled: true
    regions: [europe, switzerland]
    languages: [de, fr, it]
""".strip(),
        encoding="utf-8",
    )

    payload = json.dumps(
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
            "cpv": ["71200000"],
        },
        ensure_ascii=False,
    )

    def fake_collect(*_args, **_kwargs) -> list[CollectedSourceDocument]:
        return [
            CollectedSourceDocument(
                source_url=(
                    "https://www.simap.ch/api/publications/v1/project/"
                    "e66757fb-1910-4899-8fc3-7f4bfee043ff/publication-details/"
                    "3b93fb04-442f-4a7c-910e-5e52f8bd8987"
                ),
                payload=payload,
            )
        ]

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
        "arch_competition_ops.operations.collect_source_documents",
        fake_collect,
    )
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.simap._fetch_text",
        fake_fetch_text,
    )

    exit_code = main(["ingest-source", "--source-id", "simap_public_design_notices", "--limit", "1"])

    assert exit_code == 0
    settings = Settings(root=tmp_path)
    rows = list_competitions(settings.resolve_path(settings.db), limit=5)
    assert len(rows) == 1

    import sqlite3

    conn = sqlite3.connect(settings.resolve_path(settings.db))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT official_url, source_url, prize_summary, documents_portal_url FROM competitions LIMIT 1"
    ).fetchone()
    assert row["official_url"] == official_page_url
    assert row["source_url"].endswith("publication-details/3b93fb04-442f-4a7c-910e-5e52f8bd8987")
    assert row["prize_summary"] == "Preisgeld CHF 167 000 exkl. MWST"
    assert row["documents_portal_url"] == "https://konkurado.ch/de/ws-herbstweg"


def test_ingest_source_applies_browser_fallback_before_upsert(tmp_path, monkeypatch) -> None:
    from arch_competition_ops.verifiers.simap import clear_verifier_caches

    monkeypatch.chdir(tmp_path)
    (tmp_path / "config").mkdir()
    (tmp_path / "data").mkdir()
    (tmp_path / "config" / "sources.yml").write_text(
        """
sources:
  - source_id: simap_public_design_notices
    name: simap Swiss Public Procurement
    kind: official_procurement
    jurisdiction: switzerland
    base_url: https://www.simap.ch/
    scan_method: api
    extractor: simap_notice_parser
    verifier: simap_official_enricher
    source_tier: primary
    enabled: true
    regions: [europe, switzerland]
    languages: [de, fr, it]
""".strip(),
        encoding="utf-8",
    )

    payload = json.dumps(
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
            "cpv": ["71200000"],
        },
        ensure_ascii=False,
    )

    def fake_collect(*_args, **_kwargs) -> list[CollectedSourceDocument]:
        return [
            CollectedSourceDocument(
                source_url=(
                    "https://www.simap.ch/api/publications/v1/project/"
                    "e66757fb-1910-4899-8fc3-7f4bfee043ff/publication-details/"
                    "3b93fb04-442f-4a7c-910e-5e52f8bd8987"
                ),
                payload=payload,
            )
        ]

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

    def fake_render_page(*, url: str, storage_dir, timeout_ms: int = 20000):
        assert url == official_page_url
        assert storage_dir.name == "crawlee"
        assert timeout_ms == 20000
        return SimpleNamespace(
            final_url=official_page_url,
            html=f"""
<html>
  <head><title>Erneuerung und Erweiterung Wohnsiedlung Herbstweg | Stadt Zürich</title></head>
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
        "arch_competition_ops.operations.collect_source_documents",
        fake_collect,
    )
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.simap._fetch_text",
        fake_fetch_text,
    )
    monkeypatch.setattr(
        "arch_competition_ops.verifiers.simap.render_page",
        fake_render_page,
    )

    exit_code = main(["ingest-source", "--source-id", "simap_public_design_notices", "--limit", "1"])

    assert exit_code == 0
    settings = Settings(root=tmp_path)

    import sqlite3

    conn = sqlite3.connect(settings.resolve_path(settings.db))
    conn.row_factory = sqlite3.Row
    row = conn.execute(
        "SELECT official_url, source_url, prize_summary, brief_pdf_url, documents_portal_url, evidence_note FROM competitions LIMIT 1"
    ).fetchone()
    assert row["official_url"] == official_page_url
    assert row["source_url"].endswith("publication-details/3b93fb04-442f-4a7c-910e-5e52f8bd8987")
    assert row["prize_summary"] == "Preisgeld CHF 167 000 exkl. MWST"
    assert row["brief_pdf_url"] == pdf_url
    assert row["documents_portal_url"] == "https://konkurado.ch/de/ws-herbstweg"
    assert "browser fallback" in row["evidence_note"].lower()
