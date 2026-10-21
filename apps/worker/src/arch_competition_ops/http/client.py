"""Shared HTTP client: one pooled session, retries, pacing, size cap, SSRF guard, archiving.

Thread-safety: ``requests.Session`` is shared across threads (the connection pool is safe for
GET/POST usage without per-session mutation). All per-request state lives on the stack; the only
shared mutable state is the rate limiter, which is protected by its own lock. Headers are passed
per request and never written to the session.
"""

from __future__ import annotations

import json as jsonlib
import logging
import threading
import time
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlsplit

import requests
from requests.structures import CaseInsensitiveDict

from arch_competition_ops.http.archive import archive_response
from arch_competition_ops.http.charset import decode_body
from arch_competition_ops.http.errors import (
    HttpError,
    HttpStatusError,
    HttpTransportError,
    ResponseTooLargeError,
    UnsafeUrlError,
)
from arch_competition_ops.http.guards import Resolver, default_resolver, validate_url
from arch_competition_ops.http.ratelimit import HostRateLimiter

logger = logging.getLogger(__name__)

DEFAULT_USER_AGENT = "arch-competition-ops/0.1 (+research; contact via repo)"
RETRY_STATUSES = frozenset({429, 500, 502, 503, 504})
REDIRECT_STATUSES = frozenset({301, 302, 303, 307, 308})
_CHUNK_SIZE = 64 * 1024
# ChunkedEncodingError is not a ConnectionError subclass but is a transient mid-body failure.
_TRANSIENT_REQUEST_ERRORS = (
    requests.ConnectionError,
    requests.Timeout,
    requests.exceptions.ChunkedEncodingError,
)
# Headers that must not follow a redirect to a different host (credential leak) or survive a
# method downgrade to GET (the body they describe is gone).
_CREDENTIAL_HEADERS = ("Authorization", "Cookie", "Proxy-Authorization")
_BODY_HEADERS = ("Content-Type", "Content-Length", "Content-Encoding")


@dataclass(frozen=True)
class HttpResponse:
    url: str
    status_code: int
    headers: Mapping[str, str]
    content: bytes

    @property
    def text(self) -> str:
        return decode_body(self.content, self.headers.get("Content-Type"))

    def json(self) -> Any:
        try:
            return jsonlib.loads(self.text)
        except ValueError as exc:
            raise ValueError(f"Invalid JSON from {self.url}: {exc}") from exc


def _parse_retry_after(value: str | None) -> int | None:
    # Only the delta-seconds form is honoured; HTTP-date values fall back to normal backoff.
    if value and value.strip().isdigit():
        return int(value.strip())
    return None


def _host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


