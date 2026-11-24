"""Concurrent detailed assessments, shared budget safety and bounded 429 retry (offline)."""

from __future__ import annotations

import json
import threading
from types import SimpleNamespace

import httpx
import pytest
import yaml
from test_ai_screening import (
    NOTICE,
    ai_workspace,  # noqa: F401  (a fixture, requested through ``workspace`` below)
    decision_payload,
    mock_client,
    response,
)

from arch_competition_ops.collectors.base import CollectedSourceDocument
from arch_competition_ops.ingest import ingest_source
from arch_competition_ops.screening import service
from arch_competition_ops.screening.catalog import get_model
from arch_competition_ops.screening.client import ScreeningError, call_with_rate_limit_retry
from arch_competition_ops.screening.service import assess_document, assess_documents
from arch_competition_ops.settings import Settings
from arch_competition_ops.storage import ensure_schema
from arch_competition_ops.storage.connection import connect
from arch_competition_ops.storage.screening import ScreeningBudgetExceeded, reserve_screening

WAIT_SECONDS = 10  # only a failure timeout; a passing run never waits on it


def notice(number: int) -> str:
    return NOTICE + f"\n<p>Reference number {number}.</p>"


def url(number: int) -> str:
    return f"https://city.example/n/{number}"


def listing(count: int) -> list[CollectedSourceDocument]:
    return [CollectedSourceDocument(url(i), notice(i)) for i in range(count)]


def reference_in(request: httpx.Request) -> int:
    text = json.loads(json.loads(request.content)["input"])["evidence_fields"]["notice_text"]
    return int(text.split("Reference number ")[1].split(".")[0])


