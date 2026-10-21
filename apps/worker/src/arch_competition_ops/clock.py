"""Injectable calendar clock.

Everything that decides "is this deadline in the past" or "what day is it" must go through
``today()`` instead of ``date.today()`` / SQL ``date('now')``. That keeps retention windows,
cleanup, publication windows, and tests deterministic.

Resolution order for ``today()``:

1. a provider installed with ``set_today_provider`` (tests, embedding applications);
2. the ``ARCH_COMPETITION_TODAY`` environment variable (ISO ``YYYY-MM-DD``) for operators who need
   to replay a run as if it happened on another day;
3. the real local calendar date.

``now_utc()`` is intentionally *not* injectable: it stamps audit columns (``updated_at`` and
friends) with the real wall clock, which must not be replayed.
"""

from __future__ import annotations

import os
from collections.abc import Callable
from datetime import UTC, date, datetime

TODAY_ENV_VAR = "ARCH_COMPETITION_TODAY"

_today_provider: Callable[[], date] | None = None


def set_today_provider(provider: Callable[[], date] | None) -> None:
    """Install (or, with ``None``, remove) the provider that overrides every other source."""
    global _today_provider
    _today_provider = provider


def today() -> date:
    if _today_provider is not None:
        return _today_provider()

    raw_override = os.environ.get(TODAY_ENV_VAR, "").strip()
    if raw_override:
        try:
            return date.fromisoformat(raw_override)
        except ValueError as exc:
            raise ValueError(
                f"{TODAY_ENV_VAR} must be an ISO date (YYYY-MM-DD), got {raw_override!r}"
            ) from exc

    return date.today()


def now_utc() -> datetime:
    return datetime.now(UTC)
