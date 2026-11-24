"""Shared screening results and backoff, and the OpenAI SDK client."""

from __future__ import annotations

import math
import random
import time
from collections.abc import Callable
from dataclasses import dataclass

from openai import OpenAI
from pydantic import BaseModel, ValidationError

from arch_competition_ops.settings import Settings

# Both transports cap retries. Anthropic also retries server errors with budget held for each.
MAX_PROVIDER_RETRIES = 3
RATE_LIMIT_BASE_DELAY_SECONDS = 2.0
RATE_LIMIT_MAX_DELAY_SECONDS = 60.0


def billable_attempt_limit(provider):
    # Retried Anthropic 5xx responses have unknown cost. Rate-limit rejections are unbilled.
    return MAX_PROVIDER_RETRIES + 1 if provider == "anthropic" else 1


class ScreeningError(RuntimeError):
    """A safe error containing no request body, API key or provider error text."""

    def __init__(self, message: str, *, cost_usd: float = 0):
        super().__init__(message)
        self.cost_usd = cost_usd


class ScreeningPaused(ScreeningError):
    """No further requests can start in this batch."""


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


def retry_delay(retry_after: str, attempt: int) -> float:
    """Honour a numeric ``Retry-After`` (capped); otherwise exponential backoff with jitter."""
    try:
        advised = float(retry_after)
    except ValueError:
        advised = math.nan
    if math.isfinite(advised) and advised >= 0:
        return min(advised, RATE_LIMIT_MAX_DELAY_SECONDS)
    backoff = RATE_LIMIT_BASE_DELAY_SECONDS * 2**attempt * (0.5 + 0.5 * random.random())
    return min(backoff, RATE_LIMIT_MAX_DELAY_SECONDS)


@dataclass
class ProviderResult:
    decision: BaseModel | None = None
    error_class: str | None = None
    response_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int = 0
    retry_after: str = ""
    uncertain_retries: int = 0
    rejected: bool = False
    pause: bool = False

    def cost(self, model, per_attempt):
        used = per_attempt
        if self.rejected:
            used = 0
        elif self.input_tokens is not None and self.output_tokens is not None:
            used = model.cost(self.input_tokens, self.output_tokens, self.cache_read_tokens)
        return used + self.uncertain_retries * per_attempt

    def parse_decision(self, text: str, output_type: type[BaseModel]) -> None:
        try:
            self.decision = output_type.model_validate_json(text)
        except ValidationError:
            self.error_class = "invalid_schema"


def read_with_retries(
    send: Callable[[], ProviderResult], *, provider: str, sleep=None
) -> ProviderResult:
    retry_server_errors = billable_attempt_limit(provider) > 1
    uncertain = 0
    for attempt in range(MAX_PROVIDER_RETRIES + 1):
        result = send()
        server_retry = retry_server_errors and (result.error_class or "").startswith("http_5")
        if attempt == MAX_PROVIDER_RETRIES or not (
            result.error_class == "http_429" or server_retry
        ):
            result.uncertain_retries = uncertain
            return result
        if server_retry:
            uncertain += 1  # An earlier server failure may already have consumed tokens.
        (sleep or time.sleep)(retry_delay(result.retry_after, attempt))
    raise AssertionError("unreachable")
