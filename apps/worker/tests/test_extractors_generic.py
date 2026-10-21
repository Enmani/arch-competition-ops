from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.extractors.common import parse_money_amount
from arch_competition_ops.models import SourceDefinition


def test_parse_generic_listing_payload() -> None:
    source = SourceDefinition(
        source_id="competitions_archi",
        collector="competitions_archi_feed",
        name="Competitions.archi",
        kind="aggregator",
        jurisdiction="global",
        base_url="https://competitions.archi/",
        scan_method="html",
        extractor="generic_listing_html",
        source_tier="secondary",
        enabled=True,
        regions=["global"],
        languages=["en"],
    )
    payload = """
    {
      "title": "Open call for civic waterfront professional competition",
      "summary": "Applications close on 6 May 2026. Built project commission expected after jury phase.",
      "categories": ["For professionals", "Open"],
      "publishedAt": "2026-04-16"
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://competitions.archi/competition/open-call-civic-waterfront",
    )

    assert record.title == "Open call for civic waterfront professional competition"
    assert record.evidence_level == "secondary"
    # An aggregator listing is not an official source: its link stays in source_url only.
    assert record.official_url is None
    assert record.source_url == "https://competitions.archi/competition/open-call-civic-waterfront"
    assert record.deadline_at is None
    assert record.opportunity_type == "unknown"
    assert record.procedure_type is None
    assert record.implementation_path is None


def test_parse_generic_listing_payload_honors_official_procurement_overrides() -> None:
    source = SourceDefinition(
        source_id="gets_open_tenders",
        collector="generic_rss_feed",
        name="GETS Open Tenders",
        kind="official_procurement",
        jurisdiction="new_zealand",
        base_url="https://www.gets.govt.nz/ExternalRSSFeed.htm",
        scan_method="rss",
        extractor="generic_listing_html",
        source_tier="primary",
        enabled=True,
        regions=["oceania", "new_zealand"],
        languages=["en"],
    )
    payload = """
    {
      "title": "Stormwater Upgrade Design Haybittle Street Feilding",
      "buyer": "Manawatu District Council",
      "noticeId": "33799335",
      "deadline": "2026-05-06",
      "summary": "Open request for proposals for built-environment design services.",
      "officialUrl": "https://www.gets.govt.nz/MDC/ExternalTenderDetails.htm?id=33799335",
      "opportunityType": "public_design_services_procurement",
      "procedureType": "request_for_proposals",
      "implementationPath": "service_contract_award_after_competitive_selection",
      "evidenceLevel": "official_listing",
      "evidenceNote": "Official GETS tender listing."
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://www.gets.govt.nz/MDC/ExternalTenderDetails.htm?id=33799335",
    )

    assert record.opportunity_type == "public_design_services_procurement"
    assert record.procedure_type == "public_design_services_tender"
    assert record.implementation_path == "service_contract_award_after_competitive_selection"
    assert record.evidence_level == "official_listing"
    assert record.evidence_note == "Official GETS tender listing."
    assert (
        record.official_url == "https://www.gets.govt.nz/MDC/ExternalTenderDetails.htm?id=33799335"
    )


