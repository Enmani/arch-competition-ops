from __future__ import annotations

import json

from support import build_source as _build_source


def test_collect_simap_documents_transforms_public_search_results() -> None:
    from arch_competition_ops.collectors.simap import collect_simap_documents

    source = _build_source(
        "simap_public_design_notices",
        collector="simap_project_api",
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
        publication_date_from="2026-03-01",
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
    assert (
        payload["documentsPortalUrl"]
        == "https://procurement.lausanne.ch/competitions/museum-extension"
    )
    assert (
        payload["description"]
        == "Open project competition for the museum extension and public realm upgrade."
    )
    assert payload["prizeSummary"] == "Honorarium and prize pool: CHF 120000."
    assert payload["authorityEmail"] == "competition@lausanne.ch"


def test_collect_simap_documents_skips_projects_without_latest_publication_detail() -> None:
    from arch_competition_ops.collectors.simap import collect_simap_documents

    source = _build_source(
        "simap_public_design_notices",
        collector="simap_project_api",
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
        collector="simap_project_api",
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
                        "title": {
                            "fr": "Extension du complexe sportif et de loisirs Looren, 8124 Maur"
                        },
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
                    "title": {
                        "fr": "Extension du complexe sportif et de loisirs Looren, 8124 Maur"
                    },
                }
            }
        if "publication-details" in url:
            return {
                "project-info": {
                    "title": {
                        "fr": "Extension du complexe sportif et de loisirs Looren, 8124 Maur"
                    },
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
        publication_date_from="2026-04-01",
        fetch_json=fake_fetch_json,
    )

    assert len(documents) == 1
    payload = json.loads(documents[0].payload)
    assert payload["estimatedValueText"] == (
        "L'objectif budgétaire de 16 millions de francs suisses pour la réalisation de "
        "l'ensemble du projet de construction doit être impérativement respecté."
    )
    assert payload["officialUrl"] == "https://www.simap.ch/de/project-detail/maur-project"
    assert (
        payload["prizeSummary"]
        == "Le montant total mis à disposition du jury est de CHF 130'000 hors TVA."
    )


def _simap_source():
    return _build_source(
        "simap_public_design_notices",
        collector="simap_project_api",
        name="simap Swiss Public Procurement",
        jurisdiction="switzerland",
        base_url="https://www.simap.ch/",
        scan_method="api",
        extractor="simap_notice_parser",
        languages=["de", "fr", "it"],
    )


def _project(project_id: str, published: str, sub_type: str = "service") -> dict:
    return {
        "id": project_id,
        "publicationId": f"{project_id}-pub",
        "publicationDate": published,
        "projectSubType": sub_type,
        "pubType": "tender",
        "title": {"en": f"Notice {project_id}"},
    }


def _detail(url: str) -> dict:
    project_id = url.split("/project/")[1].split("/")[0]
    return {"project-info": {"title": {"en": f"Notice {project_id}"}}}


def test_simap_ai_mode_scopes_searches_server_side_and_pages_the_window() -> None:
    from datetime import timedelta
    from urllib.parse import parse_qs, urlsplit

    from arch_competition_ops import clock
    from arch_competition_ops.collectors.simap import collect_simap_documents

    today = clock.today()
    in_window = (today - timedelta(days=1)).isoformat()
    window_start = (today - timedelta(days=7)).isoformat()
    searches: list[dict[str, list[str]]] = []

    def fetch_json(url: str) -> dict:
        if "publication-details" in url:
            return _detail(url)
        query = parse_qs(urlsplit(url).query)
        searches.append(query)
        assert query["newestPublicationFrom"] == [window_start]
        assert "cpvCodes" not in query and "projectSubTypes" not in query
        if "lastItem" not in query:
            page = [_project("a", in_window), _project("contest", in_window)]
            return {"projects": page, "pagination": {"lastItem": f"{in_window}|2"}}
        assert query["lastItem"] == [f"{in_window}|2"]
        return {"projects": [_project("b", in_window)], "pagination": {"lastItem": None}}

    documents = collect_simap_documents(_simap_source(), limit=50, fetch_json=fetch_json)

    assert [json.loads(d.payload)["title"] for d in documents] == [
        "Notice a",
        "Notice contest",
        "Notice b",
    ]
    assert len(searches) == 2
    payload = json.loads(documents[0].payload)
    assert documents[0].source_url.endswith("/project/a/publication-details/a-pub")
    assert payload["rawNotice"]["listing"]["id"] == "a"
    assert payload["rawNotice"]["detail"] == {"project-info": {"title": {"en": "Notice a"}}}


def test_simap_stops_at_the_window_end_and_at_the_limit() -> None:
    from arch_competition_ops.collectors.simap import collect_simap_documents

    pages_read = []

    def fetch_json(url: str) -> dict:
        if "publication-details" in url:
            return _detail(url)
        if "project_competition" in url or "cpvCodes=45000000" in url:
            return {"projects": []}
        pages_read.append(url)
        page = [_project("new", "2026-05-10"), _project("old", "2026-04-30")]
        return {"projects": page, "pagination": {"lastItem": "2026-04-30|9"}}

    documents = collect_simap_documents(
        _simap_source(),
        limit=50,
        publication_date_from="2026-05-01",
        fetch_json=fetch_json,
    )
    assert [json.loads(d.payload)["title"] for d in documents] == ["Notice new"]
    assert len(pages_read) == 1

    documents = collect_simap_documents(
        _simap_source(),
        limit=1,
        publication_date_from="2026-04-01",
        fetch_json=fetch_json,
    )
    assert len(documents) == 1


def test_simap_paging_stops_at_the_page_cap_with_a_warning(monkeypatch, caplog) -> None:
    from arch_competition_ops.collectors import simap

    monkeypatch.setattr(simap, "SIMAP_MAX_PAGES", 3)
    pages = iter(range(100))

    def fetch_json(url: str) -> dict:
        if "publication-details" in url:
            return _detail(url)
        if "project_competition" in url or "cpvCodes=45000000" in url:
            return {"projects": []}
        number = next(pages)
        return {
            "projects": [_project(f"p{number}", "2026-05-12")],
            "pagination": {"lastItem": f"2026-05-12|{number}"},
        }

    with caplog.at_level("WARNING", logger=simap.__name__):
        documents = simap.collect_simap_documents(_simap_source(), limit=50, fetch_json=fetch_json)

    assert len(documents) == 3
    assert "simap paging stopped after 3 pages" in caplog.text


def test_simap_collection_keeps_awards_and_contests_in_window() -> None:
    from urllib.parse import parse_qs, urlsplit

    from arch_competition_ops.collectors.simap import collect_simap_documents

    def fetch_json(url: str) -> dict:
        if "publication-details" in url:
            return {"project-info": {"title": {"en": "Museum project competition"}}}
        query = parse_qs(urlsplit(url).query)
        assert "projectSubTypes" not in query
        assert query["newestPublicationFrom"] == ["2026-05-06"]
        assert "cpvCodes" not in query and "newestPubTypes" not in query
        award = {**_project("award", "2026-05-12", "project_competition"), "pubType": "award"}
        contest = {**_project("c", "2026-05-12", "project_competition"), "pubType": "competition"}
        return {"projects": [award, contest]}

    documents = collect_simap_documents(_simap_source(), fetch_json=fetch_json)
    assert [d.source_url.rsplit("/", 1)[-1] for d in documents] == ["award-pub", "c-pub"]
