from __future__ import annotations

import json

from support import build_source as _build_source

from arch_competition_ops.collectors.doffin import collect_doffin_documents
from arch_competition_ops.collectors.pcsp import collect_pcsp_documents
from arch_competition_ops.collectors.ted import collect_ted_documents
from arch_competition_ops.collectors.tenderned import collect_tenderned_documents


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
            {
                "isHoofdOpdracht": True,
                "code": "71220000-6",
                "omschrijving": "Architectonische ontwerpdiensten",
            },
            {
                "isHoofdOpdracht": False,
                "code": "71420000-8",
                "omschrijving": "Landschapsarchitectuurdiensten",
            },
        ],
        "links": {
            "pdf": {"href": "/papi/tenderned-rs-tns/v2/publicaties/421000/pdf", "title": "pdf"},
        },
        "link": {"href": "https://www.tenderned.nl/aankondigingen/overzicht/421000"},
    }

    documents = collect_tenderned_documents(
        source,
        limit=5,
        fetch_json=lambda url: (list_response if "publicaties?" in url else detail_response),
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
    assert (
        payload["title"]
        == "Servicio de redacción del proyecto básico y de ejecución para la biblioteca municipal"
    )
    assert payload["buyer"] == "Ayuntamiento de Demo"
    assert payload["noticeId"] == "BIB-2026-001"
    assert payload["deadline"] == "2026-06-11"
    assert payload["cpv"] == ["71221000"]
    assert payload["officialUrl"].endswith("design123")
    assert payload["procedureType"] == "Abierto"


def test_collect_ted_documents_transforms_search_results_into_parser_payloads() -> None:
    source = _build_source(
        "ted_design_notices",
        collector="ted_search_api",
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
    # The currency is not requested from TED, so the amount is never presented as euros.
    assert payload["estimatedValueEur"] is None
    assert payload["estimatedValueText"] == "223,000 (currency not stated)"
    assert payload["officialUrl"] == "https://ted.europa.eu/en/notice/261998-2026/html"


def test_collect_boamp_documents_transforms_records_into_parser_payloads() -> None:
    from arch_competition_ops.collectors.boamp import collect_boamp_documents

    source = _build_source(
        "boamp_design_notices",
        collector="boamp_opendatasoft",
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
                    "MISSION DE MAITRISE D'OEUVRE RELATIVE A LA RESTRUCTURATION LOURDE D'UN COLLEGE"
                ),
                "dateparution": "2026-04-18",
                "datelimitereponse": "2026-05-18T09:30:00+00:00",
                "nomacheteur": "Département de la Sarthe",
                "procedure_libelle": "Procédure Ouverte",
                "nature_libelle": "Avis de marché",
                "type_marche": ["SERVICES"],
                "descripteur_libelle": ["Maîtrise d'oeuvre", "Etude"],
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
    assert payload["title"].startswith("MISSION DE MAITRISE D'OEUVRE")
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
        collector="boamp_opendatasoft",
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


def test_ted_search_requests_the_value_and_currency_fields() -> None:
    from arch_competition_ops.collectors.ted import TED_FIELDS

    assert "estimated-value-cur-lot" in TED_FIELDS
    assert "estimated-value-lot" in TED_FIELDS


def test_ted_value_is_euro_only_if_the_response_itself_says_so() -> None:
    from arch_competition_ops.collectors.ted import _estimated_value

    assert _estimated_value({"estimated-value-lot": ["500000.0"]}) == (
        None,
        "500,000 (currency not stated)",
    )
    assert _estimated_value(
        {"estimated-value-lot": [500000], "estimated-value-cur-lot": ["EUR"]}
    ) == ("500000", "EUR 500,000")
    assert _estimated_value(
        {"estimated-value-lot": ["100"], "estimated-value-cur-lot": ["PLN"]}
    ) == (None, "PLN 100")
    assert _estimated_value({}) == (None, None)