def test_parse_generic_listing_payload_maps_announcement_of_competition_to_public_tender() -> None:
    source = SourceDefinition(
        source_id="doffin_notices",
        collector="doffin_search_api",
        name="Doffin Notices",
        kind="official_procurement",
        jurisdiction="norway",
        base_url="https://www.doffin.no/",
        scan_method="api",
        extractor="generic_listing_html",
        source_tier="primary",
        enabled=True,
        regions=["europe", "norway"],
        languages=["no", "en"],
    )
    payload = """
    {
      "title": "Konsulenttjenester plan- og byggesaker",
      "buyer": "Stranda kommune",
      "noticeId": "2026-DOFFIN-001",
      "deadline": "2026-05-18",
      "officialUrl": "https://www.doffin.no/notices/2026-DOFFIN-001",
      "opportunityType": "public_design_services_procurement",
      "procedureType": "ANNOUNCEMENT_OF_COMPETITION",
      "implementationPath": "service_contract_award_after_competitive_selection",
      "evidenceLevel": "official_notice"
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://www.doffin.no/notices/2026-DOFFIN-001",
    )

    assert record.opportunity_type == "public_design_services_procurement"
    assert record.procedure_type == "public_design_services_tender"


def test_parse_buyer_profile_html_payload() -> None:
    source = SourceDefinition(
        source_id="municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        kind="authority_portal",
        jurisdiction="mixed",
        base_url="https://example.gov.local/",
        scan_method="html",
        extractor="buyer_profile_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe"],
        languages=["it", "en"],
    )
    payload = """
    <html>
      <body>
        <h1>Servizi di progettazione per nuova biblioteca comunale</h1>
        <p>Stazione appaltante: Comune di Parma</p>
        <p>Scadenza: 2026-05-30</p>
        <p>Riferimento: PARMA-2026-001</p>
      </body>
    </html>
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://buyer.example.it/notices/parma-2026-001",
    )

    assert record.title == "Servizi di progettazione per nuova biblioteca comunale"
    assert record.authority_name == "Comune di Parma"
    assert record.official_notice_id == "PARMA-2026-001"
    assert record.deadline_at is not None
    assert record.procedure_type is None


def test_parse_buyer_profile_json_payload_with_berlin_detail_html() -> None:
    source = SourceDefinition(
        source_id="municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        kind="authority_portal",
        jurisdiction="germany",
        base_url="https://www.berlin.de/vergabeplattform/veroeffentlichungen/bekanntmachungen/feed.rss",
        scan_method="rss",
        extractor="buyer_profile_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "germany"],
        languages=["de", "en"],
    )
    payload = """
    {
      "title": "Berlin TXL - UTR - Projektsteuerung - Gebäude L",
      "summary": "Verfahrensart: Verhandlungsverfahren mit Teilnahmewettbewerb. Ablauf der Teilnahmefrist: 18.05.2026, 10:00 Uhr.",
      "procedureType": "Verhandlungsverfahren mit Teilnahmewettbewerb",
      "deadline": "2026-05-18",
      "publishedAt": "2026-04-17",
      "detailHtml": "<html><body><h4 class=\\"text-muted text-truncate mb-0\\" title=\\"006_027_03_0001_0001 Berlin TXL - UTR - Projektsteuerung - Geb\\u00e4ude L\\">006_027_03_0001_0001 Berlin TXL - UTR - Projektsteuerung - Geb\\u00e4ude L</h4><div><h6><strong>Brief Description</strong></h6>Gesucht wird ein Projektsteuerer f\\u00fcr die Sanierung der ehemaligen Flughafenfeuerwache / Geb\\u00e4ude L.</div><div><h6><strong>Contracting Authority</strong></h6>Tegel Projekt GmbH<br /></div><div><h6><strong>CPV Codes</strong></h6><span class=\\"badge bg-primary\\">71541000</span><span class=\\"badge bg-primary\\">71200000</span></div></body></html>"
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://meinauftrag.rib.de/public/DetailsByPlatformIdAndTenderId/platformId/2/tenderId/205148",
    )

    assert record.title == "Berlin TXL - UTR - Projektsteuerung - Gebäude L"
    assert record.authority_name == "Tegel Projekt GmbH"
    assert record.official_notice_id == "205148"
    assert record.deadline_at is not None
    assert record.deadline_at.isoformat() == "2026-05-18"
    assert record.cpv_codes == ["71541000", "71200000"]
    assert record.jurisdiction == "germany"
    assert record.evidence_level == "official_notice"
    assert record.procedure_type == "neg-w-call"


def test_parse_buyer_profile_json_payload_with_frankfurt_detail_html() -> None:
    source = SourceDefinition(
        source_id="municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        kind="authority_portal",
        jurisdiction="germany",
        base_url="https://www.vergabe.stadt-frankfurt.de/NetServer/PublicationSearchControllerServlet?function=SearchPublications",
        scan_method="html",
        extractor="buyer_profile_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "germany"],
        languages=["de", "en"],
    )
    payload = """
    {
      "title": "Ingenieurleistungen Freianlagen Schulcampus (66-2026-00024)",
      "authority": "Amt 66 - Amt für Straßenbau und Erschließung",
      "procedureType": "UVgO/VgV, Offenes Verfahren",
      "deadline": "2026-05-08",
      "publishedAt": "2026-04-16",
      "detailHtml": "<html><body><h2 class=\\"smallGrey\\">Ingenieurleistungen Freianlagen Schulcampus 66-2026-00024</h2><table><tr><td>Beschaffer</td><td>Offizielle Bezeichnung: Stadt Frankfurt am Main, Amt für Straßenbau und Erschließung<br></td></tr><tr><td>Beschreibung</td><td>Interne Kennung: 66-2026-00024<br>Titel: Ingenieurleistungen Freianlagen Schulcampus<br>Art des Auftrags: Dienstleistungen</td></tr><tr><td>Fristen</td><td>Frist für den Eingang der Angebote: 08.05.2026 12:00 Uhr</td></tr><tr><td>CPV</td><td>CPV-Code Hauptteil: 71322000-1</td></tr><tr><td>Beschreibung der Beschaffung</td><td>Beschreibung: Freianlagenplanung für die Erweiterung eines Schulcampus.</td></tr></table></body></html>"
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url=(
            "https://www.vergabe.stadt-frankfurt.de/NetServer/PublicationControllerServlet"
            "?function=Detail&TOID=54321-NetTender-frankfurt-001&Category=InvitationToTender"
        ),
    )

    assert record.title == "Ingenieurleistungen Freianlagen Schulcampus (66-2026-00024)"
    assert record.authority_name == "Stadt Frankfurt am Main, Amt für Straßenbau und Erschließung"
    assert record.official_notice_id == "66-2026-00024"
    assert record.deadline_at is not None
    assert record.deadline_at.isoformat() == "2026-05-08"
    assert record.cpv_codes == ["71322000"]
    assert record.evidence_level == "official_notice"
    assert record.procedure_type == "open"


