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
