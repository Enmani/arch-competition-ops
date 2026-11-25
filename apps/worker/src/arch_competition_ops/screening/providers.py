"""The only transport boundary for a paid notice assessment."""

from threading import Lock

from openai import APIConnectionError, APIError, APIStatusError

from arch_competition_ops.screening.anthropic import (
    make_client,
    read_messages,
    strip_integer_bounds,
)
from arch_competition_ops.screening.catalog import get_model
from arch_competition_ops.screening.client import (
    ProviderResult,
    create_client,
    read_with_retries,
)
from arch_competition_ops.screening.models import ScreeningAnswer
from arch_competition_ops.settings import Settings

_sdk_decode_lock = Lock()


def provider_identity(settings: Settings) -> str:
    return "responses" if settings.ai_provider == "openai" else settings.ai_provider


def screening_model(settings, model_id):
    model = get_model(model_id)
    if model.provider != settings.ai_provider:
        raise ValueError(f"{model_id} is not configured for provider {settings.ai_provider}")
    return model


def create_screening_client(settings):
    return make_client(settings) if settings.ai_provider == "anthropic" else create_client(settings)


def read_notice(
    client, provider, request, *, sleep=None, output_type=ScreeningAnswer
) -> ProviderResult:
    """Send one notice and validate the reply against the shared decision schema."""
    if provider == "anthropic":
        return read_messages(client, request, output_type)
    return read_with_retries(
        lambda: _read_openai(client, provider, request, output_type), sleep=sleep, provider=provider
    )


def _read_openai(client, provider, request, output_type):
    try:
        raw_reply = client.responses.with_raw_response.create(**request)
        # The SDK lazily builds Pydantic response models. Simultaneous first decodes can
        # see a half-built schema. Only local decoding is serialized; HTTP stays concurrent.
        with _sdk_decode_lock:
            reply = raw_reply.parse()
    except APIStatusError as exc:
        quota = exc.code == "insufficient_quota"
        return ProviderResult(
            error_class="insufficient_quota" if quota else f"http_{exc.status_code}",
            rejected=400 <= exc.status_code < 500,
            retry_after=exc.response.headers.get("retry-after", ""),
            pause=quota or exc.status_code in {401, 402, 403, 429},
        )
    except APIConnectionError:
        return ProviderResult(error_class="transport_error")
    except APIError:
        return ProviderResult(error_class="api_error")
    result = ProviderResult(response_id=reply.id)
    if reply.usage:
        result.input_tokens = reply.usage.input_tokens
        result.output_tokens = reply.usage.output_tokens
    complete = reply.status == "completed"
    raw = reply.output_text if complete else None
    if not complete:
        result.error_class = "incomplete_response"
    else:
        result.parse_decision(raw or "", output_type)
    return result


def structured_request(provider, model, instructions, material, schema, name, max_tokens, effort):
    if provider == "anthropic":
        return {
            "model": model,
            "max_tokens": max_tokens,
            "system": instructions,
            "messages": [{"role": "user", "content": material}],
            "output_config": {
                "effort": effort,
                "format": {"type": "json_schema", "schema": strip_integer_bounds(schema)},
            },
        }
    return {
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
