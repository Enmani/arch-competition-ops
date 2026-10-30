"""Display titles: rule cleaning, AI acceptance checks, persistence, caching and merge behaviour."""

from __future__ import annotations

import json
import sqlite3
from datetime import date

import httpx
import pytest
from openai import OpenAI
from support import write_minimal_config

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import upsert_competition
from arch_competition_ops.titles.clean import clean_title, needs_condensing
from arch_competition_ops.titles.rewrite import TitlePair, accept_condensed, space_cjk_latin
from arch_competition_ops.titles.service import ai_source_token, polish_titles


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        # Platform prefixes that duplicate card fields.
        (
            "Germany – Architectural and related services – Planung der Außenanlagen Schulzentrum",
            "Planung der Außenanlagen Schulzentrum",
        ),
        ("GB-Colchester: Fire Door Remediation Works", "Fire Door Remediation Works"),
        # Reference numbers, with and without a separator.
        ("323443 - Proposed UniRec New Build Project", "Proposed UniRec New Build Project"),
        ("CON00003990-2026 - Gower Park Artificial Turf", "Gower Park Artificial Turf"),
        (
            "1-W-0070353-26: Renovatie Jan Kuitenbrug te Rotterdam (NL)",
            "Renovatie Jan Kuitenbrug te Rotterdam (NL)",
        ),
        (
            "BW-12571-GÜ-26 Generalübernehmerleistungen für ein Wohngebäude",
            "Generalübernehmerleistungen für ein Wohngebäude",
        ),
        # The region suffix is information, not a reference number.
        (
            "EW699-260375C-NWT Multidisciplinary Environmental Consulting",
            "NWT Multidisciplinary Environmental Consulting",
        ),
        # Typography: dashes, underscores, trailing junk, a closing quote without its opening half.
        ("Schwammschulhöfe - Vorplanung Freianlagen", "Schwammschulhöfe – Vorplanung Freianlagen"),
        (
            "Heinrich-Seliger-Schule_Planungsleistungen",
            "Heinrich-Seliger-Schule – Planungsleistungen",
        ),
        ("Maintenance des portes coupe-feu-.", "Maintenance des portes coupe-feu"),
        (
            "Planung Wohneinheiten in Bad Doberan Doberan“",
            "Planung Wohneinheiten in Bad Doberan Doberan",
        ),
        # All caps becomes sentence case; known acronyms and numbers survive.
        (
            "MAINTENANCE DES INSTALLATIONS DE DESENFUMAGE (73)",
            "Maintenance des installations de desenfumage (73)",
        ),
        ("PLANUNGSLEISTUNGEN GEM. HOAI LPH 2-8", "Planungsleistungen gem. HOAI LPH 2-8"),
    ],
)
def test_clean_title_removes_noise_only(raw, expected):
    assert clean_title(raw) == expected


@pytest.mark.parametrize(
    "title",
    [
        "Haus 1 Neubau Schule Ost",  # a lot or building number is part of the name
        "M-54 Parking Lot, Watermain and Storm Rehabilitation Project",
        "文山市第十六中学建设项目方案设计及初步设计招标公告",
        "Taihape Grandstand Restoration Project – Lead Consultant",
    ],
)
def test_clean_title_leaves_clean_titles_alone(title):
    assert clean_title(title) == title


def test_clean_title_never_returns_an_empty_title():
    assert clean_title("12345 - ab") == "12345 – ab"
    assert clean_title("   ") == ""


def test_long_and_all_caps_titles_go_to_the_ai_stage():
    short = "Haus 1 Neubau Schule Ost"
    assert not needs_condensing(short, clean_title(short))
    long_title = "Sanierung und Erweiterung der Kindertagesstätte Haus der Kinder in Musterstadt"
    assert needs_condensing(long_title, clean_title(long_title))
    shouting = "CONCOURS DE MAITRISE D'OEUVRE"
    assert needs_condensing(shouting, clean_title(shouting))
    # A CJK character is as wide as two Latin letters.
    assert needs_condensing("文" * 31, "文" * 31)
    assert not needs_condensing("文" * 30, "文" * 30)


def _pair(**overrides) -> TitlePair:
    values = {
        "id": 0,
        "title_en": "Haus der Kinder daycare refurbishment",
        "title_zh": "Haus der Kinder 幼儿园改扩建（HOAI 1–9 阶段）",
    }
    values.update(overrides)
    return TitlePair(**values)


def test_ai_titles_must_not_invent_numbers():
    source = "Sanierung Kindertagesstätte Haus der Kinder, HOAI 2021, Lph 1 bis 9"
    assert accept_condensed(source, _pair()) is not None
    assert accept_condensed(source, _pair(title_en="Haus der Kinder daycare, phases 1–12")) is None
    assert (
        accept_condensed(source, _pair(title_zh="Haus der Kinder 幼儿园改扩建（15 个月）")) is None
    )


