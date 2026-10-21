"""Offline tests for the shared HTTP client: success, retries, size cap, pacing, lifecycle.

Fakes live in ``http_fakes`` (scripted adapter, fake clock, injected resolver).
"""

from __future__ import annotations

import io
import json
import logging
import threading
from collections.abc import Sequence
from pathlib import Path

import pytest
import requests
from http_fakes import URL, Reply, TrackedBody, make_client, public_resolver

from arch_competition_ops.http import (
    HttpClient,
    HttpError,
    HttpStatusError,
    HttpTransportError,
    ResponseTooLargeError,
    UnsafeUrlError,
    get_default_client,
    set_default_client,
)

# -- success, headers, timeout ---------------------------------------------------------------


def test_get_success_sends_honest_user_agent_and_timeout() -> None:
    client, adapter, _ = make_client(
        [Reply(200, b"hello", {"Content-Type": "text/plain; charset=utf-8"})], timeout=12.5
    )

    response = client.get(URL, params={"q": "a b"}, headers={"X-Test": "1"})

    assert response.status_code == 200
    assert response.content == b"hello"
    assert response.text == "hello"
    assert response.headers["content-type"] == "text/plain; charset=utf-8"
    request = adapter.requests[0]
    assert request.url == "https://example.org/page?q=a+b"
    assert request.headers["User-Agent"].startswith("arch-competition-ops/")
    assert "Mozilla" not in request.headers["User-Agent"]
    assert request.headers["Accept"] == "*/*"
    assert request.headers["X-Test"] == "1"
    assert adapter.kwargs[0] == {"stream": True, "timeout": 12.5}


def test_caller_headers_override_defaults_and_per_call_timeout() -> None:
    client, adapter, _ = make_client([Reply(200, b"x")])

    client.get(URL, headers={"User-Agent": "custom/1", "Accept": "text/html"}, timeout=3)

    assert adapter.requests[0].headers["User-Agent"] == "custom/1"
    assert adapter.requests[0].headers["Accept"] == "text/html"
    assert adapter.kwargs[0]["timeout"] == 3


def test_does_not_mutate_shared_session_headers() -> None:
    client, adapter, _ = make_client([Reply(200, b"x")])
    session_headers_before = dict(client._session.headers)

    client.get(URL, headers={"X-Once": "1"})

    assert dict(client._session.headers) == session_headers_before


def test_get_json_accepts_bom_and_non_json_content_type() -> None:
    body = b"\xef\xbb\xbf" + json.dumps({"name": "建筑"}, ensure_ascii=False).encode()
    client, _, _ = make_client([Reply(200, body, {"Content-Type": "text/html"})])

    assert client.get_json(URL) == {"name": "建筑"}


def test_json_error_mentions_url() -> None:
    client, _, _ = make_client([Reply(200, b"<html>not json</html>")])

    with pytest.raises(ValueError, match=r"example\.org/page"):
        client.get_json(URL)


def test_get_text_and_post_helpers() -> None:
    client, adapter, _ = make_client(
        [Reply(200, b"t"), Reply(200, b"post-text"), Reply(200, b'{"ok": true}')]
    )

    assert client.get_text(URL) == "t"
    assert client.post_text(URL, data={"a": "1"}) == "post-text"
    assert client.post_json(URL, json={"a": 1}) == {"ok": True}
    assert adapter.requests[2].body == b'{"a": 1}'


# -- retry behaviour -------------------------------------------------------------------------


def test_retries_503_then_succeeds_with_exponential_backoff() -> None:
    client, adapter, clock = make_client(
        [Reply(503), Reply(502), Reply(200, b"ok")], backoff_base=1.0, backoff_max=8.0
    )

    assert client.get(URL).content == b"ok"

    assert len(adapter.requests) == 3
    assert len(clock.sleeps) == 2
    # Backoff is base * 2**(attempt-1) plus at most 10% deterministic jitter.
    assert 1.0 <= clock.sleeps[0] <= 1.1
    assert 2.0 <= clock.sleeps[1] <= 2.2


def test_retry_delay_never_exceeds_backoff_max() -> None:
    client, _, clock = make_client(
        [Reply(503)] * 5, max_attempts=5, backoff_base=4.0, backoff_max=5.0
    )

    with pytest.raises(HttpStatusError):
        client.get(URL)

    assert clock.sleeps and max(clock.sleeps) <= 5.0


def test_429_honours_retry_after_capped_at_backoff_max() -> None:
    client, _, clock = make_client(
        [
            Reply(429, headers={"Retry-After": "2"}),
            Reply(429, headers={"Retry-After": "999"}),
            Reply(200, b"ok"),
        ],
        backoff_base=0.5,
        backoff_max=8.0,
    )

    assert client.get(URL).content == b"ok"

    assert clock.sleeps == [2.0, 8.0]


