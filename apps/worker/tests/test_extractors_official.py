from arch_competition_ops.extractors import parse_source_payload
from arch_competition_ops.models import SourceDefinition


def test_parse_ted_notice_payload() -> None:
    source = SourceDefinition(
        source_id="ted_design_notices",
        collector="ted_search_api",
        name="TED Design and Procurement Notices",
        kind="official_procurement",
        jurisdiction="eu",
        base_url="https://ted.europa.eu/",
        scan_method="api",
        extractor="ted_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe"],
        languages=["en"],
    )
    payload = """
    {
      "noticeId": "DEMO-TED-2026-0001",
      "title": "Civic Library and Public Square Design Contest",
      "buyer": "Comune Demo Nord",
      "procedureType": "design_contest",
      "deadline": "2026-06-30",
      "estimatedValueEur": "1850000",
      "eligibility": "Lead consultant must hold architect registration.",
      "implementationPath": "winner_or_winners_progress_to_negotiated_service_award",
      "cpv": ["71230000"]
    }
    """

    record = parse_source_payload(source, payload)

    assert record.title == "Civic Library and Public Square Design Contest"
    assert record.authority_name == "Comune Demo Nord"
    assert record.official_notice_id == "DEMO-TED-2026-0001"
    assert record.procedure_type == "design_contest"
    assert record.cpv_codes == ["71230000"]
    assert record.qualification_score is not None


def test_parse_boamp_notice_payload() -> None:
    source = SourceDefinition(
        source_id="boamp_design_notices",
        collector="boamp_opendatasoft",
        name="BOAMP Design and Public Procurement Notices",
        kind="official_procurement",
        jurisdiction="france",
        base_url="https://www.boamp.fr/",
        scan_method="html",
        extractor="boamp_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "france"],
        languages=["fr"],
    )
    payload = """
    <html>
      <body>
        <h1>Avis de concours - Regional Hospital Campus Expansion Design Services</h1>
        <p>Identifiant officiel : DEMO-BOAMP-2026-0042</p>
        <p>Pouvoir adjudicateur : Agence Regionale Infrastructures</p>
        <p>Type de procédure : maitrise_d_oeuvre_procurement</p>
        <p>Date limite : 2026-07-15</p>
        <p>Valeur estimée : 4200000 EUR</p>
        <p>CPV principal : 71240000</p>
        <p>Exigences : Architecte mandataire inscrit requis.</p>
      </body>
    </html>
    """

    record = parse_source_payload(source, payload)

    assert record.title == "Regional Hospital Campus Expansion Design Services"
    assert record.authority_name == "Agence Regionale Infrastructures"
    assert record.official_notice_id == "DEMO-BOAMP-2026-0042"
    assert record.procedure_type == "maitrise_d_oeuvre_procurement"
    assert record.estimated_contract_value_eur == 4200000.0
    assert record.licensed_architect_required is True


def test_parse_simap_notice_payload() -> None:
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        collector="simap_project_api",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="html",
        extractor="simap_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "switzerland"],
        languages=["de", "fr", "it"],
    )
    payload = """
    <html>
      <body>
        <h1>Planungswettbewerb Schulcampus Erweiterung</h1>
        <p>Vergabestelle: Kanton Beispiel Bauamt</p>
        <p>Meldungsnummer: DEMO-SIMAP-2026-010</p>
        <p>Verfahrensart: planning_competition</p>
        <p>Abgabetermin: 2026-09-01</p>
        <p>Geschätzter Auftragswert: CHF 2500000</p>
        <p>CPV: 71230000</p>
        <p>Teilnahmebedingungen: Architekt qualification required.</p>
      </body>
    </html>
    """

    record = parse_source_payload(source, payload)

    assert record.title == "Planungswettbewerb Schulcampus Erweiterung"
    assert record.authority_name == "Kanton Beispiel Bauamt"
    assert record.official_notice_id == "DEMO-SIMAP-2026-010"
    assert record.procedure_type == "planning_competition"
    assert record.estimated_contract_value_eur is None
    assert "currency normalization" in (record.evidence_note or "")


