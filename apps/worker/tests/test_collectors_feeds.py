from __future__ import annotations

import json

from support import build_source as _build_source

from arch_competition_ops.collectors.canadabuys import collect_canadabuys_documents
from arch_competition_ops.collectors.contracts_finder import collect_contracts_finder_documents
from arch_competition_ops.collectors.generic_rss import collect_generic_rss_documents


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


def test_collect_generic_rss_documents_excludes_preannouncement_notices() -> None:
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
      <title>14247 - Ashhurst Domain to Western Gateway Shared Use Path</title>
      <link>https://www.gets.govt.nz/NZTAHNO/ExternalTenderDetails.htm?id=34033788</link>
      <description><![CDATA[
        <table>
          <tr><td><b>RFx ID: </b></td><td>34033788</td></tr>
          <tr><td><b>Organisation: </b></td><td>New Zealand Transport Agency (Waka Kotahi) - HISTORIC</td></tr>
          <tr><td valign="top"><b>Categories: </b></td><td>81100000 - Professional engineering services<br>72100000 - Building and facility maintenance and repair services</td></tr>
          <tr><td valign="top"><b>Overview: </b></td><td>This Notice of Information (NOI) – Advance Notice is to provide early information ahead of a future Request for Tenders. This notice is provided as an early indication only and is NOT the commencement of a tender process.</td></tr>
        </table>
      ]]></description>
      <pubDate>Mon, 04 May 2026 18:00:00 GMT</pubDate>
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
                    "classification": {
                        "scheme": "CPV",
                        "id": "45223800",
                        "description": "Assembly and erection of prefabricated structures",
                    },
                    "tenderPeriod": {"endDate": "2026-05-14T12:00:00+01:00"},
                    "documents": [
                        {"url": "https://www.contractsfinder.service.gov.uk/Notice/example"}
                    ],
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


def test_collect_contracts_finder_documents_includes_estimated_value_text_from_ocds_release() -> (
    None
):
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
                    "classification": {
                        "scheme": "CPV",
                        "id": "71242000",
                        "description": "Project and design preparation",
                    },
                    "tenderPeriod": {"endDate": "2026-05-09T12:00:00+01:00"},
                    "documents": [
                        {
                            "url": "https://www.contractsfinder.service.gov.uk/Notice/f76102bd-3540-4b82-9256-cdc20e19bd42"
                        }
                    ],
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
