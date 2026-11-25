from __future__ import annotations

import json

from support import build_source as _build_source


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
                "url_avis": "https://www.boamp.fr/pages/avis/?q=idweb:26-38966",
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
        publication_date_from="2026-04-01",
        fetch_json=lambda _url: response,
    )

    assert len(documents) == 1
    # Each record links to its own notice page, never the shared site root.
    assert documents[0].source_url == "https://www.boamp.fr/pages/avis/?q=idweb:26-38966"

    payload = json.loads(documents[0].payload)
    assert payload["title"].startswith("MISSION DE MAITRISE D'OEUVRE")
    assert payload["buyer"] == "Département de la Sarthe"
    assert payload["officialNoticeId"] == "26_38966"
    assert payload["deadline"] == "2026-05-18"
    assert payload["cpv"] == ["71241000"]
    assert payload["estimatedValueEur"] == 380000
    assert payload["estimatedValueText"] == "EUR 380,000"
    assert payload["officialUrl"] == documents[0].source_url


def test_collect_boamp_documents_requests_pages_of_100() -> None:
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
