import json
from datetime import timedelta
from types import SimpleNamespace

import pytest
from test_ai_screening import ai_workspace, decision_payload  # noqa: F401

from arch_competition_ops import clock
from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.ingest import ingest_source
from arch_competition_ops.screening.models import ScreeningAnswer, validate_evidence
from arch_competition_ops.storage.connection import connect


@pytest.mark.parametrize(
    ("url", "raw", "kind"),
    [
        ("https://ggzy.example/notice/1", "", "notice_url"),
        ("https://www.boamp.fr/", "BOAMP Accueil Rechercher un avis Mon compte", "site_root"),
        (
            "https://www.boamp.fr/",
            '<div role="navigation"><a href="/a">Avis</a></div>',
            "site_root",
        ),
        ("https://anac.example/1", {"title": "", "buyer": None}, "notice_url"),
        (
            "https://anac.example/2",
            {
                "title": None,
                "idAvviso": "ABC-123",
                "codiceScheda": "P7_2",
                "date": "2026-11-09T09:30:00Z",
                "sections": [],
            },
            "notice_url",
        ),
        (
            "https://anac.example/3",
            {"templates": [{"metadata": {"titolo": "", "buyer": None}}]},
            "notice_url",
        ),
    ],
)
def test_unreadable_notices_refetched_without_paid_calls(ai_workspace, monkeypatch, url, raw, kind):  # noqa: F811
    settings, source = ai_workspace
    settings.ai_enabled = True
    settings.ai_fetch_details = False
    monkeypatch.setattr("arch_competition_ops.ingest._find_enabled_source", lambda *_: source)
    calls, fetches = [], []

    def provider(*args):
        calls.append(1)
        raise AssertionError("Unexpected paid request")

    def fetch(address, **kwargs):
        fetches.append(address)
        return SimpleNamespace(headers={}, text="<nav>Navigation</nav>")

    monkeypatch.setattr("arch_competition_ops.screening.service.create_client", provider)
    monkeypatch.setattr(
        "arch_competition_ops.screening.inputs.get_default_client",
        lambda: SimpleNamespace(get=fetch),
    )
    now = clock.now_utc()
    for day in range(4):
        monkeypatch.setattr(clock, "now_utc", lambda day=day: now + timedelta(days=day))
        documents = [] if day else [CollectedSourceDocument(url, json.dumps({"rawNotice": raw}))]
        run = ingest_source(settings, source_id=source.source_id, collected_documents=documents)
        if day < 3:
            assert any(
                "no_readable_text" in note and source.source_id in note and kind in note
                for note in run.notes
            )
        assert not run.failures and not calls
    assert fetches == [url, url]
    with connect(settings.resolve_path(settings.db)) as cx:
        row = cx.execute("SELECT status,attempts FROM notice_backlog").fetchone()
        assert tuple(row) == ("no_readable_text", 0)
        assert not cx.execute("SELECT count(*) FROM ai_screening_runs").fetchone()[0]


def test_translated_title_has_no_second_value():
    original = "Contratação de especialistas em salvaguardas sociais"
    fact = {"field": "title", "quote": original}
    answer = ScreeningAnswer.model_validate(decision_payload(extracted_fields=[fact]))
    stored = validate_evidence(answer, {"notice_text": original})
    assert stored.extracted_fields[0].value == original
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        ScreeningAnswer.model_validate(
            decision_payload(extracted_fields=[{**fact, "value": "Hiring specialists"}])
        )


def test_refetched_notice_can_be_read_and_saved(ai_workspace, monkeypatch):  # noqa: F811
    from test_ai_screening import mock_client, response

    settings, source = ai_workspace
    settings.ai_fetch_details = False
    settings.ai_enabled = True
    monkeypatch.setattr("arch_competition_ops.ingest._find_enabled_source", lambda *_: source)
    monkeypatch.setattr(
        "arch_competition_ops.ingest.enrich_record_geocode", lambda record, **kw: record
    )
    url = "https://city.example/call"
    title = "Concours de maîtrise d’œuvre"
    calls = []

    def respond(request):
        calls.append(request)
        return response(
            decision_payload(
                evidence=[title], extracted_fields=[{"field": "title", "quote": title}]
            )
        )

    monkeypatch.setattr(
        "arch_competition_ops.screening.service.create_client", lambda _: mock_client(respond)
    )
    monkeypatch.setattr(
        "arch_competition_ops.screening.inputs.get_default_client",
        lambda: SimpleNamespace(
            get=lambda *a, **kw: SimpleNamespace(headers={}, text=f"<main><h1>{title}</h1></main>")
        ),
    )

    def run(documents):
        return ingest_source(settings, source_id=source.source_id, collected_documents=documents)

    run([CollectedSourceDocument(url, "<nav>Menu</nav>")])
    run([])
    assert not calls
    tomorrow = clock.now_utc() + timedelta(days=1)
    monkeypatch.setattr(clock, "now_utc", lambda: tomorrow)
    assert len(run([]).ingested_ids) == 1
    assert len(calls) == 1
    with connect(settings.resolve_path(settings.db)) as cx:
        assert cx.execute("SELECT status FROM notice_backlog").fetchone()[0] == "done"
        assert cx.execute("SELECT title FROM competitions").fetchone()[0] == title


def test_structural_check_keeps_short_text_for_unfamiliar_notices():
    from arch_competition_ops.screening.readability import has_notice_text

    assert has_notice_text("<nav>Main menu</nav><article>设计</article>", "https://site.example/")
    assert has_notice_text('{"unfamiliar": ["Biblioteca"]}', "https://www.boamp.fr/")
    assert not has_notice_text("<nav>Accueil</nav>", "https://site.example/notice/3")
