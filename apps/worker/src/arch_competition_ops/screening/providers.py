"""The only transport boundary for a paid notice assessment."""

from dataclasses import dataclass
from urllib.parse import urlsplit

from openai import APIConnectionError, APIError, APIStatusError, OpenAI
from pydantic import ValidationError

from arch_competition_ops.screening.catalog import ScreeningModel, get_model
from arch_competition_ops.screening.client import call_with_rate_limit_retry, create_client
from arch_competition_ops.screening.models import ScreeningDecision
from arch_competition_ops.settings import Settings


def provider_identity(settings: Settings) -> str:
    if settings.ai_provider == "responses":
        return "responses"
    url = settings.ai_chat_base_url.rstrip("/")
    parts = urlsplit(url)
    if (
        parts.scheme not in {"http", "https"}
        or not parts.hostname
        or parts.username
        or parts.password
        or parts.query
        or parts.fragment
    ):
        raise ValueError("Configure AI_CHAT_BASE_URL with a credential-free service endpoint")
    return "chat_completions:" + url


def screening_model(settings, model_id):
    if settings.ai_provider == "responses":
        return get_model(model_id)
    input_rate, output_rate = (
        settings.ai_chat_input_usd_per_million,
        settings.ai_chat_output_usd_per_million,
    )
    if input_rate is None or output_rate is None:
        raise ValueError("Set the chat provider's input and output price per million tokens")
    return ScreeningModel(model_id, input_rate, output_rate, "Chat Completions")


def create_screening_client(settings):
    if settings.ai_provider == "responses":
        return create_client(settings)
    provider_identity(settings)
    key = settings.ai_chat_api_key.get_secret_value().strip()
    if not key:
        raise ValueError("Set AI_CHAT_API_KEY for the configured chat service")
    return OpenAI(
        api_key=key,
        base_url=settings.ai_chat_base_url,
        timeout=settings.ai_timeout_seconds,
        max_retries=0,
    )


@dataclass
class ProviderResult:
    decision: ScreeningDecision | None = None
    error_class: str | None = None
    response_id: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    rejected: bool = False
    pause: bool = False


def read_notice(client, provider, request, *, sleep=None) -> ProviderResult:
    """Send the final single-notice request. Both protocols validate the same response schema."""
    chat = provider == "chat_completions"
    call = client.chat.completions.create if chat else client.responses.create
    try:
        reply = call_with_rate_limit_retry(lambda: call(**request), sleep=sleep)
    except APIStatusError as exc:
        quota = exc.code == "insufficient_quota"
        return ProviderResult(
            error_class="insufficient_quota" if quota else f"http_{exc.status_code}",
            rejected=400 <= exc.status_code < 500,
            pause=quota or exc.status_code in {401, 402, 403, 429},
        )
    except APIConnectionError:
        return ProviderResult(error_class="transport_error")
    except APIError:
        return ProviderResult(error_class="api_error")
    result = ProviderResult(response_id=reply.id)
    if reply.usage:
        result.input_tokens = reply.usage.prompt_tokens if chat else reply.usage.input_tokens
        result.output_tokens = reply.usage.completion_tokens if chat else reply.usage.output_tokens
    if chat:
        choice = reply.choices[0] if reply.choices else None
        complete = choice and choice.finish_reason == "stop"
        raw = choice.message.content if complete else None
    else:
        complete = reply.status == "completed"
        raw = reply.output_text if complete else None
    if not complete:
        result.error_class = "incomplete_response"
    else:
        try:
            result.decision = ScreeningDecision.model_validate_json(raw or "")
        except ValidationError:
            result.error_class = "invalid_schema"
    return result
