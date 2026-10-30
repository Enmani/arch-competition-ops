"""Official SDK boundary; one request, fixed OpenAI endpoint, no automatic paid retries."""

from __future__ import annotations

from openai import OpenAI

from arch_competition_ops.settings import Settings


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
