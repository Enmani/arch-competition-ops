import json
from pathlib import Path

import pytest
from test_ai_screening import ai_workspace  # noqa: F401

from arch_competition_ops.screening.inputs import prepare_input

SHAPES = json.loads(
    (Path(__file__).parent / "fixtures/notice-source-shapes.json").read_text(encoding="utf-8")
)
GOLDEN = json.loads(
    (Path(__file__).parent / "fixtures/notice-source-rendered.json").read_text(encoding="utf-8")
)
VISIBLE = {
    "detailHtml": ["Projekt 67-2026-00111", "Planung der Außenanlage, 125000 EUR."],
    "rawNoticeHtml": ["项目编号 G-074", "总额 200000 元。"],
    "notice_text": ["Consultoria de arquitetura"],
}


def scalars(value, key=""):
    if key in VISIBLE:
        yield from VISIBLE[key]
    elif isinstance(value, dict):
        for k, v in value.items():
            yield from scalars(v, k)
    elif isinstance(value, list):
        for v in value:
            yield from scalars(v)
    elif isinstance(value, str) and value.startswith("{"):
        yield from scalars(json.loads(value))
    elif value is not None and value != "":
        yield json.dumps(value) if isinstance(value, bool) else str(value)


@pytest.mark.parametrize("name", list(SHAPES))
@pytest.mark.parametrize("route", ["source", "saved_text", "collection"])
def test_all_source_scalar_values_reach_the_wire(ai_workspace, name, route):  # noqa: F811
    settings, _ = ai_workspace
    data = SHAPES[name]
    raw = json.dumps(data)
    if route == "saved_text":
        raw = json.dumps({"rawNotice": raw})
    elif route == "collection":
        raw = json.dumps({"rawNotice": data, "summary": "LOCAL INFERENCE", "extra": {"score": 99}})
    wire, fields, _ = prepare_input(
        {"source_url": "https://buyer.example/n"},
        settings,
        source_payload=raw,
        collected=route == "collection",
    )
    text = fields["notice_text"]
    assert json.loads(wire)["request"]["input"].endswith("notice_text:\n" + text)
    assert text == GOLDEN[name]
    assert "LOCAL INFERENCE" not in text
    assert "HIDDEN" not in text and "<main>" not in text and "<nav>" not in text
    for token in scalars(data):
        assert token in text


@pytest.mark.parametrize("url", ["https://buyer.example/n", "https://www.boamp.fr/"])
def test_clipped_json_keeps_visible_source_text(ai_workspace, url):  # noqa: F811
    settings, _ = ai_workspace
    clipped = '{"id":"CN-9","deadline":"2026-12-09","description":"Architecture for the library'
    _, fields, _ = prepare_input({"source_url": url}, settings, source_payload=clipped)
    assert fields["notice_text"] == clipped


def test_anac_archived_ad3_and_platform_banner_do_not_trigger_payment(ai_workspace):  # noqa: F811
    from arch_competition_ops.screening.readability import NoReadableText
    from arch_competition_ops.screening.source_evidence import notice_text

    settings, _ = ai_workspace
    url = "https://pubblicitalegale.anticorruzione.it/bandi/9"
    data = {
        "officialNoticeId": "823abfae-9855",
        "title": "",
        "buyer": None,
        "procedureType": "AD3",
        "deadline": None,
        "publicationDate": "2026-10-30",
        "estimatedValueEur": None,
        "summary": None,
        "officialUrl": None,
        "sourcePublicUrl": url,
    }
    raw = (
        json.dumps(data)
        + " Source notice detail: ANAC | Piattaforma di Pubblicità a Valore Legale -->"
    )
    text = notice_text(raw, url)
    assert "AD3" in text and "2026-10-30" in text and "823abfae-9855" in text
    with pytest.raises(NoReadableText):
        prepare_input({"source_url": url}, settings, source_payload=raw)


def test_native_field_names_are_preserved_in_source_order(ai_workspace):  # noqa: F811
    settings, _ = ai_workspace
    data = {
        "projectTypes": ["B", "A"],
        "summary": "School",
        "extra": {"customAmount": 0, "flags": [False, True]},
        "rawNoticeHtml": "<main>Library</main>",
        "anotherSourceField": "#1",
        "empty": "",
    }
    _, fields, _ = prepare_input(
        {"source_url": "https://buyer.example/n"}, settings, source_payload=json.dumps(data)
    )
    assert fields["notice_text"].splitlines() == [
        "projectTypes: B",
        "projectTypes: A",
        "summary: School",
        "extra.customAmount: 0",
        "extra.flags: false",
        "extra.flags: true",
        "rawNoticeHtml: Library",
        "anotherSourceField: #1",
    ]


@pytest.mark.parametrize("wrapped", [False, True])
def test_archived_html_field_and_appended_detail_both_reach_request(ai_workspace, wrapped):  # noqa: F811
    settings, _ = ai_workspace
    raw = json.dumps(SHAPES["Frankfurt"]) + " Source notice detail: Bauabschnitt zwei."
    if wrapped:
        raw = json.dumps({"rawNotice": raw})
    _, fields, _ = prepare_input(
        {"source_url": "https://buyer.example/n"}, settings, source_payload=raw
    )
    assert fields["notice_text"] == GOLDEN["Frankfurt"] + "\nBauabschnitt zwei."
