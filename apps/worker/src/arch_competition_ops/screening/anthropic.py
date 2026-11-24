"""Strict JSON Messages transport. Source notices and keys never enter error messages."""

import re
import time

import requests

from arch_competition_ops.screening.client import RATE_LIMIT_RETRIES, ProviderResult, retry_delay


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


class AnthropicMessages(requests.Session):
    def __init__(self, settings):
        super().__init__()
        key = settings.anthropic_api_key.get_secret_value().strip()
        if not key:
            raise ValueError("Set ANTHROPIC_API_KEY before using Anthropic screening")
        self.headers.update({"x-api-key": key, "anthropic-version": "2026-10-21"})
        self.timeout = settings.ai_timeout_seconds

    def read_notice(self, request, *, sleep=None):
        uncertain = 0
        for attempt in range(RATE_LIMIT_RETRIES + 1):
            try:
                reply = self.post(
                    "https://api.anthropic.com/v1/messages",
                    json=request,
                    timeout=self.timeout,
                    allow_redirects=False,
                )
            except requests.RequestException:
                return ProviderResult(error_class="transport_error", uncertain_retries=uncertain)
            status = reply.status_code
            retryable = status == 429 or 500 <= status < 600
            if not retryable or attempt == RATE_LIMIT_RETRIES:
                break
            if status >= 500:
                uncertain += 1  # the previous attempt may already have consumed tokens
            (sleep or time.sleep)(retry_delay(reply.headers.get("retry-after", ""), attempt))

        result = ProviderResult(uncertain_retries=uncertain)
        try:
            body = reply.json()
        except ValueError:
            body = {}
        if not isinstance(body, dict):
            body = {}
        if status != 200:
            error = body.get("error")
            quota = (
                status == 400
                and isinstance(error, dict)
                and error.get("type") == "invalid_request_error"
                and re.search(
                    r"credit balance.{0,32}(?:low|insufficient|exhausted)|"
                    r"insufficient (?:credits?|balance)|out of credits?|"
                    r"billing (?:quota|limit).{0,24}(?:exceeded|reached)",
                    str(error.get("message", "")),
                    re.IGNORECASE,
                )
            )
            result.error_class = "insufficient_quota" if quota else f"http_{status}"
            result.rejected = 400 <= status < 500
            result.pause = bool(quota) or status in {401, 403, 429}
            return result

        usage = body.get("usage")
        if isinstance(usage, dict):
            counts = [
                usage.get("input_tokens"),
                usage.get("cache_read_input_tokens", 0),
                usage.get("cache_creation_input_tokens", 0),
                usage.get("output_tokens"),
            ]
            if all(type(count) is int and count >= 0 for count in counts):
                result.input_tokens = sum(counts[:3])
                result.cache_read_tokens = counts[1]
                result.output_tokens = counts[3]
        stop = body.get("stop_reason")
        if stop in ("max_tokens", "refusal"):
            result.error_class = stop
            return result
        content = body.get("content")
        block = content[0] if isinstance(content, list) and content else None
        if (
            not isinstance(block, dict)
            or block.get("type") != "text"
            or not isinstance(block.get("text"), str)
        ):
            result.error_class = "invalid_schema"
        else:
            result.parse_decision(block["text"])
        return result