def test_parse_simap_notice_payload_from_detail_json_uses_external_official_url_and_prize_summary() -> (
    None
):
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        collector="simap_project_api",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
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
      "projectSubType": "project_competition",
      "deadline": "2026-08-27",
      "description": "Open project competition for general planners.",
      "officialUrl": "https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html",
      "documentsPortalUrl": "https://konkurado.ch/de/ws-herbstweg",
      "prizeSummary": "Wettbewerbssumme total CHF 220'000.",
      "cpv": ["71200000"]
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://www.simap.ch/api/publications/v1/project/e66757fb-1910-4899-8fc3-7f4bfee043ff/publication-details/3b93fb04-442f-4a7c-910e-5e52f8bd8987",
    )

    assert record.official_url == (
        "https://www.stadt-zuerich.ch/de/planen-und-bauen/projekte-und-ausschreibungen/"
        "hochbauvorhaben/planung-ausfuehrung/wohnsiedlung-herbstweg.html"
    )
    assert record.prize_summary == "Wettbewerbssumme total CHF 220'000."
    assert record.documents_portal_url == "https://konkurado.ch/de/ws-herbstweg"
    assert record.eligibility_summary is None
    assert record.description == "Open project competition for general planners."


def test_parse_simap_notice_payload_maps_selective_procedure() -> None:
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        collector="simap_project_api",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "switzerland"],
        languages=["de", "fr", "it"],
    )
    payload = """
    {
      "officialNoticeId": "BAV-40334",
      "title": "Coopération Leimbach Mitte",
      "buyer": "Stadt Zürich",
      "procedureType": "selective",
      "projectSubType": "project_competition",
      "deadline": "2026-04-21",
      "description": "Selective project competition for general planners.",
      "officialUrl": "https://www.simap.ch/shabforms/servlet/Search?NOTICE_NR=40334",
      "cpv": ["71230000"]
    }
    """

    record = parse_source_payload(source, payload)

    assert record.opportunity_type == "public_design_contest"
    assert record.procedure_type == "selective"


def test_parse_procurement_hub_payload() -> None:
    source = SourceDefinition(
        source_id="serviziocontrattipubblici_hub",
        collector="scp_open_data_csv",
        name="Servizio Contratti Pubblici",
        kind="official_procurement",
        jurisdiction="italy",
        base_url="https://www.serviziocontrattipubblici.it/",
        scan_method="html",
        extractor="procurement_hub_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "italy"],
        languages=["it", "en"],
    )
    payload = """
    {
      "officialNoticeId": "700204",
      "title": "Servizi di progettazione architettonica e direzione lavori per scuola civica",
      "buyer": "Comune di Torino",
      "procedureType": "Avviso",
      "deadline": "2026-05-15",
      "publicationDate": "2026-04-10",
      "sourceDataset": "scp_avvisi_csv",
      "url": "https://www.serviziocontrattipubblici.it/notice/700204"
    }
    """

    record = parse_source_payload(source, payload)

    assert (
        record.title
        == "Servizi di progettazione architettonica e direzione lavori per scuola civica"
    )
    assert record.authority_name == "Comune di Torino"
    assert record.official_notice_id == "700204"
    assert record.deadline_at is not None
    assert record.evidence_level == "official_notice"
    assert record.procedure_type == "public_design_services_tender"


def test_parse_procurement_hub_payload_suppresses_opaque_procedure_code() -> None:
    source = SourceDefinition(
        source_id="anac_bdncp_contracts",
        collector="anac_legal_publicity_api",
        name="ANAC BDNCP",
        kind="official_procurement",
        jurisdiction="italy",
        base_url="https://pubblicitalegale.anticorruzione.it/",
        scan_method="html",
        extractor="bdncp_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "italy"],
        languages=["it"],
    )
    payload = """
    {
      "officialNoticeId": "opaque-ad3-demo",
      "title": "Affidamento incarico di progettazione",
      "buyer": "Comune di Pisa",
      "procedureType": "AD3",
      "summary": "Affidamento diretto servizi di architettura e ingegneria",
      "url": "https://example.it/gara/ad3-demo"
    }
    """

    record = parse_source_payload(source, payload)

    assert record.procedure_type is None


def test_parse_bdncp_notice_payload() -> None:
    source = SourceDefinition(
        source_id="anac_bdncp_contracts",
        collector="anac_legal_publicity_api",
        name="ANAC BDNCP",
        kind="official_procurement",
        jurisdiction="italy",
        base_url="https://pubblicitalegale.anticorruzione.it/",
        scan_method="html",
        extractor="bdncp_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "italy"],
        languages=["it"],
    )
    payload = """
    {
      "officialNoticeId": "fb7c96cb-1af5-4008-a0c4-2d4197479540",
      "title": "Servizi di progettazione per nuovo polo civico",
      "buyer": "Comune di Ravenna",
      "procedureType": "P1",
      "deadline": "2026-05-22",
      "estimatedValueEur": 560000,
      "url": "https://example.it/gara/123",
      "officialUrl": "https://example.it/gara/123",
      "summary": "Affidamento servizi di architettura e ingegneria"
    }
    """

    record = parse_source_payload(
        source,
        payload,
        source_url="https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/fb7c96cb-1af5-4008-a0c4-2d4197479540",
    )

    assert record.title == "Servizi di progettazione per nuovo polo civico"
    assert record.authority_name == "Comune di Ravenna"
    assert record.official_notice_id == "fb7c96cb-1af5-4008-a0c4-2d4197479540"
    assert record.estimated_contract_value_eur == 560000
    # "Affidamento servizi di architettura e ingegneria" is a description, not a qualification
    # clause, so it is not evidence that a licensed architect is required.
    assert record.licensed_architect_required is None
    assert record.procedure_type == "public_design_services_tender"
    assert record.official_url == "https://example.it/gara/123"
    assert (
        record.source_url
        == "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/fb7c96cb-1af5-4008-a0c4-2d4197479540"
    )
    assert record.status == "discovered"


