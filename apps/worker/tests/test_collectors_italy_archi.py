from __future__ import annotations

import json

from support import build_source as _build_source


def test_collect_scp_documents_streams_official_csv_rows() -> None:
    from arch_competition_ops.collectors.scp import collect_scp_documents

    source = _build_source(
        "serviziocontrattipubblici_hub",
        collector="scp_open_data_csv",
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
    assert (
        payload["title"]
        == "Servizi di progettazione architettonica e direzione lavori per scuola civica"
    )
    assert payload["buyer"] == "Comune di Torino"
    assert payload["officialNoticeId"] == "700204"
    assert payload["deadline"] == "2026-05-15"


def test_collect_scp_documents_can_focus_on_curated_italian_authorities() -> None:
    from arch_competition_ops.collectors.scp import collect_scp_documents

    source = _build_source(
        "serviziocontrattipubblici_hub",
        collector="scp_open_data_csv",
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
        collector="anac_legal_publicity_api",
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
    assert (
        documents[0].source_url
        == "https://pubblicitalegale.anticorruzione.it/bandi/fb7c96cb-1af5-4008-a0c4-2d4197479540?ricercaArchivio=true"
    )

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Servizi di progettazione per nuovo polo civico"
    assert payload["buyer"] == "Comune di Ravenna"
    assert payload["officialNoticeId"] == "fb7c96cb-1af5-4008-a0c4-2d4197479540"
    assert payload["estimatedValueEur"] == 560000
    assert payload["deadline"] == "2026-05-22"
    assert payload["officialUrl"] == "https://example.it/gara/123"
    assert (
        payload["sourceApiUrl"]
        == "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/fb7c96cb-1af5-4008-a0c4-2d4197479540"
    )
    assert (
        payload["sourcePublicUrl"]
        == "https://pubblicitalegale.anticorruzione.it/bandi/fb7c96cb-1af5-4008-a0c4-2d4197479540?ricercaArchivio=true"
    )


def test_collect_anac_documents_maps_direct_awards_to_public_esiti_pages() -> None:
    from arch_competition_ops.collectors.anac import collect_anac_documents

    source = _build_source(
        "anac_bdncp_contracts",
        collector="anac_legal_publicity_api",
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
                "idAvviso": "49320bc2-6c80-4bc7-80f0-1e6a7eaeea82",
                "codiceScheda": "AD3",
                "dataPubblicazione": "2026-04-30T06:00:00.578+00:00",
                "template": [
                    {
                        "template": {
                            "metadata": {
                                "descrizione": (
                                    "Affidamento diretto dei servizi di progettazione esecutiva "
                                    "per la stabilizzazione del Museo di Villa Giulia"
                                ),
                            },
                            "sections": [
                                {
                                    "name": "SEZ. A - Committente",
                                    "fields": {
                                        "soggetti_sa": [
                                            {
                                                "denominazione_amministrazione": "MUSEO ETRUSCO DI VILLA GIULIA",
                                            }
                                        ]
                                    },
                                },
                                {
                                    "name": "SEZ. B - Dati Generali",
                                    "fields": {
                                        "documenti_di_gara_link": "https://www.museoetru.it/",
                                    },
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
    assert (
        documents[0].source_url
        == "https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true"
    )

    payload = json.loads(documents[0].payload)
    assert (
        payload["sourcePublicUrl"]
        == "https://pubblicitalegale.anticorruzione.it/esiti/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82?ricercaArchivio=true"
    )
    assert (
        payload["sourceApiUrl"]
        == "https://pubblicitalegale.anticorruzione.it/api/v0/avvisi/49320bc2-6c80-4bc7-80f0-1e6a7eaeea82"
    )


def test_collect_competitions_archi_documents_uses_feed_entries_as_secondary_discovery() -> None:
    from arch_competition_ops.collectors.competitions_archi import (
        collect_competitions_archi_documents,
    )

    source = _build_source(
        "competitions_archi",
        collector="competitions_archi_feed",
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
    assert (
        documents[0].source_url
        == "https://competitions.archi/competition/open-call-civic-waterfront"
    )

    payload = json.loads(documents[0].payload)
    assert payload["title"] == "Open call for civic waterfront professional competition"
    assert payload["publishedAt"] == "2026-04-16"
    assert "For professionals" in payload["categories"]