def test_http_date_retry_after_falls_back_to_backoff() -> None:
    client, _, clock = make_client(
        [Reply(503, headers={"Retry-After": "Wed, 21 Oct 2026 07:28:00 GMT"}), Reply(200, b"ok")],
        backoff_base=1.0,
    )

    client.get(URL)

    assert 1.0 <= clock.sleeps[0] <= 1.1


def test_retry_exhaustion_raises_status_error_with_attempts(
    caplog: pytest.LogCaptureFixture,
) -> None:
    client, adapter, clock = make_client([Reply(503)] * 3, max_attempts=3)

    with caplog.at_level(logging.WARNING, logger="arch_competition_ops.http.client"):
        with pytest.raises(HttpStatusError) as info:
            client.get(URL)

    error = info.value
    assert error.status_code == 503
    assert error.attempts == 3
    assert error.url == URL
    assert URL in str(error) and "attempts=3" in str(error)
    assert len(adapter.requests) == 3
    assert len(clock.sleeps) == 2  # no sleep after the final attempt
    assert sum(URL in record.getMessage() for record in caplog.records) == 2


def test_404_is_not_retried() -> None:
    client, adapter, clock = make_client([Reply(404, b"nope"), Reply(200, b"later")])

    with pytest.raises(HttpStatusError) as info:
        client.get(URL)

    assert info.value.status_code == 404
    assert info.value.attempts == 1
    assert len(adapter.requests) == 1
    assert clock.sleeps == []


def test_post_is_never_retried_on_status() -> None:
    client, adapter, clock = make_client([Reply(503), Reply(200, b"ok")])

    with pytest.raises(HttpStatusError) as info:
        client.post(URL, data={"a": "1"})

    assert info.value.attempts == 1
    assert len(adapter.requests) == 1
    assert clock.sleeps == []


def test_post_is_never_retried_on_connection_error() -> None:
    client, adapter, _ = make_client([requests.ConnectionError("boom"), Reply(200)])

    with pytest.raises(HttpTransportError) as info:
        client.post(URL, json={"a": 1})

    assert info.value.attempts == 1
    assert len(adapter.requests) == 1


def test_connection_error_is_retried_then_succeeds() -> None:
    client, adapter, clock = make_client(
        [requests.ConnectionError("reset"), requests.Timeout("slow"), Reply(200, b"ok")]
    )

    assert client.get(URL).content == b"ok"

    assert len(adapter.requests) == 3
    assert len(clock.sleeps) == 2


def test_transport_error_after_exhaustion_keeps_cause() -> None:
    original = requests.ConnectionError("reset by peer")
    client, adapter, _ = make_client([original] * 2, max_attempts=2)

    with pytest.raises(HttpTransportError) as info:
        client.get(URL)

    assert info.value.attempts == 2
    assert info.value.url == URL
    assert info.value.__cause__ is original
    assert len(adapter.requests) == 2


def test_chunked_encoding_error_while_reading_body_is_retried() -> None:
    class BrokenBody(io.BytesIO):
        def read(self, size: int = -1) -> bytes:
            raise requests.exceptions.ChunkedEncodingError("cut short")

    client, adapter, _ = make_client([Reply(200, raw=BrokenBody(b"x")), Reply(200, b"complete")])

    assert client.get(URL).content == b"complete"
    assert len(adapter.requests) == 2


def test_dns_failure_from_resolver_is_transport_error() -> None:
    def failing_resolver(host: str) -> Sequence[str]:
        raise OSError("name resolution failed")

    client, adapter, _ = make_client([], resolver=failing_resolver, max_attempts=2)

    with pytest.raises(HttpTransportError) as info:
        client.get(URL)

    assert info.value.attempts == 2
    assert adapter.requests == []


# -- response size ---------------------------------------------------------------------------


def test_content_length_over_limit_is_rejected_before_reading() -> None:
    body = TrackedBody(b"x" * 10)
    client, _, _ = make_client([Reply(200, headers={"Content-Length": "5000"}, raw=body)])

    with pytest.raises(ResponseTooLargeError) as info:
        client.get(URL, max_bytes=1000)

    assert info.value.url == URL
    assert body.bytes_read == 0
    assert body.closed


def test_streaming_body_over_limit_aborts_and_closes_connection() -> None:
    body = TrackedBody(b"y" * 300_000)
    client, adapter, _ = make_client([Reply(200, raw=body), Reply(200, b"unused")])

    with pytest.raises(ResponseTooLargeError):
        client.get(URL, max_bytes=100_000)

    assert body.closed
    assert body.bytes_read < 300_000
    assert len(adapter.requests) == 1  # oversize is not retried


