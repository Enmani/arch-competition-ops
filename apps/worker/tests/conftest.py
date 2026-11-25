"""Shared test fixtures.

Every test runs with a pinned calendar day, the repository's procedure registry, a fresh schema
cache, and an HTTP client that refuses to touch the network, so no test depends on today's date
or on connectivity.
"""

from __future__ import annotations

from datetime import date
from pathlib import Path

import pytest

from arch_competition_ops import clock
from arch_competition_ops.http import HttpClient, set_default_client
from arch_competition_ops.normalizers.competition import configure_procedure_registry
from arch_competition_ops.storage import reset_schema_cache

REPO_ROOT = Path(__file__).resolve().parents[3]
# An arbitrary fixed day. Tests that need "future" or "expired" deadlines derive them from
# clock.today() instead of hard-coding calendar dates.
PINNED_TODAY = date(2026, 5, 13)


class _NetworkForbiddenSession:
    def request(self, method, url, **_kwargs):
        raise AssertionError(f"Test attempted a real network request: {method} {url}")

    def close(self) -> None:
        return None


@pytest.fixture(autouse=True)
def _isolated_runtime():
    clock.set_today_provider(lambda: PINNED_TODAY)
    configure_procedure_registry(REPO_ROOT)
    reset_schema_cache()
    client = HttpClient(session=_NetworkForbiddenSession())
    set_default_client(client)
    yield
    set_default_client(None)
    clock.set_today_provider(None)
    configure_procedure_registry(None)
    reset_schema_cache()


@pytest.fixture
def offline_assessment(monkeypatch):
    from arch_competition_ops import ingest
    from arch_competition_ops.screening.models import ScreeningDecision
    from arch_competition_ops.screening.service import AssessmentOutcome, DocumentAssessment

    def assess(settings, *, source, documents):
        outcomes = []
        for url, payload in documents:
            try:
                record = ingest.parse_source_payload(source, payload, source_url=url)
                decision = ScreeningDecision(
                    decision="needs_review",
                    relevance_score=0,
                    evidence=[],
                    extracted_fields=[],
                    missing_information=["scope"],
                    reasons_en=[],
                    reasons_zh=[],
                    summary_zh="",
                    summary_en="",
                )
                outcomes.append(
                    AssessmentOutcome(
                        assessment=DocumentAssessment(
                            record, decision, "fixture", settings.ai_model, False, 0
                        )
                    )
                )
            except ValueError as exc:
                outcomes.append(AssessmentOutcome(error=exc))
        return outcomes

    monkeypatch.setenv("ARCH_COMPETITION_OPS_AI_ENABLED", "1")
    monkeypatch.setattr(ingest, "assess_documents", assess)