def test_parse_bdncp_archived_notice_payload_marks_archived_status() -> None:
    source = SourceDefinition(
        source_id="anac_bdncp_contracts",
        collector="anac_legal_publicity_api",
        name="ANAC BDNCP",
        kind="official_procurement",
        jurisdiction="italy",
        base_url="https://pubblicitalegale.anticorruzione.it/",
        scan_method="html",
        extractor="bdncp_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "italy"],
        languages=["it"],
    )
    payload = """
    {
      "officialNoticeId": "49320bc2-6c80-4bc7-80f0-1e6a7eaeea82",
      "title": "Affidamento diretto dei servizi di progettazione per Villa Giulia",
      "buyer": "MUSEO ETRUSCO DI VILLA GIULIA",
      "procedureType": "AD3",
      "summary": "Aggiudicazione per affidamento diretto dei servizi di architettura e ingegneria",
      "sourcePublicUrl": "https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true",
      "officialUrl": "https://www.museoetru.it/"
    }
    """

    record = parse_source_payload(source, payload)

    assert record.procedure_type is None
    assert record.status == "archived"


def test_parse_boamp_notice_payload_maps_french_procedure_variants() -> None:
    source = SourceDefinition(
        source_id="boamp_design_notices",
        collector="boamp_opendatasoft",
        name="BOAMP Design and Public Procurement Notices",
        kind="official_procurement",
        jurisdiction="france",
        base_url="https://www.boamp.fr/",
        scan_method="html",
        extractor="boamp_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "france"],
        languages=["fr"],
    )
    negotiated_payload = """
    <html>
      <body>
        <h1>Mission de maîtrise d'oeuvre</h1>
        <p>Identifiant officiel : DEMO-BOAMP-NEG-01</p>
        <p>Pouvoir adjudicateur : Ville Demo</p>
        <p>Type de procédure : Procédure Négociée</p>
      </body>
    </html>
    """
    adapted_payload = """
    <html>
      <body>
        <h1>Rénovation thermique d'un équipement public</h1>
        <p>Identifiant officiel : DEMO-BOAMP-ADAPT-01</p>
        <p>Pouvoir adjudicateur : Département Demo</p>
        <p>Type de procédure : Procédure Adaptée</p>
      </body>
    </html>
    """

    negotiated_record = parse_source_payload(source, negotiated_payload)
    adapted_record = parse_source_payload(source, adapted_payload)

    assert negotiated_record.procedure_type == "negotiated_procedure"
    assert adapted_record.procedure_type == "adapted_procedure"


def test_parse_simap_notice_payload_keeps_native_currency_value_text() -> None:
    source = SourceDefinition(
        source_id="simap_public_design_notices",
        collector="simap_project_api",
        name="simap Swiss Public Procurement",
        kind="official_procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="html",
        extractor="simap_notice_parser",
        source_tier="primary",
        enabled=True,
        regions=["europe", "switzerland"],
        languages=["de", "fr", "it"],
    )
    payload = """
    <html>
      <body>
        <h1>Planungswettbewerb Schulcampus Erweiterung</h1>
        <p>Vergabestelle: Kanton Beispiel Bauamt</p>
        <p>Meldungsnummer: DEMO-SIMAP-2026-010</p>
        <p>Verfahrensart: planning_competition</p>
        <p>Abgabetermin: 2026-09-01</p>
        <p>Geschätzter Auftragswert: CHF 2500000</p>
        <p>CPV: 71230000</p>
        <p>Teilnahmebedingungen: Architekt qualification required.</p>
      </body>
    </html>
    """

    record = parse_source_payload(source, payload)

    assert record.estimated_contract_value_eur is None
    assert record.estimated_contract_value_text == "CHF 2500000"
