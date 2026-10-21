"""Exception hierarchy for the shared HTTP client.

Every error keeps the URL, the number of attempts made and (when known) the HTTP status, so a
log line or a stored failure record is diagnosable without re-running the request.
"""

from __future__ import annotations


class HttpError(Exception):
    """Base class for all errors raised by ``arch_competition_ops.http``."""

    def __init__(
        self,
        message: str,
        *,
        url: str,
        attempts: int = 1,
        status_code: int | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.url = url
        # ``attempts`` is mutable on purpose: the retry loop fills in the real count once it
        # knows how many tries were spent before the error surfaced.
        self.attempts = attempts
        self.status_code = status_code

    def __str__(self) -> str:
        status = f" status={self.status_code}" if self.status_code is not None else ""
        return f"{self.message} [url={self.url}{status} attempts={self.attempts}]"


class UnsafeUrlError(HttpError):
    """Scheme not http/https, non-public destination address, or redirect out of bounds.

    Redirect chains longer than ``max_redirects`` are reported with this class too (rather than
    a transport error) because it is a policy violation that must never be retried.
    """


class ResponseTooLargeError(HttpError):
    """The response body exceeds the configured ``max_bytes``."""


class HttpStatusError(HttpError):
    """Non-2xx response, after retries were exhausted or for a non-retryable status."""

    def __init__(
        self,
        message: str,
        *,
        url: str,
        status_code: int,
        attempts: int = 1,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(message, url=url, attempts=attempts, status_code=status_code)
        # Parsed ``Retry-After`` seconds from the failing response; consumed by the retry loop.
        self.retry_after = retry_after


class HttpTransportError(HttpError):
    """Connection, timeout or read failure. ``__cause__`` holds the original exception."""
