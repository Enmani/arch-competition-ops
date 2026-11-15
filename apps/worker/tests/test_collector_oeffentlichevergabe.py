from __future__ import annotations

import io
import json
import zipfile
from datetime import timedelta
from typing import Any

import requests
from support import build_source as _build_source

from arch_competition_ops import clock
from arch_competition_ops.collectors import oeffentlichevergabe
from arch_competition_ops.collectors.oeffentlichevergabe import (
    EXPORT_URL,
    collect_oeffentlichevergabe_documents,
)
from arch_competition_ops.collectors.registry import COLLECTORS
from arch_competition_ops.extractors.registry import parse_source_payload
from arch_competition_ops.http import HttpClient, set_default_client


def _source():
    return _build_source(
        "de_oeffentlichevergabe_notices",
        name="Datenservice Öffentlicher Einkauf",
        jurisdiction="germany",
        base_url=EXPORT_URL,
        scan_method="api",
        extractor="generic_listing_html",
        collector="oeffentlichevergabe_ocds",
        regions=["europe", "germany"],
        languages=["de"],
    )


def _day(offset: int) -> str:
    return (clock.today() - timedelta(days=offset)).isoformat()


def _items(cpv: str, additional: tuple[str, ...]) -> list[dict[str, Any]]:
    return [
        {
            "id": "1",
            "classification": {"scheme": "CPV", "id": cpv},
            "additionalClassifications": [{"scheme": "CPV", "id": code} for code in additional],
            "relatedLot": "LOT-0001",
        }
    ]


def _notice(
    notice_id: str,
    *,
    title: str = "Objektplanung Neubau Grundschule",
    cpv: str = "71221000",
    additional: tuple[str, ...] = (),
    tags: tuple[str, ...] = ("tender",),
    detail_tags: tuple[str, ...] | None = None,
    legal_basis: str | None = "de-vob",
    deadline: str | None = "2026-06-30T12:00:00+02:00",
    published: str = "2026-05-12T08:00:00Z",
    version: str = "01",
    ocid: str | None = None,
    with_detail: bool = True,
) -> tuple[str, dict[str, Any], dict[str, Any] | None]:
    """One notice as the ``ocds`` and ``ocds2`` export members describe it."""
    uri = f"https://oeffentlichevergabe.de/api/notices/{notice_id}?format=ocds&noticeVersion={version}"
    release = {
        "ocid": ocid or f"ocds-mnwr74-{notice_id}",
        "id": notice_id,
        "date": published,
        "tag": list(tags),
        "buyer": {"name": "Stadt Musterstadt"},
        "tender": {
            "title": title,
            "description": f"{title}: Leistungsphasen 1 bis 9 nach HOAI.",
            "items": _items(cpv, additional),
            "procurementMethodDetails": "Public announcement",
        },
    }
    detail = None
    if with_detail:
        tender: dict[str, Any] = {
            "items": _items(cpv, additional),
            "lots": [
                {
                    "id": "LOT-0001",
                    "title": title,
                    **({"tenderPeriod": {"endDate": deadline}} if deadline else {}),
                }
            ],
        }
        if legal_basis:
            tender["legalBasis"] = {"wasDerivedFrom": {"scheme": "CELEX", "id": legal_basis}}
        detail = {
            "ocid": release["ocid"],
            "id": notice_id,
            "tag": list(detail_tags if detail_tags is not None else tags),
            "parties": [{"id": "ORG-0001", "name": "Stadt Musterstadt", "roles": ["buyer"]}],
            "buyer": {"id": "ORG-0001"},
            "tender": tender,
        }
    return uri, release, detail


