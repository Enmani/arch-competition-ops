"""Shared, safe HTTP access for collectors, verifiers and geocoding."""

from __future__ import annotations

from arch_competition_ops.http.client import (
    DEFAULT_USER_AGENT,
    HttpClient,
    HttpResponse,
    get_default_client,
    set_default_client,
)
from arch_competition_ops.http.errors import (
    HttpError,
    HttpStatusError,
    HttpTransportError,
    ResponseTooLargeError,
    UnsafeUrlError,
)

__all__ = [
    "DEFAULT_USER_AGENT",
    "HttpClient",
    "HttpError",
    "HttpResponse",
    "HttpStatusError",
    "HttpTransportError",
    "ResponseTooLargeError",
    "UnsafeUrlError",
    "get_default_client",
    "set_default_client",
]
