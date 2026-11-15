"""Official SDK boundary; one request, fixed OpenAI endpoint, no automatic paid retries."""

from __future__ import annotations

import math
import random
import time
from collections.abc import Callable
from typing import TypeVar

from openai import APIStatusError, OpenAI

from arch_competition_ops.settings import Settings

T = TypeVar("T")

# Rate-limit answers (HTTP 429) generate nothing and cost nothing, so they are the one outcome
# retried automatically. Every other failure keeps its single reservation and ends the request.
RATE_LIMIT_RETRIES = 3
RATE_LIMIT_BASE_DELAY_SECONDS = 2.0
RATE_LIMIT_MAX_DELAY_SECONDS = 60.0


class ScreeningError(RuntimeError):
    """A safe error containing no request body, API key or provider error text."""

    def __init__(self, message: str, *, cost_usd: float = 0):
        super().__init__(message)
        self.cost_usd = cost_usd


def create_client(settings: Settings) -> OpenAI:
    key = settings.openai_api_key.get_secret_value().strip()
    if not key:
        raise ValueError("Set OPENAI_API_KEY in the repository-root .env before using AI")
    return OpenAI(
        api_key=key,
        base_url="https://api.openai.com/v1",
        timeout=settings.ai_timeout_seconds,
        max_retries=0,
    )


def _rate_limit_delay(exc: APIStatusError, attempt: int) -> float:
    """Honour a numeric ``Retry-After`` (capped); otherwise exponential backoff with jitter."""
    try:
        advised = float(exc.response.headers.get("retry-after", ""))
    except ValueError:
        advised = math.nan
    if math.isfinite(advised) and advised >= 0:
        return min(advised, RATE_LIMIT_MAX_DELAY_SECONDS)
    backoff = RATE_LIMIT_BASE_DELAY_SECONDS * 2**attempt * (0.5 + 0.5 * random.random())
    return min(backoff, RATE_LIMIT_MAX_DELAY_SECONDS)


def call_with_rate_limit_retry(
    call: Callable[[], T], *, sleep: Callable[[float], None] | None = None
) -> T:
    """Run one provider call, retrying only HTTP 429 up to ``RATE_LIMIT_RETRIES`` times.

    The caller keeps its single cost reservation across attempts. Other 4xx, 5xx and connection
    errors propagate on the first attempt, as does a 429 that is still returned after the last
    retry. ``insufficient_quota`` is a 429 too, but waiting a minute does not refill a quota.
    """
    wait = sleep or time.sleep
    for attempt in range(RATE_LIMIT_RETRIES + 1):
        try:
            return call()
        except APIStatusError as exc:
            if (
                exc.status_code != 429
                or attempt == RATE_LIMIT_RETRIES
                or getattr(exc, "code", None) == "insufficient_quota"
            ):
                raise
            wait(_rate_limit_delay(exc, attempt))
    raise AssertionError("unreachable")  # the loop either returns or raises
