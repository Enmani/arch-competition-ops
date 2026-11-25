import json
import sqlite3
from datetime import date

import yaml
from test_ai_screening import ai_workspace, decision_payload, mock_client, response  # noqa: F401

from arch_competition_ops.screening import service
from arch_competition_ops.screening.inputs import prepare_input
from arch_competition_ops.screening.service import screen_notice
from arch_competition_ops.storage.backlog import listing_deadline
from arch_competition_ops.storage.connection import connect
from arch_competition_ops.storage.schema import ensure_schema


def test_public_replay_merges_facts_and_accounts_for_one_repair(ai_workspace, monkeypatch):  # noqa: F811
    settings, source = ai_workspace
    (settings.root / "config/sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}), encoding="utf-8"
    )
    row = {"source_id": source.source_id, "source_url": "https://city.example/n/1"}
    data = {
        "title": "Library renovation",
        "noticeId": "LIB-8",
        "buyer": "City Council",
        "deadline": "2026-12-09",
        "estimatedValueEur": 120000,
        "summary": "Open design contest",
    }
    payload = json.dumps({"rawNotice": json.dumps(data)})
    sent = []

    def fake(request):
        sent.append(json.loads(request.content))
        if len(sent) == 1:
            return response(decision_payload(relevance_score=101))
        assert len(sent) == 2
        return response(
            decision_payload(evidence=["Open design contest"], title_quote="", extracted_fields=[])
        )

    monkeypatch.setattr(service, "create_client", lambda _: mock_client(fake))
    result = screen_notice(settings, row, payload)
    assert not result.failure
    assert result.record.title == data["title"] and result.record.deadline_at == date(2026, 12, 9)
    assert result.record.estimated_contract_value_eur == 120000
    assert {f.field for f in result.decision.extracted_fields} == {
        "title",
        "authority_name",
        "official_notice_id",
        "deadline_at",
        "estimated_contract_value_eur",
    }
    assert result.usage == (4000, 2000) and result.cost_usd > 0
    schema = sent[0]["text"]["format"]["schema"]
    assert "deadline_at" not in schema["$defs"]["NormalizedFact"]["properties"]["field"]["enum"]
    assert schema["properties"]["title_quote"]["enum"] == [""]
    assert (
        sent[0]["input"] == sent[1]["input"]
        and "relevance_score: less_than_equal" in sent[1]["instructions"]
    )
    with connect(settings.resolve_path(settings.db)) as cx:
        rows = cx.execute(
            "SELECT status,input_json,cost_usd FROM ai_screening_runs ORDER BY started_at"
        ).fetchall()
    assert [r["status"] for r in rows] == ["failed", "completed"]
    assert json.loads(rows[-1]["input_json"])["request"] == sent[-1]
    assert result.cost_usd == sum(r["cost_usd"] for r in rows)
    cached = screen_notice(settings, row, payload)
    assert cached.cached and cached.cost_usd == 0 and cached.usage == (0, 0)
    assert screen_notice(settings, row, "<nav>Menu</nav>").failure == "no_readable_text"
    assert screen_notice(settings, {}, payload).failure == "invalid_source"
    assert len(sent) == 2


def test_amended_and_conflicting_deadlines_stay_with_reader(ai_workspace):  # noqa: F811
    settings, _ = ai_workspace
    for detail in (
        {"summary": "截止时间：2026-10-26，更正为：2026-11-10。"},
        {"tenderDeadline": ["2026-10-26", "15 December 2026"]},
    ):
        data = {"title": "Design competition", "deadline": "2020-10-26", **detail}
        wire, _, _ = prepare_input(
            {"source_url": "https://city.example/n"}, settings, source_payload=json.dumps(data)
        )
        assert "deadline_at" not in {f["field"] for f in json.loads(wire)["mapped_facts"]}
        assert listing_deadline(json.dumps(data)) is None


def test_old_queue_and_ledger_upgrade_once_in_one_transaction(tmp_path):
    db = tmp_path / "old.sqlite"
    with sqlite3.connect(db) as cx:
        cx.executescript("""
        CREATE TABLE notice_backlog(source_id TEXT,source_url TEXT,payload TEXT,content_hash TEXT,
          status TEXT,first_seen TEXT, attempts INTEGER DEFAULT 0,last_error TEXT,criteria_hash TEXT,
          PRIMARY KEY(source_id,content_hash));
        INSERT INTO notice_backlog VALUES('s','https://example.org/1','text','h','queued','2026-10-01',2,'invalid_schema','v5');
        CREATE TABLE ai_notice_ledger(source_id TEXT,content_hash TEXT,criteria_hash TEXT,outcome TEXT,
          source_url TEXT,recorded_at TEXT);
        INSERT INTO ai_notice_ledger VALUES('s','legacy','v5','assessed','https://example.org/2','2026-10-10');
        INSERT INTO ai_notice_ledger VALUES('s','legacy','v6','assessed','https://example.org/2','2026-10-11');
        """)
    ensure_schema(db)
    with connect(db) as cx:
        assert [
            tuple(r)
            for r in cx.execute(
                "SELECT status,criteria_hash,attempts FROM items ORDER BY content_hash"
            )
        ] == [("queued", "v5", 2), ("done", "v6", 0)]
        assert not cx.execute(
            "SELECT 1 FROM sqlite_master WHERE name IN ('ai_notice_ledger','notice_backlog')"
        ).fetchall()
