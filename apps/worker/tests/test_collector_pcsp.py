"""PCSP Atom feed: paging through ``next`` files and the AI scope on the embedded CODICE codes."""

from __future__ import annotations

import json

from support import build_source

from arch_competition_ops.collectors import pcsp
from arch_competition_ops.collectors.pcsp import collect_pcsp_documents

FEED_URL = "https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/feed.atom"
DEEPLINK = "https://contrataciondelestado.es/wps/poc?uri=deeplink:detalle_licitacion&idEvl="
CAC = "urn:dgpe:names:draft:codice:schema:xsd:CommonAggregateComponents-2"
CBC = "urn:dgpe:names:draft:codice:schema:xsd:CommonBasicComponents-2"
CAC_EXT = "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonAggregateComponents-2"
CBC_EXT = "urn:dgpe:names:draft:codice-place-ext:schema:xsd:CommonBasicComponents-2"


def _source():
    return build_source(
        "pcsp_syndicated_notices",
        name="PCSP Syndicated Notices",
        jurisdiction="spain",
        base_url=FEED_URL,
        scan_method="atom",
        extractor="generic_listing_html",
        collector="pcsp_atom_feed",
        languages=["es"],
    )


def _entry(
    key: str,
    updated: str,
    *,
    status: str = "PUB",
    cpv: tuple[str, ...] = (),
    lot_cpv: tuple[str, ...] = (),
    procedure: str = "1",
    title: str | None = None,
) -> str:
    codes = "".join(
        f"<cac:RequiredCommodityClassification><cbc:ItemClassificationCode>{code}"
        "</cbc:ItemClassificationCode></cac:RequiredCommodityClassification>"
        for code in cpv
    )
    lots = "".join(
        "<cac:ProcurementProjectLot><cac:ProcurementProject>"
        f"<cac:RequiredCommodityClassification><cbc:ItemClassificationCode>{code}"
        "</cbc:ItemClassificationCode></cac:RequiredCommodityClassification>"
        "</cac:ProcurementProject></cac:ProcurementProjectLot>"
        for code in lot_cpv
    )
    return f"""
  <entry>
    <id>https://contrataciondelestado.es/sindicacion/licitacionesPerfilContratante/{key}</id>
    <link href="{DEEPLINK.replace("&", "&amp;")}{key}"/>
    <summary>Id licitacion: {key}; Organo de Contratacion: Ayuntamiento; Estado: {status}</summary>
    <title>{title or f"Tender {key}"}</title>
    <updated>{updated}T10:00:00.000+01:00</updated>
    <cac-place-ext:ContractFolderStatus xmlns:cac-place-ext="{CAC_EXT}"
        xmlns:cbc-place-ext="{CBC_EXT}" xmlns:cac="{CAC}" xmlns:cbc="{CBC}">
      <cbc:ContractFolderID>{key}</cbc:ContractFolderID>
      <cbc-place-ext:ContractFolderStatusCode>{status}</cbc-place-ext:ContractFolderStatusCode>
      <cac:ProcurementProject>{codes}</cac:ProcurementProject>
      {lots}
      <cac:TenderingProcess><cbc:ProcedureCode>{procedure}</cbc:ProcedureCode></cac:TenderingProcess>
    </cac-place-ext:ContractFolderStatus>
  </entry>"""


def _feed(entries: list[str], next_url: str | None = None) -> str:
    link = f'<link href="{next_url}" rel="next"/>' if next_url else ""
    return f'<feed xmlns="http://www.w3.org/2005/Atom">{link}{"".join(entries)}</feed>'


def _detail_page(key: str) -> str:
    return (
        '<span id="v:label_EnlaceLic">Link to the bidding</span>'
        f'<a id="v:text_EnlaceLic" href="#">{DEEPLINK}{key}</a>'
        '<span id="v:label_Expediente">File</span>'
        f'<span id="v:text_Expediente">{key}</span>'
    )


class _Site:
    def __init__(self, files: dict[str, str]) -> None:
        self.files = files
        self.requested: list[str] = []

    def __call__(self, url: str) -> str:
        self.requested.append(url)
        if url.startswith(DEEPLINK):
            return _detail_page(url.removeprefix(DEEPLINK))
        return self.files[url]

    def detail_keys(self) -> list[str]:
        return [url.removeprefix(DEEPLINK) for url in self.requested if url.startswith(DEEPLINK)]


def test_follows_next_links_until_the_file_that_leaves_the_window() -> None:
    # The pinned day is 2026-05-13, so the default window starts on 2026-05-06.
    site = _Site(
        {
            FEED_URL: _feed([_entry("a", "2026-05-12", cpv=("71220000",))], f"{FEED_URL}.1"),
            f"{FEED_URL}.1": _feed(
                [
                    _entry("b", "2026-05-08", cpv=("71000000",)),
                    _entry("old", "2026-05-05", cpv=("71000000",)),
                ],
                f"{FEED_URL}.2",
            ),
            # Never read: the previous file already reached entries older than the window.
            f"{FEED_URL}.2": "not xml",
        }
    )

    documents = collect_pcsp_documents(_source(), limit=100, fetch_text=site)

    assert [d.source_url.removeprefix(DEEPLINK) for d in documents] == ["a", "b"]
    assert f"{FEED_URL}.2" not in site.requested
    payload = json.loads(documents[0].payload)
    assert payload["rawNotice"].count("ContractFolderStatusCode") == 2
    assert payload["rawNoticeHtml"] == _detail_page("a")
    assert payload["cpv"] == ["71220000"]