def _zip(packages: list[tuple[str, dict[str, Any]]]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for index, (uri, release) in enumerate(packages):
            package = {"uri": uri, "version": "1.1", "releases": [release]}
            archive.writestr(f"member-{index}.json", json.dumps(package))
    return buffer.getvalue()


def _exports(days: dict[str, list[tuple[str, dict[str, Any], dict[str, Any] | None]]]):
    """``fetch_bytes`` for the given days; any other day has no export. Records every URL."""
    responses: dict[str, bytes] = {}
    for day, notices in days.items():
        responses[f"{EXPORT_URL}?pubDay={day}&format=ocds.zip"] = _zip(
            [(uri, release) for uri, release, _detail in notices]
        )
        responses[f"{EXPORT_URL}?pubDay={day}&format=ocds2.zip"] = _zip(
            [(uri, detail) for uri, _release, detail in notices if detail is not None]
        )
    requested: list[str] = []

    def fetch(url: str) -> bytes | None:
        requested.append(url)
        return responses.get(url)

    return fetch, requested


def _collect(fetch, **options):
    return collect_oeffentlichevergabe_documents(_source(), fetch_bytes=fetch, **options)


def _payloads(documents) -> list[dict[str, Any]]:
    return [json.loads(document.payload) for document in documents]


def test_oeffentlichevergabe_family_is_registered() -> None:
    assert COLLECTORS["oeffentlichevergabe_ocds"] is collect_oeffentlichevergabe_documents


def test_keeps_open_notices_whose_cpv_codes_are_in_scope() -> None:
    fetch, _ = _exports(
        {
            _day(1): [
                _notice("main-712", cpv="71221000"),
                _notice("additional-71", cpv="45000000", additional=("71240000",)),
                _notice("urban-7993", cpv="79932000"),
                _notice("works-only", cpv="45210000", additional=("45300000",)),
                _notice("software", cpv="72000000"),
                _notice("award", tags=("award",), detail_tags=("award", "contract")),
                _notice("planning-only", tags=("planning",)),
                # A correction of an open notice: ``ocds`` gives no tag, ``ocds2`` says so.
                _notice("correction", tags=(), detail_tags=("tenderUpdate",)),
            ]
        }
    )

    documents = _collect(fetch, publication_date_from=_day(1), include_unclassified=True)

    payloads = {payload["noticeId"]: payload for payload in _payloads(documents)}
    assert set(payloads) == {
        "ocds-mnwr74-main-712",
        "ocds-mnwr74-additional-71",
        "ocds-mnwr74-urban-7993",
        "ocds-mnwr74-correction",
    }
    payload = payloads["ocds-mnwr74-additional-71"]
    assert payload["cpv"] == ["45000000", "71240000"]
    assert payload["title"] == "Objektplanung Neubau Grundschule"
    assert payload["buyer"] == "Stadt Musterstadt"
    assert payload["deadline"] == "2026-06-30"
    assert payload["legalBasis"] == "de-vob"
    assert payload["publishedAt"] == "2026-05-12T08:00:00Z"
    assert payload["rawNotice"]["ocds"]["id"] == "additional-71"
    assert payload["rawNotice"]["ocds2"]["tender"]["lots"][0]["id"] == "LOT-0001"
    assert "opportunityType" not in payload


def test_skips_notices_under_an_eu_directive_because_ted_publishes_them() -> None:
    fetch, _ = _exports(
        {
            _day(1): [
                _notice("eu-classic", legal_basis="32014L0024"),
                _notice("eu-utilities", legal_basis="32014L0025"),
                _notice("national-vob", legal_basis="de-vob"),
                _notice("national-other", legal_basis="other"),
                _notice("no-legal-basis", legal_basis=None),
                _notice("no-detail", with_detail=False),
            ]
        }
    )

    documents = _collect(fetch, publication_date_from=_day(1), include_unclassified=True)

    notice_ids = {payload["noticeId"] for payload in _payloads(documents)}
    assert notice_ids == {
        "ocds-mnwr74-national-vob",
        "ocds-mnwr74-national-other",
        "ocds-mnwr74-no-legal-basis",
        "ocds-mnwr74-no-detail",
    }


def test_each_document_points_at_its_own_notice_page() -> None:
    fetch, _ = _exports(
        {_day(1): [_notice("aaaa-1111", version="01"), _notice("26041676", version="2")]}
    )

    documents = _collect(fetch, publication_date_from=_day(1), include_unclassified=True)

    urls = sorted(document.source_url for document in documents)
    assert urls == [
        "https://oeffentlichevergabe.de/ui/de/search/details?noticeId=26041676&noticeVersion=2",
        "https://oeffentlichevergabe.de/ui/de/search/details?noticeId=aaaa-1111&noticeVersion=01",
    ]
    assert EXPORT_URL not in urls
    assert all(
        payload["officialUrl"] == document.source_url
        for payload, document in zip(_payloads(documents), documents, strict=True)
    )


def test_reads_days_newest_first_and_skips_days_without_an_export() -> None:
    fetch, requested = _exports(
        {
            _day(1): [_notice("yesterday")],
            # _day(2) has no export (404); _day(3) answers with an empty body.
            _day(4): [_notice("four-days-ago")],
        }
    )

    def fetch_with_empty_day(url: str) -> bytes | None:
        if f"pubDay={_day(3)}" in url:
            requested.append(url)
            return b""
        return fetch(url)

    documents = _collect(
        fetch_with_empty_day, publication_date_from=_day(4), include_unclassified=True
    )

    assert [payload["noticeId"] for payload in _payloads(documents)] == [
        "ocds-mnwr74-yesterday",
        "ocds-mnwr74-four-days-ago",
    ]
    assert [url.split("?", 1)[1] for url in requested] == [
        f"pubDay={_day(1)}&format=ocds.zip",
        f"pubDay={_day(1)}&format=ocds2.zip",
        f"pubDay={_day(2)}&format=ocds.zip",
        f"pubDay={_day(3)}&format=ocds.zip",
        f"pubDay={_day(4)}&format=ocds.zip",
        f"pubDay={_day(4)}&format=ocds2.zip",
    ]


def test_default_window_is_the_last_seven_days_and_never_today() -> None:
    fetch, requested = _exports({})

    assert _collect(fetch) == []

    assert [url.split("pubDay=", 1)[1][:10] for url in requested] == [
        _day(offset) for offset in range(1, 8)
    ]


def test_returns_at_most_limit_newest_documents_and_stops_reading_days() -> None:
    fetch, requested = _exports(
        {
            _day(1): [
                _notice("newest", published="2026-05-12T10:00:00Z"),
                _notice("older", published="2026-05-12T09:00:00Z"),
            ],
            _day(2): [_notice("previous-day")],
        }
    )

    documents = _collect(fetch, limit=2, publication_date_from=_day(2), include_unclassified=True)

    assert [payload["noticeId"] for payload in _payloads(documents)] == [
        "ocds-mnwr74-newest",
        "ocds-mnwr74-older",
    ]
    assert not any(f"pubDay={_day(2)}" in url for url in requested)


def test_one_document_per_procedure_and_a_newer_award_closes_it() -> None:
    fetch, _ = _exports(
        {
            _day(1): [
                _notice("corrected", version="2", ocid="ocds-p1", published="2026-05-12T10:00:00Z"),
                _notice("corrected", version="1", ocid="ocds-p1", published="2026-05-12T07:00:00Z"),
                _notice(
                    "awarded-later",
                    ocid="ocds-p2",
                    tags=("award",),
                    detail_tags=("award", "contract"),
                ),
            ],
            _day(2): [_notice("awarded-earlier-tender", ocid="ocds-p2")],
        }
    )

    documents = _collect(fetch, publication_date_from=_day(2), include_unclassified=True)

    assert [document.source_url.rsplit("?", 1)[1] for document in documents] == [
        "noticeId=corrected&noticeVersion=2"
    ]


def test_classified_mode_keeps_only_design_relevant_notices() -> None:
    fetch, _ = _exports(
        {
            _day(1): [
                _notice("architecture", title="Objektplanung Neubau Grundschule"),
                _notice("monitoring", title="Bauwerksüberwachung Speicher", cpv="71300000"),
            ]
        }
    )

    documents = _collect(fetch, publication_date_from=_day(1))

    payloads = _payloads(documents)
    assert [payload["noticeId"] for payload in payloads] == ["ocds-mnwr74-architecture"]
    assert "rawNotice" not in payloads[0]


def test_generic_listing_parser_reads_the_payload() -> None:
    fetch, _ = _exports({_day(1): [_notice("26041676", version="1")]})
    document = _collect(fetch, publication_date_from=_day(1))[0]

    record = parse_source_payload(_source(), document.payload, source_url=document.source_url)

    assert record.title == "Objektplanung Neubau Grundschule"
    assert record.authority_name == "Stadt Musterstadt"
    assert record.official_notice_id == "ocds-mnwr74-26041676"
    assert record.deadline_at is not None and record.deadline_at.isoformat() == "2026-06-30"
    assert record.official_url == document.source_url
    assert record.cpv_codes == ["71221000"]
    assert record.evidence_level == "official_notice"


class _StatusSession:
    def __init__(self, status: int, body: bytes) -> None:
        self.status = status
        self.body = body

    def request(self, method, url, **_kwargs):
        response = requests.Response()
        response.status_code = self.status
        response.url = url
        response.raw = io.BytesIO(self.body)
        return response

    def close(self) -> None:
        return None


def test_default_fetch_treats_404_as_a_day_without_export() -> None:
    public = lambda _host: ["93.184.216.34"]  # noqa: E731 - resolver stub
    set_default_client(HttpClient(session=_StatusSession(404, b"Not Found"), resolver=public))
    assert oeffentlichevergabe._default_fetch_bytes(f"{EXPORT_URL}?pubDay=x") is None

    set_default_client(HttpClient(session=_StatusSession(200, b"PK-zip"), resolver=public))
    assert oeffentlichevergabe._default_fetch_bytes(f"{EXPORT_URL}?pubDay=x") == b"PK-zip"


def test_ai_mode_keeps_design_and_build_works_notices_and_rule_mode_does_not() -> None:
    fetch, _requested = _exports(
        {
            "2026-05-12": [
                _notice(
                    "tu", cpv="45214200", title="Totalunternehmerleistungen Neubau Grundschule"
                ),
                _notice("works", cpv="45214200", title="Rohbauarbeiten Neubau Grundschule"),
            ]
        }
    )

    documents = _collect(fetch, limit=50, include_unclassified=True)
    assert [payload["noticeId"] for payload in _payloads(documents)] == ["ocds-mnwr74-tu"]
    assert _collect(fetch, limit=50) == []