class HttpClient:
    def __init__(
        self,
        *,
        session: requests.Session | None = None,
        timeout: float = 30.0,
        max_attempts: int = 3,
        backoff_base: float = 0.5,
        backoff_max: float = 8.0,
        max_bytes: int = 20 * 1024 * 1024,
        max_redirects: int = 5,
        min_interval_seconds: float = 0.0,
        host_min_intervals: Mapping[str, float] | None = None,
        allow_private_hosts: bool = False,
        resolver: Callable[[str], Sequence[str]] | None = None,
        sleep: Callable[[float], None] = time.sleep,
        monotonic: Callable[[], float] = time.monotonic,
        user_agent: str = DEFAULT_USER_AGENT,
        archive_dir: Path | None = None,
    ) -> None:
        self._owns_session = session is None
        self._session = session or requests.Session()
        self._timeout = timeout
        self._max_attempts = max(1, max_attempts)
        self._backoff_base = backoff_base
        self._backoff_max = backoff_max
        self._max_bytes = max_bytes
        self._max_redirects = max_redirects
        self._allow_private_hosts = allow_private_hosts
        self._resolver: Resolver = resolver or default_resolver
        self._sleep = sleep
        self._user_agent = user_agent
        self._archive_dir = archive_dir
        self._limiter = HostRateLimiter(
            default_interval=min_interval_seconds,
            host_intervals=host_min_intervals,
            sleep=sleep,
            monotonic=monotonic,
        )

    # -- public API -----------------------------------------------------------------------

    def get(
        self,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        headers: Mapping[str, str] | None = None,
        max_bytes: int | None = None,
        timeout: float | None = None,
        archive: bool | Path = False,
    ) -> HttpResponse:
        return self._request(
            "GET",
            url,
            params=params,
            headers=headers,
            max_bytes=max_bytes,
            timeout=timeout,
            archive=archive,
        )

    def post(
        self,
        url: str,
        *,
        data: Any = None,
        json: Any = None,
        headers: Mapping[str, str] | None = None,
        max_bytes: int | None = None,
        timeout: float | None = None,
        archive: bool | Path = False,
    ) -> HttpResponse:
        return self._request(
            "POST",
            url,
            data=data,
            json_body=json,
            headers=headers,
            max_bytes=max_bytes,
            timeout=timeout,
            archive=archive,
        )

    def get_text(self, url: str, **kwargs: Any) -> str:
        return self.get(url, **kwargs).text

    def get_json(self, url: str, **kwargs: Any) -> Any:
        # Parsed regardless of Content-Type: many APIs serve JSON as text/plain or text/html.
        return self.get(url, **kwargs).json()

    def post_text(self, url: str, **kwargs: Any) -> str:
        return self.post(url, **kwargs).text

    def post_json(self, url: str, **kwargs: Any) -> Any:
        return self.post(url, **kwargs).json()

    def close(self) -> None:
        if self._owns_session:
            self._session.close()

    def __enter__(self) -> HttpClient:
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.close()

    # -- retry loop -----------------------------------------------------------------------

    def _request(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None = None,
        data: Any = None,
        json_body: Any = None,
        headers: Mapping[str, str] | None = None,
        max_bytes: int | None = None,
        timeout: float | None = None,
        archive: bool | Path = False,
    ) -> HttpResponse:
        # POST is never retried: it may not be idempotent and a retry could duplicate the effect.
        max_attempts = self._max_attempts if method == "GET" else 1
        limit = self._max_bytes if max_bytes is None else max_bytes
        effective_timeout = self._timeout if timeout is None else timeout
        request_headers = {"User-Agent": self._user_agent, "Accept": "*/*", **(headers or {})}

        for attempt in range(1, max_attempts + 1):
            retry_after: int | None = None
            try:
                response = self._attempt(
                    method,
                    url,
                    params=params,
                    data=data,
                    json_body=json_body,
                    headers=request_headers,
                    max_bytes=limit,
                    timeout=effective_timeout,
                )
            except HttpStatusError as exc:
                exc.attempts = attempt
                if exc.status_code not in RETRY_STATUSES or attempt >= max_attempts:
                    raise
                failure: HttpError | BaseException = exc
                retry_after = exc.retry_after
            except HttpError as exc:
                exc.attempts = attempt
                raise
            except requests.RequestException as exc:
                if not isinstance(exc, _TRANSIENT_REQUEST_ERRORS) or attempt >= max_attempts:
                    raise self._transport_error(method, url, exc, attempt) from exc
                failure = exc
            except OSError as exc:
                # DNS failures from the guard's resolver (requests' own errors are handled
                # above). Retried like a connection error; bounded by max_attempts.
                if attempt >= max_attempts:
                    raise self._transport_error(method, url, exc, attempt) from exc
                failure = exc
            else:
                if archive:
                    # A Path archives into that directory; True uses the client's own archive_dir.
                    self._archive(url, response, archive if isinstance(archive, Path) else None)
                return response

            delay = self._retry_delay(attempt, retry_after)
            logger.warning(
                "HTTP %s %s attempt %d/%d failed (%s); retrying in %.2fs",
                method,
                url,
                attempt,
                max_attempts,
                failure,
                delay,
            )
            self._sleep(delay)
        raise AssertionError("unreachable: retry loop always returns or raises")  # pragma: no cover

    @staticmethod
    def _transport_error(
        method: str, url: str, exc: BaseException, attempt: int
    ) -> HttpTransportError:
        return HttpTransportError(
            f"{method} request failed: {type(exc).__name__}: {exc}", url=url, attempts=attempt
        )

    def _retry_delay(self, attempt: int, retry_after: int | None) -> float:
        if retry_after is not None:
            return float(min(self._backoff_max, retry_after))
        delay = min(self._backoff_max, self._backoff_base * 2 ** (attempt - 1))
        # Deterministic jitter (0-10%, derived from the attempt number) de-synchronises workers
        # that fail together without making tests depend on a random source.
        delay *= 1 + 0.1 * ((attempt * 7) % 5) / 4
        return min(self._backoff_max, delay)

    def _archive(self, url: str, response: HttpResponse, directory: Path | None) -> None:
        target = directory or self._archive_dir
        if target is None:
            return
        archive_response(
            target,
            url=url,
            final_url=response.url,
            status_code=response.status_code,
            content_type=response.headers.get("Content-Type"),
            content=response.content,
        )

    # -- single attempt -------------------------------------------------------------------

    def _attempt(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None,
        data: Any,
        json_body: Any,
        headers: Mapping[str, str],
        max_bytes: int,
        timeout: float,
    ) -> HttpResponse:
        raw, final_url = self._send_following_redirects(
            method,
            url,
            params=params,
            data=data,
            json_body=json_body,
            headers=headers,
            timeout=timeout,
        )
        try:
            status = raw.status_code
            if not 200 <= status < 300:
                raise HttpStatusError(
                    f"Unexpected HTTP status {status}",
                    url=final_url,
                    status_code=status,
                    retry_after=_parse_retry_after(raw.headers.get("Retry-After")),
                )
            content = self._read_body(raw, final_url, max_bytes)
            return HttpResponse(
                url=final_url,
                status_code=status,
                headers=CaseInsensitiveDict(raw.headers),
                content=content,
            )
        finally:
            raw.close()

    @staticmethod
    def _read_body(raw: requests.Response, url: str, max_bytes: int) -> bytes:
        declared = raw.headers.get("Content-Length")
        if declared and declared.strip().isdigit() and int(declared) > max_bytes:
            raise ResponseTooLargeError(
                f"Content-Length {declared} exceeds limit of {max_bytes} bytes", url=url
            )
        chunks: list[bytes] = []
        total = 0
        for chunk in raw.iter_content(chunk_size=_CHUNK_SIZE):
            total += len(chunk)
            if total > max_bytes:
                # The caller's ``finally`` closes the response, which drops the connection
                # instead of draining the rest of an oversized body.
                raise ResponseTooLargeError(
                    f"Response body exceeds limit of {max_bytes} bytes", url=url
                )
            chunks.append(chunk)
        return b"".join(chunks)

    def _send_following_redirects(
        self,
        method: str,
        url: str,
        *,
        params: Mapping[str, Any] | None,
        data: Any,
        json_body: Any,
        headers: Mapping[str, str],
        timeout: float,
    ) -> tuple[requests.Response, str]:
        """Send the request, following redirects by hand so each hop is re-validated."""
        current_url = url
        current_method = method
        send_headers = CaseInsensitiveDict(headers)
        for hop in range(self._max_redirects + 1):
            validate_url(
                current_url,
                resolver=self._resolver,
                allow_private_hosts=self._allow_private_hosts,
            )
            self._limiter.wait(_host_of(current_url))
            response = self._session.request(
                current_method,
                current_url,
                params=params if hop == 0 else None,
                data=data,
                json=json_body,
                headers=send_headers,
                timeout=timeout,
                stream=True,
                allow_redirects=False,
            )
            location = response.headers.get("Location")
            if response.status_code not in REDIRECT_STATUSES or not location:
                return response, response.url or current_url
            response.close()
            if hop >= self._max_redirects:
                raise UnsafeUrlError(
                    f"Too many redirects (limit {self._max_redirects})", url=current_url
                )
            next_url = urljoin(current_url, location)
            if _host_of(next_url) != _host_of(current_url):
                for name in _CREDENTIAL_HEADERS:
                    send_headers.pop(name, None)
            # 301/302/303 turn POST into GET and drop the body (requests' convention); 307/308
            # replay the same method and body.
            if response.status_code in (301, 302, 303) and current_method != "GET":
                current_method = "GET"
                data = None
                json_body = None
                for name in _BODY_HEADERS:
                    send_headers.pop(name, None)
            logger.debug("Following redirect %s -> %s", current_url, next_url)
            current_url = next_url
        raise AssertionError(
            "unreachable: redirect loop always returns or raises"
        )  # pragma: no cover


# Hosts with a published usage policy. Nominatim allows at most one request per second.
DEFAULT_HOST_MIN_INTERVALS = {"nominatim.openstreetmap.org": 1.1}

_default_client: HttpClient | None = None
_default_lock = threading.Lock()


def get_default_client() -> HttpClient:
    """Process-wide client, created lazily on first use."""
    global _default_client
    with _default_lock:
        if _default_client is None:
            _default_client = HttpClient(host_min_intervals=DEFAULT_HOST_MIN_INTERVALS)
        return _default_client


def set_default_client(client: HttpClient | None) -> None:
    """Install ``client`` as the process default (tests), or None to reset to lazy creation.

    The previous client is not closed: the caller that created it owns its lifecycle.
    """
    global _default_client
    with _default_lock:
        _default_client = client