def test_ai_titles_must_be_the_right_language_and_length():
    source = "Sanierung Kindertagesstätte Haus der Kinder"
    assert accept_condensed(source, _pair(title_en="幼儿园改扩建")) is None
    assert accept_condensed(source, _pair(title_zh="Haus der Kinder refurbishment")) is None
    assert accept_condensed(source, _pair(title_en="x" * 90)) is None
    assert accept_condensed(source, _pair(title_en="  ", title_zh="幼儿园")) is None


def test_ai_titles_drop_trailing_punctuation():
    accepted = accept_condensed(
        "Haus der Kinder",
        _pair(title_en="Haus der Kinder refurbishment.", title_zh="Haus der Kinder 幼儿园改扩建 –"),
    )
    assert accepted is not None
    assert accepted.title_en == "Haus der Kinder refurbishment"
    assert accepted.title_zh == "Haus der Kinder 幼儿园改扩建"


LONG_TITLE = (
    "Germany – Architectural and related services – Sanierung und Erweiterung Kindertagesstätte "
    "„Haus der Kinder“ - Objektplanung Gebäude gemäß Teil 3, Abschnitt 1 § 33ff. HOAI 2021, Lph 1 bis 9"
)


@pytest.fixture
def title_workspace(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    write_minimal_config(tmp_path, "sources: []")
    return Settings(root=tmp_path, _env_file=None, openai_api_key="test-secret")


def _record(title: str, **overrides) -> CompetitionRecord:
    values = {
        "title": title,
        "organizer": "Stadt Musterstadt",
        "source_id": "src",
        "source_name": "Source",
        "source_url": "https://platform.example/notice/1",
        "official_notice_id": "N-1",
        "deadline_at": date(2099, 9, 1),
    }
    values.update(overrides)
    return CompetitionRecord(**values)


def _row(settings: Settings, competition_id: str) -> sqlite3.Row:
    with sqlite3.connect(settings.resolve_path(settings.db)) as connection:
        connection.row_factory = sqlite3.Row
        return connection.execute(
            "SELECT * FROM competitions WHERE id = ?", (competition_id,)
        ).fetchone()


def _client(calls: list[dict], payload: dict) -> OpenAI:
    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(json.loads(request.content))
        return httpx.Response(
            200,
            json={
                "id": "resp-titles",
                "object": "response",
                "created_at": 1,
                "model": "gpt-6-luna",
                "status": "completed",
                "output": [
                    {
                        "type": "message",
                        "id": "msg",
                        "role": "assistant",
                        "status": "completed",
                        "content": [
                            {"type": "output_text", "text": json.dumps(payload), "annotations": []}
                        ],
                    }
                ],
                "usage": {"input_tokens": 900, "output_tokens": 300, "total_tokens": 1200},
            },
        )

    return OpenAI(
        api_key="test-secret",
        max_retries=0,
        http_client=httpx.Client(transport=httpx.MockTransport(handler)),
    )


def _store(settings: Settings, *titles: str) -> list[str]:
    db_path = settings.resolve_path(settings.db)
    return [
        upsert_competition(
            db_path,
            _record(
                title,
                source_url=f"https://platform.example/notice/{index}",
                official_notice_id=f"N-{index}",
            ),
        )
        for index, title in enumerate(titles)
    ]


def test_rules_stage_stores_a_cleaned_title_without_any_network(title_workspace):
    (competition_id,) = _store(title_workspace, "323443 - Proposed UniRec New Build Project")

    summary = polish_titles(title_workspace, use_ai=False)

    assert (summary.cleaned, summary.pending_ai, summary.batches) == (1, 0, 0)
    row = _row(title_workspace, competition_id)
    assert row["title"] == "323443 - Proposed UniRec New Build Project"
    assert row["display_title"] == "Proposed UniRec New Build Project"
    assert row["display_title_en"] is None
    # A second run has nothing to do.
    assert polish_titles(title_workspace, use_ai=False).cleaned == 0


def test_ai_stage_condenses_only_long_titles_in_one_batched_request(title_workspace):
    short_id, long_id = _store(
        title_workspace, "Taihape Grandstand Restoration Project", LONG_TITLE
    )
    calls: list[dict] = []
    # The model is addressed by the position of the title in the request, not its database id.
    payload = {
        "items": [
            {
                "id": 0,
                "title_en": "Haus der Kinder daycare: refurbishment and extension",
                "title_zh": "Haus der Kinder 幼儿园改扩建（HOAI 1–9 阶段）",
            }
        ]
    }

    summary = polish_titles(title_workspace, use_ai=True, client=_client(calls, payload))

    assert len(calls) == 1
    sent = json.loads(calls[0]["input"])["titles"]
    assert [item["title"] for item in sent] == [clean_title(LONG_TITLE)]
    assert calls[0]["reasoning"] == {"effort": "low"}
    assert (summary.batches, summary.condensed, summary.rejected) == (1, 1, 0)
    assert summary.cost_usd > 0

    long_row = _row(title_workspace, long_id)
    assert long_row["display_title_en"] == "Haus der Kinder daycare: refurbishment and extension"
    assert long_row["display_title_zh"].startswith("Haus der Kinder 幼儿园")
    assert long_row["display_title_source"] == ai_source_token(title_workspace.ai_model)
    assert long_row["title"] == LONG_TITLE
    short_row = _row(title_workspace, short_id)
    assert short_row["display_title_en"] is None
    assert short_row["display_title"] == "Taihape Grandstand Restoration Project"

    # Up to date: no further request.
    assert polish_titles(title_workspace, use_ai=True, client=_client(calls, payload)).batches == 0
    assert len(calls) == 1


def test_rejected_ai_titles_fall_back_to_the_cleaned_title(title_workspace):
    (competition_id,) = _store(title_workspace, LONG_TITLE)
    payload = {
        "items": [
            {"id": 0, "title_en": "Daycare refurbishment, phases 1–12", "title_zh": "幼儿园改扩建"}
        ]
    }

    summary = polish_titles(title_workspace, use_ai=True, client=_client([], payload))

    assert (summary.condensed, summary.rejected) == (0, 1)
    row = _row(title_workspace, competition_id)
    assert row["display_title"] == clean_title(LONG_TITLE)
    assert row["display_title_en"] is None
    assert row["display_title_source"] == "rules-1"


def test_identical_requests_are_served_from_the_ledger(title_workspace):
    _store(title_workspace, LONG_TITLE)
    calls: list[dict] = []
    payload = {
        "items": [
            {"id": 0, "title_en": "Haus der Kinder daycare", "title_zh": "Haus der Kinder 幼儿园"}
        ]
    }
    polish_titles(title_workspace, use_ai=True, client=_client(calls, payload))

    # A forced re-derivation produces the same request, so it costs nothing.
    summary = polish_titles(
        title_workspace, use_ai=True, force=True, client=_client(calls, payload)
    )

    assert len(calls) == 1
    assert (summary.batches, summary.cached_batches, summary.cost_usd) == (1, 1, 0)


def test_budget_exhaustion_keeps_rule_cleaned_titles(title_workspace):
    (competition_id,) = _store(title_workspace, LONG_TITLE)
    settings = Settings(
        root=title_workspace.root,
        _env_file=None,
        openai_api_key="test-secret",
        ai_daily_budget_usd=0,
    )

    summary = polish_titles(settings, use_ai=True, client=_client([], {"items": []}))

    assert "budget" in summary.errors[0]
    assert _row(settings, competition_id)["display_title"] == clean_title(LONG_TITLE)


def test_a_changed_source_title_invalidates_the_derived_titles(title_workspace):
    (competition_id,) = _store(title_workspace, "323443 - Proposed UniRec New Build Project")
    polish_titles(title_workspace, use_ai=False)
    assert _row(title_workspace, competition_id)["display_title"]

    # Same notice, corrected title: the old display title must not survive it.
    db_path = title_workspace.resolve_path(title_workspace.db)
    upsert_competition(
        db_path,
        _record(
            "323443 - Proposed UniRec Extension",
            official_notice_id="N-0",
            source_url="https://platform.example/notice/0",
        ),
    )

    row = _row(title_workspace, competition_id)
    assert row["title"] == "323443 - Proposed UniRec Extension"
    assert (row["display_title"], row["display_title_source"]) == (None, None)


def test_reingesting_an_unchanged_title_keeps_the_derived_titles(title_workspace):
    (competition_id,) = _store(title_workspace, "323443 - Proposed UniRec New Build Project")
    polish_titles(title_workspace, use_ai=False)

    db_path = title_workspace.resolve_path(title_workspace.db)
    upsert_competition(
        db_path,
        _record(
            "323443 - Proposed UniRec New Build Project",
            official_notice_id="N-0",
            source_url="https://platform.example/notice/0",
        ),
    )

    assert (
        _row(title_workspace, competition_id)["display_title"]
        == "Proposed UniRec New Build Project"
    )


def test_chinese_titles_get_a_space_between_scripts():
    assert (
        space_cjk_latin("Ohourere水处理厂电气升级（第2阶段）")
        == "Ohourere 水处理厂电气升级（第 2 阶段）"
    )
    assert space_cjk_latin("Haus der Kinder 幼儿园") == "Haus der Kinder 幼儿园"