class InFlight:
    """Counts requests inside the mock handler at once (a failure shows as a count above limit)."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.now = 0
        self.peak = 0
        self.total = 0

    def enter(self) -> None:
        with self.lock:
            self.now += 1
            self.total += 1
            self.peak = max(self.peak, self.now)

    def leave(self) -> None:
        with self.lock:
            self.now -= 1


@pytest.fixture
def workspace(ai_workspace):  # noqa: F811
    # Importing a fixture by name and taking it as a parameter would trip F811; this indirection
    # keeps the shared fixture (settings plus a generic-notice source) in one place.
    return ai_workspace


@pytest.fixture
def ingest_workspace(workspace, monkeypatch):
    settings, source = workspace
    settings.ai_enabled = True
    (settings.root / "config" / "sources.yml").write_text(
        yaml.safe_dump({"sources": [source.model_dump()]}), encoding="utf-8"
    )
    monkeypatch.setattr("arch_competition_ops.ingest.enrich_record_geocode", lambda r, **_kw: r)
    # The title pass is its own paid stage with its own client; it is not under test here.
    monkeypatch.setattr(
        "arch_competition_ops.ingest.polish_titles", lambda *_a, **_kw: SimpleNamespace(errors=[])
    )
    return settings, source


def serve(monkeypatch, handler) -> None:
    # Each worker opens (and closes) its own client, exactly as create_client does in production.
    monkeypatch.setattr(service, "create_client", lambda _settings: mock_client(handler))


def collect(monkeypatch, documents) -> None:
    monkeypatch.setattr(
        "arch_competition_ops.ingest.collect_source_documents",
        lambda *_a, **_kw: list(documents),
    )


def ledger_rows(settings: Settings) -> int:
    with connect(settings.resolve_path(settings.db)) as connection:
        return connection.execute("SELECT COUNT(*) FROM ai_notice_ledger").fetchone()[0]


# -- concurrency ---------------------------------------------------------------------------------


def test_outcomes_keep_input_order_even_when_requests_finish_in_reverse(
    workspace,
    monkeypatch,
):
    settings, source = workspace
    settings.ai_concurrency = 4
    count = 4
    last_started = threading.Event()
    seen = []

    def handler(request):
        number = reference_in(request)
        if number == count - 1:
            last_started.set()
        else:
            # Every earlier notice finishes after the last one did.
            assert last_started.wait(WAIT_SECONDS)
        seen.append(number)
        return response(decision_payload())

    serve(monkeypatch, handler)
    outcomes = assess_documents(
        settings, source=source, documents=[(url(i), notice(i)) for i in range(count)]
    )

    assert seen[0] == count - 1  # the last notice really did finish first
    assert [o.error for o in outcomes] == [None] * count
    assert [o.assessment.record.source_url for o in outcomes] == [url(i) for i in range(count)]


def test_in_flight_requests_never_exceed_the_limit_and_do_exceed_one_when_allowed(
    workspace,
    monkeypatch,
):
    settings, source = workspace
    settings.ai_concurrency = 4
    flight = InFlight()
    gate = threading.Barrier(4, timeout=WAIT_SECONDS)  # four requests must be open together

    def handler(_request):
        flight.enter()
        try:
            gate.wait()
            return response(decision_payload())
        finally:
            flight.leave()

    serve(monkeypatch, handler)
    outcomes = assess_documents(
        settings, source=source, documents=[(url(i), notice(i)) for i in range(8)]
    )

    assert all(o.error is None for o in outcomes)
    assert flight.total == 8
    assert flight.peak == 4


def test_default_concurrency_is_serial(workspace, monkeypatch):
    settings, source = workspace
    assert settings.ai_concurrency == 1
    flight = InFlight()

    def handler(_request):
        flight.enter()
        try:
            return response(decision_payload())
        finally:
            flight.leave()

    serve(monkeypatch, handler)
    outcomes = assess_documents(
        settings, source=source, documents=[(url(i), notice(i)) for i in range(4)]
    )

    assert all(o.error is None for o in outcomes)
    assert (flight.total, flight.peak) == (4, 1)


def test_concurrency_setting_is_bounded():
    with pytest.raises(ValueError):
        Settings(_env_file=None, ai_concurrency=0)
    with pytest.raises(ValueError):
        Settings(_env_file=None, ai_concurrency=17)
    assert Settings(_env_file=None, ai_concurrency=8).ai_concurrency == 8


def test_one_failing_notice_does_not_sink_the_others_or_enter_the_ledger(
    ingest_workspace, monkeypatch
):
    settings, _source = ingest_workspace
    settings.ai_concurrency = 4

    def handler(request):
        if reference_in(request) == 2:
            return httpx.Response(400, json={"error": {"message": "boom"}})
        return response(decision_payload())

    serve(monkeypatch, handler)
    collect(monkeypatch, listing(6))
    result = ingest_source(settings, source_id="city")

    assert [f.source_url for f in result.failures] == [url(2)]
    assert result.failures[0].stage == "ai_extract_and_screen"
    assert len(result.ingested_ids) == 5
    assert result.deferred == 0
    assert ledger_rows(settings) == 5  # the failed notice is retried on the next run


def test_budget_exhaustion_stops_the_pass_defers_and_leaves_paid_results_cached(
    ingest_workspace, monkeypatch
):
    settings, _source = ingest_workspace
    settings.ai_concurrency = 4
    model = get_model(settings.ai_model)
    paid = model.cost(2000, 1000)  # what response() reports as usage
    # A probe request of the same input size shows the reservation the ingest will ask for. Its
    # URL differs from every listed notice, so it does not serve them from the cache.
    with mock_client(lambda _r: response(decision_payload())) as probe_client:
        assess_document(
            settings,
            source=_source,
            source_url="https://city.example/x/5",
            payload=notice(5),
            client=probe_client,
        )
    with connect(settings.resolve_path(settings.db)) as connection:
        probe_input = connection.execute("SELECT input_json FROM ai_screening_runs").fetchone()[0]
    reserve = model.cost(len(probe_input.encode()) + 4096, settings.ai_max_output_tokens)
    # Room for exactly one more reservation: it fits (probe + reserve), a second never does,
    # neither beside the first in flight (2 * reserve) nor after it finished (2 * paid + reserve).
    settings.ai_daily_budget_usd = reserve + paid * 1.5
    flight = InFlight()

    def handler(_request):
        flight.enter()
        try:
            return response(decision_payload())
        finally:
            flight.leave()

    serve(monkeypatch, handler)
    collect(monkeypatch, listing(6))
    first = ingest_source(settings, source_id="city")

    assert flight.total == 1  # the first reservation was paid, every later one refused
    assert not first.failures
    assert any("budget" in note for note in first.notes)
    # Deferred notices are not failures and not "already screened"; a finished one that comes
    # after the stop point in input order is left for the next run, not half-consumed.
    assert first.deferred == 6 - len(first.ingested_ids)
    assert ledger_rows(settings) == len(first.ingested_ids)

    # Next run with room in the budget: the one paid result is reused instead of paid twice.
    settings.ai_daily_budget_usd = 1000
    second = ingest_source(settings, source_id="city")
    assert flight.total == 6  # five new requests; the one paid earlier came from the cache
    assert not second.failures and second.deferred == 0
    assert ledger_rows(settings) == 6


def test_concurrent_reservations_cannot_overshoot_the_budget(workspace):
    settings, _source = workspace
    db = settings.resolve_path(settings.db)
    ensure_schema(db)
    threads = 16
    start = threading.Barrier(threads, timeout=WAIT_SECONDS)
    granted = []
    refused = []

    def reserve(index: int) -> None:
        start.wait()
        try:
            reserve_screening(
                db,
                competition_id=None,
                source_url=f"https://city.example/{index}",
                model="gpt-6-luna",
                input_json="{}",
                reserve_usd=1.0,
                budget_usd=31,
                daily_budget_usd=5.5,
            )
            granted.append(index)
        except ScreeningBudgetExceeded:
            refused.append(index)

    workers = [threading.Thread(target=reserve, args=(i,)) for i in range(threads)]
    for worker in workers:
        worker.start()
    for worker in workers:
        worker.join(WAIT_SECONDS)

    assert (len(granted), len(refused)) == (5, 11)
    with connect(db) as connection:
        total = connection.execute("SELECT SUM(cost_usd) FROM ai_screening_runs").fetchone()[0]
    assert total == 5.0


# -- HTTP 429 retry ------------------------------------------------------------------------------


def rate_limited(headers=None, code="rate_limit_exceeded"):
    return httpx.Response(
        429,
        headers=headers or {},
        json={"error": {"message": "slow down", "type": "requests", "code": code}},
    )


def run_assessment(settings, source, handler, sleeps):
    with mock_client(handler) as client:
        return assess_document(
            settings,
            source=source,
            source_url=url(1),
            payload=notice(1),
            client=client,
            sleep=sleeps.append,
        )


def test_429_is_retried_with_backoff_under_one_reservation(workspace):
    settings, source = workspace
    answers = [rate_limited(), rate_limited(), response(decision_payload())]
    sleeps = []

    assessment = run_assessment(settings, source, lambda _r: answers.pop(0), sleeps)

    assert assessment.decision.decision == "needs_review"
    assert answers == []
    assert len(sleeps) == 2
    assert 1.0 <= sleeps[0] <= 2.0 and 2.0 <= sleeps[1] <= 4.0  # 2s * 2**n, jittered 50-100%
    with connect(settings.resolve_path(settings.db)) as connection:
        rows = connection.execute("SELECT status, cost_usd FROM ai_screening_runs").fetchall()
    assert [(row["status"], row["cost_usd"] > 0) for row in rows] == [("completed", True)]


@pytest.mark.parametrize(("header", "expected"), [("7", 7.0), ("500", 60.0), ("0", 0.0)])
def test_retry_after_is_honoured_and_capped_at_sixty_seconds(workspace, header, expected):
    settings, source = workspace
    answers = [rate_limited({"retry-after": header}), response(decision_payload())]
    sleeps = []

    run_assessment(settings, source, lambda _r: answers.pop(0), sleeps)

    assert sleeps == [expected]


def test_a_429_that_never_clears_ends_as_a_failed_free_run_after_three_retries(
    workspace,
):
    settings, source = workspace
    calls = []
    sleeps = []

    def handler(request):
        calls.append(request)
        return rate_limited()

    with pytest.raises(ScreeningError, match="http_429"):
        run_assessment(settings, source, handler, sleeps)

    assert len(calls) == 4 and len(sleeps) == 3
    with connect(settings.resolve_path(settings.db)) as connection:
        rows = connection.execute(
            "SELECT status, error_code, cost_usd FROM ai_screening_runs"
        ).fetchall()
    assert [tuple(row) for row in rows] == [("failed", "http_429", 0)]


@pytest.mark.parametrize(
    "answer",
    [
        httpx.Response(400, json={"error": {"message": "bad", "type": "invalid_request_error"}}),
        httpx.Response(500, json={"error": {"message": "down"}}),
        httpx.Response(503, json={"error": {"message": "down"}}),
        rate_limited(code="insufficient_quota"),
    ],
    ids=["400", "500", "503", "429-insufficient-quota"],
)
def test_only_ordinary_rate_limits_are_retried(workspace, answer):
    settings, source = workspace
    calls = []
    sleeps = []

    def handler(request):
        calls.append(request)
        return answer

    with pytest.raises(ScreeningError):
        run_assessment(settings, source, handler, sleeps)

    assert len(calls) == 1 and sleeps == []


def test_5xx_keeps_its_cost_reservation_as_before(workspace):
    settings, source = workspace

    with pytest.raises(ScreeningError):
        run_assessment(
            settings, source, lambda _r: httpx.Response(500, json={"error": {"message": "x"}}), []
        )

    with connect(settings.resolve_path(settings.db)) as connection:
        row = connection.execute("SELECT status, cost_usd FROM ai_screening_runs").fetchone()
    assert row["status"] == "uncertain" and row["cost_usd"] > 0


def test_retry_helper_returns_the_first_success_and_does_not_sleep_without_a_429():
    sleeps = []
    assert call_with_rate_limit_retry(lambda: "ok", sleep=sleeps.append) == "ok"
    assert sleeps == []