def test_body_exactly_at_limit_is_accepted() -> None:
    client, _, _ = make_client([Reply(200, b"z" * 100)])

    assert len(client.get(URL, max_bytes=100).content) == 100


# -- per-host rate limiting ------------------------------------------------------------------


def test_default_interval_spaces_requests_to_same_host() -> None:
    client, _, clock = make_client([Reply(200)] * 3, min_interval_seconds=2.0)

    client.get("https://a.example/1")
    client.get("https://a.example/2")
    clock.now += 0.5  # caller work between requests counts towards the interval
    client.get("https://a.example/3")

    assert clock.sleeps == [2.0, 1.5]


def test_host_specific_interval_overrides_default_and_hosts_are_independent() -> None:
    client, _, clock = make_client(
        [Reply(200)] * 4,
        min_interval_seconds=1.0,
        host_min_intervals={"Slow.Example": 5.0},
    )

    client.get("https://slow.example/1")
    client.get("https://slow.example/2")
    client.get("https://fast.example/1")  # other host: no wait
    client.get("https://fast.example/2")

    assert clock.sleeps == [5.0, 1.0]


def test_no_wait_when_interval_is_zero() -> None:
    client, _, clock = make_client([Reply(200)] * 2)

    client.get(URL)
    client.get(URL)

    assert clock.sleeps == []


def test_retry_attempts_also_respect_host_interval() -> None:
    client, _, clock = make_client(
        [Reply(503), Reply(200)], min_interval_seconds=10.0, backoff_base=1.0
    )

    client.get(URL)

    # Backoff (~1s) elapsed first, so the limiter only tops up the remainder of 10s.
    assert 1.0 <= clock.sleeps[0] <= 1.1
    assert clock.sleeps[1] == pytest.approx(10.0 - clock.sleeps[0])


# -- archiving through the client ------------------------------------------------------------


def test_archive_flag_writes_evidence_only_when_requested(tmp_path: Path) -> None:
    client, _, _ = make_client(
        [Reply(200, b"<html>x</html>", {"Content-Type": "text/html"})] * 2,
        archive_dir=tmp_path,
    )

    client.get(URL)
    assert list(tmp_path.iterdir()) == []

    client.get(URL, archive=True)
    names = sorted(p.suffix for p in tmp_path.iterdir())
    assert names == [".html", ".json"]


def test_archive_without_directory_is_a_noop() -> None:
    client, _, _ = make_client([Reply(200, b"x")])

    assert client.get(URL, archive=True).content == b"x"


def test_archive_failure_does_not_fail_request(tmp_path: Path) -> None:
    blocker = tmp_path / "not-a-dir"
    blocker.write_text("file in the way")
    client, _, _ = make_client([Reply(200, b"payload")], archive_dir=blocker / "sub")

    assert client.get(URL, archive=True).content == b"payload"


# -- lifecycle and default client ------------------------------------------------------------


def test_context_manager_closes_owned_session_only() -> None:
    with HttpClient(resolver=public_resolver) as owned:
        closed: list[bool] = []
        owned._session.close = lambda: closed.append(True)  # type: ignore[method-assign]
    assert closed == [True]

    external = requests.Session()
    flagged: list[bool] = []
    external.close = lambda: flagged.append(True)  # type: ignore[method-assign]
    with HttpClient(session=external):
        pass
    assert flagged == []


def test_default_client_is_lazy_singleton_and_injectable() -> None:
    set_default_client(None)
    try:
        first = get_default_client()
        assert first is get_default_client()

        replacement, _, _ = make_client([Reply(200)])
        set_default_client(replacement)
        assert get_default_client() is replacement

        set_default_client(None)
        assert get_default_client() is not replacement
    finally:
        set_default_client(None)


def test_concurrent_requests_share_session_safely() -> None:
    client, adapter, _ = make_client(lambda request: Reply(200, request.url.encode()))
    results: dict[int, bytes] = {}

    def work(index: int) -> None:
        results[index] = client.get(f"https://example.org/{index}").content

    threads = [threading.Thread(target=work, args=(i,)) for i in range(16)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert results == {i: f"https://example.org/{i}".encode() for i in range(16)}
    assert len(adapter.requests) == 16


def test_all_errors_share_base_class() -> None:
    for cls in (UnsafeUrlError, ResponseTooLargeError, HttpTransportError):
        assert issubclass(cls, HttpError)
    assert issubclass(HttpStatusError, HttpError)
