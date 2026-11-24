"""The only transport boundary for a paid notice assessment."""

from threading import Lock
from urllib.parse import urlsplit

from openai import APIConnectionError, APIError, APIStatusError, OpenAI

from arch_competition_ops.screening.anthropic import AnthropicMessages, strip_integer_bounds
from arch_competition_ops.screening.catalog import ScreeningModel, get_model
from arch_competition_ops.screening.client import (
    ProviderResult,
    call_with_rate_limit_retry,
    create_client,
)
from arch_competition_ops.screening.models import ScreeningDecision
from arch_competition_ops.settings import Settings

_sdk_decode_lock = Lock()


def provider_identity(settings: Settings) -> str:
    # Persist the protocol identity so selecting the existing service reuses prior paid reads.
    if settings.ai_provider == "openai":
        return "responses"
    if settings.ai_provider == "anthropic":
        return "anthropic"
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
    if settings.ai_provider != "openai-compatible":
        model = get_model(model_id)
        if model.provider != settings.ai_provider:
            raise ValueError(f"{model_id} is not configured for provider {settings.ai_provider}")
        return model
    input_rate, output_rate = (
        settings.ai_chat_input_usd_per_million,
        settings.ai_chat_output_usd_per_million,
    )
    if input_rate is None or output_rate is None:
        raise ValueError("Set the chat provider's input and output price per million tokens")
    return ScreeningModel(model_id, input_rate, output_rate, "Chat Completions")


def create_screening_client(settings):
    if settings.ai_provider == "anthropic":
        return AnthropicMessages(settings)
    if settings.ai_provider == "openai":
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


def read_notice(
    client, provider, request, *, sleep=None, output_type=ScreeningDecision
) -> ProviderResult:
    """Send one notice and validate the reply against the shared decision schema."""
    if provider == "anthropic":
        return client.read_notice(request, sleep=sleep, output_type=output_type)
    chat = provider == "openai-compatible"
    api = client.chat.completions if chat else client.responses
    try:
        raw_reply = call_with_rate_limit_retry(
            lambda: api.with_raw_response.create(**request), sleep=sleep
        )
        # The SDK lazily builds Pydantic response models. Simultaneous first decodes can
        # see a half-built schema. Only local decoding is serialized; HTTP stays concurrent.
        with _sdk_decode_lock:
            reply = raw_reply.parse()
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
        result.parse_decision(raw or "", output_type)
    return result


def structured_request(provider, model, instructions, material, schema, name, max_tokens, effort):
    request = {
        "model": model,
        "instructions": instructions,
        "input": material,
        "max_output_tokens": max_tokens,
        "reasoning": {"effort": effort},
        "store": False,
        "service_tier": "default",
        "text": {
            "format": {
                "type": "json_schema",
                "name": name,
                "strict": True,
                "schema": schema,
            }
        },
    }
    if provider == "anthropic":
        request = {
            "model": request["model"],
            "max_tokens": max_tokens,
            "system": request["instructions"],
            "messages": [{"role": "user", "content": request["input"]}],
            "output_config": {
                "effort": effort,
                "format": {"type": "json_schema", "schema": strip_integer_bounds(schema)},
            },
        }
    elif provider == "openai-compatible":
        fmt = request["text"]["format"]
        request = {
            "model": request["model"],
            "messages": [
                {"role": "system", "content": request["instructions"]},
                {"role": "user", "content": request["input"]},
            ],
            "reasoning_effort": effort,
            "max_tokens": max_tokens,
            "response_format": {
                "type": "json_schema",
                "json_schema": {k: v for k, v in fmt.items() if k != "type"},
            },
        }
    return request
