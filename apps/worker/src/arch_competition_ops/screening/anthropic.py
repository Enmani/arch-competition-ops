"""Anthropic's SDK owns transport, response decoding and bounded retries."""

from contextvars import ContextVar

from anthropic import (
    Anthropic,
    APIConnectionError,
    APIStatusError,
    APITimeoutError,
    DefaultHttpxClient,
)

from arch_competition_ops.screening.client import MAX_PROVIDER_RETRIES, ProviderResult

# Track unacknowledged attempts across SDK retries, independently for each concurrent call.
_pending = ContextVar("unacknowledged", default=0)


def make_client(settings):
    key = settings.anthropic_api_key.get_secret_value().strip()
    if not key:
        raise ValueError("Set ANTHROPIC_API_KEY before using Anthropic screening")
    hooks = {
        "request": [lambda _: _pending.set(_pending.get() + 1)],
        "response": [lambda r: _pending.set(_pending.get() - int(r.status_code < 500))],
    }
    return Anthropic(
        api_key=key,
        base_url="https://api.anthropic.com",
        default_headers={"anthropic-version": "2026-10-21"},
        timeout=settings.ai_timeout_seconds,
        max_retries=MAX_PROVIDER_RETRIES,
        http_client=DefaultHttpxClient(event_hooks=hooks, follow_redirects=False),
    )


def strip_integer_bounds(schema):
    if isinstance(schema, list):
        return [strip_integer_bounds(value) for value in schema]
    if isinstance(schema, dict):
        return {
            key: strip_integer_bounds(value)
            for key, value in schema.items()
            if not (schema.get("type") == "integer" and key in {"minimum", "maximum"})
        }
    return schema


def read_messages(client, request, output_type):
    _pending.set(0)
    result = ProviderResult()
    try:
        message = client.messages.create(**request)
    except APIStatusError as exc:
        status = exc.status_code
        error = exc.body.get("error", exc.body) if isinstance(exc.body, dict) else {}
        kind = error.get("type") if isinstance(error, dict) else None
        quota = status == 402 or (
            status == 400 and bool({"billing", "credit", "credits"} & set(str(kind).split("_")))
        )
        result.error_class = "insufficient_quota" if quota else f"http_{status}"
        result.pause = quota or status in {401, 403, 429}
        result.rejected = status < 500
    except APITimeoutError:
        # A notice that outruns the timeout is that notice's problem, not an outage.
        result.error_class = "timeout"
    except APIConnectionError:
        result.error_class = "transport_error"
    else:
        result.response_id = message.id
        usage = message.usage
        if usage and usage.input_tokens is not None and usage.output_tokens is not None:
            result.cache_read_tokens = usage.cache_read_input_tokens or 0
            creation_total = usage.cache_creation_input_tokens or 0
            creation_detail = getattr(usage, "cache_creation", None)
            ephemeral_1h = getattr(creation_detail, "ephemeral_1h_input_tokens", None) or 0
            ephemeral_5m = getattr(creation_detail, "ephemeral_5m_input_tokens", None)
            if ephemeral_5m is not None:
                result.cache_creation_tokens = ephemeral_5m
                result.cache_creation_1h_tokens = ephemeral_1h
            else:
                result.cache_creation_1h_tokens = ephemeral_1h
                result.cache_creation_tokens = max(0, creation_total - ephemeral_1h)
            result.input_tokens = usage.input_tokens + result.cache_read_tokens + creation_total
            result.output_tokens = usage.output_tokens
        block = next((b for b in (message.content or []) if b.type == "text"), None)
        if message.stop_reason in {"max_tokens", "refusal"}:
            result.error_class = message.stop_reason
        elif block is None:
            result.error_class = "missing_text"
        else:
            result.parse_decision(block.text, output_type)
    ambiguous_final = result.error_class in {"transport_error", "timeout"} or (
        result.error_class or ""
    ).startswith("http_5")
    result.uncertain_retries = max(0, _pending.get() - int(ambiguous_final))
    return result