def test_parse_buyer_profile_json_payload_with_hamburg_detail_html() -> None:
    source = SourceDefinition(
        source_id="municipal_buyer_profiles",
        collector="municipal_buyer_profiles",
        name="Municipal Buyer Profiles",
        kind="authority_portal",
        jurisdiction="germany",
        base_url="https://www.hamburg.de/politik-und-verwaltung/ausschreibungen/lieferungen-und-leistungen-vgv-uvgo-",
        scan_method="html",
        extractor="buyer_profile_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "germany"],
        languages=["de", "en"],
    )
    payload = """
    {
      "title": "Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9",
      "authority": "GMH | Gebäudemanagement Hamburg",
      "deadline": "2026-04-20",
      "publishedAt": "2026-04-16",
      "detailHtml": "<html><body><span class=\\"km1-topline\\">GMH | Gebäudemanagement Hamburg</span><h1 class=\\"km1-heading km1-article__heading\\">Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9</h1><div class=\\"km1-richtext\\"><p>Einreichungsfrist: <strong>20.04.2026, 14:00 Uhr</strong></p><p>Verfahrensinhalt: Umbaumaßnahmen für eine Stadtteilschule am Standort Julius-Ludowieg-Str. in Hamburg - Projektsteuerung und Projektleitung in Anlehnung an §§ 2+3 AHO Heft Nr. 9</p><p>Ausschreibungsnummer: <strong>GMH VgV VV 015-26 AO</strong></p><p>Die vollständigen Ausschreibungsunterlagen stehen auf unserem <a href=\\"https://fbhh-evergabe.web.hamburg.de/evergabe.bieter/eva/supplierportal/fhh/tabs/home\\" target=\\"_blank\\">Bieterportal</a> zur Verfügung.</p><p>Ausschreibende Stelle: GMH | Gebäudemanagement Hamburg</p></div></body></html>"
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url=(
            "https://www.hamburg.de/politik-und-verwaltung/ausschreibungen/lieferungen-und-leistungen-vgv-uvgo-/"
            "julius-ludowieg-strasse-projektsteuerung-in-anlehnung-an-2-3-aho-heft-nr-9-1156936"
        ),
    )

    assert (
        record.title
        == "Julius-Ludowieg Straße - Projektsteuerung in Anlehnung an §§ 2+3 AHO Heft Nr. 9"
    )
    assert record.authority_name == "GMH | Gebäudemanagement Hamburg"
    assert record.official_notice_id == "GMH VgV VV 015-26 AO"
    assert record.deadline_at is not None
    assert record.deadline_at.isoformat() == "2026-04-20"
    assert (
        record.official_url
        == "https://fbhh-evergabe.web.hamburg.de/evergabe.bieter/eva/supplierportal/fhh/tabs/home"
    )
    assert record.source_url.endswith("1156936")
    assert record.eligibility_summary is None  # project prose is not an eligibility clause
    assert "Stadtteilschule" in (record.description or "")


def test_parse_money_amount_supports_european_and_swiss_number_formats() -> None:
    assert parse_money_amount("9666430.87 EUR") == 9_666_430.87
    assert parse_money_amount("€ 74.322,34") == 74_322.34
    assert parse_money_amount("CHF 167 000") == 167_000
    assert parse_money_amount("Wettbewerbssumme total CHF 220'000") == 220_000


def test_parse_generic_listing_payload_preserves_estimated_value_text_without_forcing_eur() -> None:
    source = SourceDefinition(
        source_id="uk_contracts_finder_tenders",
        collector="contracts_finder_ocds",
        name="UK Contracts Finder Tenders",
        kind="official_procurement",
        jurisdiction="united_kingdom",
        base_url="https://www.contractsfinder.service.gov.uk/Published/Notices/OCDS/Search",
        scan_method="api",
        extractor="generic_listing_html",
        source_tier="primary",
        enabled=True,
        regions=["europe", "united_kingdom"],
        languages=["en"],
    )
    payload = """
    {
      "title": "Marden Parish Council Pavilion Refurbishment",
      "buyer": "Marden Parish Council",
      "noticeId": "ocds-b5fd17-f76102bd",
      "deadline": "2026-05-09",
      "summary": "Refurbishment and extension of a public pavilion building.",
      "officialUrl": "https://www.contractsfinder.service.gov.uk/Notice/f76102bd-3540-4b82-9256-cdc20e19bd42",
      "opportunityType": "public_design_services_procurement",
      "procedureType": "open",
      "implementationPath": "service_contract_award_after_competitive_selection",
      "estimatedValueText": "GBP 1,000,000"
    }
    """

    record = parse_source_payload(source, payload)

    assert record.estimated_contract_value_eur is None
    assert record.estimated_contract_value_text == "GBP 1,000,000"


def test_parse_generic_listing_payload_infers_chinese_interior_and_housing_signals() -> None:
    source = SourceDefinition(
        source_id="ggzy_public_notices",
        collector="ggzy_public_notices",
        name="National Public Resources Trading Platform",
        kind="official_procurement",
        jurisdiction="china",
        base_url="https://www.ggzy.gov.cn/deal/dealList.html",
        scan_method="api",
        extractor="generic_listing_html",
        source_tier="primary",
        enabled=True,
        regions=["asia", "china"],
        languages=["zh"],
    )
    payload = """
    {
      "title": "遂川县恒福庄园片区2026年老旧小区改造项目设计服务",
      "buyer": "遂川县住房和城乡建设局",
      "noticeId": "遂投采字2026SCX072号",
      "deadline": "2026-05-21",
      "summary": "项目概况：老旧小区改造项目设计服务，预算金额 330000.00 元。",
      "officialUrl": "https://example.cn/original/housing",
      "opportunityType": "public_design_services_procurement",
      "procedureType": "public_design_services_tender",
      "implementationPath": "service_contract_award_after_competitive_selection",
      "evidenceLevel": "official_notice"
    }
    """

    record = parse_source_payload(source, payload)

    assert "architecture" in record.competition_types
    assert "housing" in record.competition_types
    assert "adaptive_reuse" in record.competition_types


def test_parse_generic_listing_payload_infers_chinese_interior_signal() -> None:
    source = SourceDefinition(
        source_id="ggzy_public_notices",
        collector="ggzy_public_notices",
        name="National Public Resources Trading Platform",
        kind="official_procurement",
        jurisdiction="china",
        base_url="https://www.ggzy.gov.cn/deal/dealList.html",
        scan_method="api",
        extractor="generic_listing_html",
        source_tier="primary",
        enabled=True,
        regions=["asia", "china"],
        languages=["zh"],
    )
    payload = """
    {
      "title": "琶洲会展大厦项目酒店改造工程室内设计及服务",
      "buyer": "广州会展建设发展有限公司",
      "noticeId": "PZ-INTERIOR-2026-009",
      "deadline": "2026-06-03",
      "summary": "酒店改造工程室内设计及精装修设计服务。",
      "officialUrl": "https://example.cn/original/interior",
      "opportunityType": "public_design_services_procurement",
      "procedureType": "open",
      "implementationPath": "service_contract_award_after_competitive_selection",
      "evidenceLevel": "official_notice"
    }
    """

    record = parse_source_payload(source, payload)

    assert "architecture" in record.competition_types
    assert "interior" in record.competition_types


def test_parse_generic_listing_payload_preserves_explicit_china_classification_fields() -> None:
    source = SourceDefinition(
        source_id="ggzy_public_notices",
        collector="ggzy_public_notices",
        name="National Public Resources Trading Platform",
        kind="official_procurement",
        jurisdiction="china",
        base_url="https://www.ggzy.gov.cn/deal/dealList.html",
        scan_method="api",
        extractor="generic_listing_html",
        source_tier="primary",
        enabled=True,
        regions=["asia", "china"],
        languages=["zh"],
    )
    payload = """
    {
      "title": "某医学创新中心项目方案设计、初步设计招标公告",
      "buyer": "某市卫生健康委员会",
      "noticeId": "CN-MED-2026-001",
      "deadline": "2026-06-08",
      "summary": "新建医学创新中心及配套公共服务空间。",
      "officialUrl": "https://example.cn/original/medical-innovation",
      "opportunityType": "public_design_services_procurement",
      "procedureType": "open",
      "implementationPath": "service_contract_award_after_competitive_selection",
      "competitionTypes": ["architecture", "healthcare", "public_building"],
      "projectTypes": ["building_project"],
      "buildingCategories": ["healthcare", "civic_public"],
      "officialSectors": ["building_construction", "design_consulting"],
      "builtAssetTypes": ["healthcare", "office_research"],
      "designScopes": ["scheme", "preliminary"],
      "projectModes": ["new_build"],
      "evidenceLevel": "official_notice"
    }
    """

    record = parse_source_payload(source, payload)

    assert record.project_types == ["building_project"]
    assert record.building_categories == ["healthcare", "civic_public"]
    assert record.official_sectors == ["building_construction", "design_consulting"]
    assert record.built_asset_types == ["healthcare", "office_research"]
    assert record.design_scopes == ["scheme", "preliminary"]
    assert record.project_modes == ["new_build"]