def test_ai_scope_uses_codice_codes_before_fetching_details() -> None:
    entries = [
        _entry("design", "2026-05-12", cpv=("71221000",)),
        _entry("planning", "2026-05-12", cpv=("79931000",)),
        _entry("lot-design", "2026-05-12", cpv=("45000000",), lot_cpv=("71240000",)),
        _entry("unclassified", "2026-05-12"),
        _entry("contest", "2026-05-12", cpv=("92312000",), procedure="8"),
        _entry("cleaning", "2026-05-12", cpv=("90910000",)),
        _entry("awarded", "2026-05-12", status="RES", cpv=("71221000",)),
        _entry("evaluating", "2026-05-12", status="EV", cpv=("71221000",)),
        _entry("prior", "2026-05-12", status="PRE", cpv=("71221000",)),
        # The newest entry of a tender is its current state: this one is already resolved.
        _entry("closed", "2026-05-12", status="RES", cpv=("71221000",)),
        _entry("closed", "2026-05-09", status="PUB", cpv=("71221000",)),
    ]
    site = _Site({FEED_URL: _feed(entries)})

    documents = collect_pcsp_documents(_source(), limit=100, fetch_text=site)

    kept = [
        "design",
        "planning",
        "lot-design",
        "unclassified",
        "contest",
        "cleaning",
        "awarded",
        "evaluating",
        "prior",
        "closed",
    ]
    assert [d.source_url.removeprefix(DEEPLINK) for d in documents] == kept
    assert site.detail_keys() == kept


def test_feed_paging_stops_at_the_file_cap_with_a_warning(monkeypatch, caplog) -> None:
    monkeypatch.setattr(pcsp, "FEED_MAX_FILES", 3)
    files = {
        (FEED_URL if index == 0 else f"{FEED_URL}.{index}"): _feed(
            [_entry(f"t{index}", "2026-05-12", cpv=("71000000",))], f"{FEED_URL}.{index + 1}"
        )
        for index in range(10)
    }
    site = _Site(files)

    with caplog.at_level("WARNING", logger=pcsp.__name__):
        documents = collect_pcsp_documents(_source(), limit=100, fetch_text=site)

    assert len(documents) == 3
    assert "PCSP feed paging stopped after 3 files" in caplog.text


def test_stops_reading_files_once_the_limit_is_reached() -> None:
    site = _Site(
        {
            FEED_URL: _feed(
                [
                    _entry("a", "2026-05-12", cpv=("71000000",)),
                    _entry("b", "2026-05-12", cpv=("71000000",)),
                ],
                f"{FEED_URL}.1",
            ),
            f"{FEED_URL}.1": "not xml",
        }
    )

    documents = collect_pcsp_documents(_source(), limit=2, fetch_text=site)

    assert len(documents) == 2
    assert f"{FEED_URL}.1" not in site.requested


def test_collection_preserves_unclassified_source_material() -> None:
    site = _Site(
        {
            FEED_URL: _feed(
                [_entry("clean", "2026-05-12", title="Servicio de limpieza viaria")],
                f"{FEED_URL}.1",
            ),
            f"{FEED_URL}.1": _feed(
                [
                    _entry(
                        "library",
                        "2026-05-07",
                        cpv=("71221000",),
                        title="Redaccion del proyecto de la biblioteca municipal",
                    )
                ]
            ),
        }
    )

    documents = collect_pcsp_documents(_source(), limit=5, fetch_text=site)

    assert [d.source_url.removeprefix(DEEPLINK) for d in documents] == ["clean", "library"]
    payload = json.loads(documents[1].payload)
    assert "rawNotice" in payload and "rawNoticeHtml" in payload
    # The detail page states no CPV; the entry's own code is kept.
    assert payload["cpv"] == ["71221000"]


def test_ai_scope_keeps_design_and_build_works_tenders_by_title() -> None:
    entries = [
        _entry(
            "mixto",
            "2026-05-12",
            cpv=("45214200",),
            title="Redacción del proyecto y ejecución de las obras del nuevo CEIP",
        ),
        _entry(
            "obras",
            "2026-05-12",
            cpv=("45214200",),
            title="Ejecución de las obras del Proyecto Básico y de Ejecución del CEIP",
        ),
    ]
    site = _Site({FEED_URL: _feed(entries)})

    documents = collect_pcsp_documents(_source(), limit=100, fetch_text=site)

    assert [d.source_url.removeprefix(DEEPLINK) for d in documents] == ["mixto", "obras"]
    assert site.detail_keys() == ["mixto", "obras"]
