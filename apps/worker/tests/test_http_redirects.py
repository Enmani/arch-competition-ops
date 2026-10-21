"""Offline tests for SSRF blocking and manual redirect handling in the HTTP client."""

from __future__ import annotations

from collections.abc import Sequence

import pytest
from http_fakes import PUBLIC_IP, URL, Reply, make_client

from arch_competition_ops.http import UnsafeUrlError

# -- SSRF guard through the client -----------------------------------------------------------


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/",
        "http://10.1.2.3/admin",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::1]/",
        "http://localhost/",
        "http://[::ffff:10.0.0.1]/",
        "http://[::ffff:127.0.0.1]/",
        "file:///etc/passwd",
        "ftp://example.org/file",
        "http:///nohost",
    ],
)
def test_unsafe_urls_are_blocked_without_sending(url: str) -> None:
    client, adapter, _ = make_client([Reply(200, b"secret")])

    with pytest.raises(UnsafeUrlError) as info:
        client.get(url)

    assert info.value.url == url
    assert adapter.requests == []


def test_domain_resolving_to_private_address_is_blocked() -> None:
    client, adapter, _ = make_client([Reply(200)], resolver=lambda host: [PUBLIC_IP, "192.168.0.7"])

    with pytest.raises(UnsafeUrlError, match=r"192\.168\.0\.7"):
        client.get("https://rebind.example/")

    assert adapter.requests == []


def test_unsafe_url_is_not_retried_and_counts_one_attempt() -> None:
    client, _, clock = make_client([Reply(200)])

    with pytest.raises(UnsafeUrlError) as info:
        client.get("http://127.0.0.1/")

    assert info.value.attempts == 1
    assert clock.sleeps == []


def test_allow_private_hosts_skips_ip_check_but_keeps_scheme_check() -> None:
    client, adapter, _ = make_client([Reply(200, b"local")], allow_private_hosts=True)

    assert client.get("http://127.0.0.1:8080/").content == b"local"
    with pytest.raises(UnsafeUrlError):
        client.get("file:///etc/passwd")
    assert len(adapter.requests) == 1


# -- redirects -------------------------------------------------------------------------------


def test_redirect_is_followed_and_final_url_reported() -> None:
    client, adapter, _ = make_client(
        [
            Reply(302, headers={"Location": "/moved?x=1"}),
            Reply(301, headers={"Location": "https://other.example/final"}),
            Reply(200, b"done"),
        ]
    )

    response = client.get(URL)

    assert response.content == b"done"
    assert response.url == "https://other.example/final"
    assert [r.url for r in adapter.requests] == [
        URL,
        "https://example.org/moved?x=1",
        "https://other.example/final",
    ]


def test_redirect_to_private_ip_is_blocked() -> None:
    client, adapter, _ = make_client(
        [Reply(302, headers={"Location": "http://169.254.169.254/latest/meta-data/"})]
    )

    with pytest.raises(UnsafeUrlError) as info:
        client.get(URL)

    assert "169.254.169.254" in info.value.url
    assert len(adapter.requests) == 1


def test_redirect_hop_to_domain_resolving_private_is_blocked() -> None:
    def resolver(host: str) -> Sequence[str]:
        return ["10.0.0.5"] if host == "internal.example" else [PUBLIC_IP]

    client, adapter, _ = make_client(
        [Reply(307, headers={"Location": "https://internal.example/x"})], resolver=resolver
    )

    with pytest.raises(UnsafeUrlError):
        client.get(URL)

    assert len(adapter.requests) == 1


def test_redirect_to_disallowed_scheme_is_blocked() -> None:
    client, _, _ = make_client([Reply(302, headers={"Location": "file:///etc/passwd"})])

    with pytest.raises(UnsafeUrlError):
        client.get(URL)


def test_too_many_redirects_raises_unsafe_url_error_without_retry() -> None:
    client, adapter, clock = make_client(
        lambda request: Reply(302, headers={"Location": "/again"}), max_redirects=3
    )

    with pytest.raises(UnsafeUrlError, match="Too many redirects") as info:
        client.get(URL)

    assert len(adapter.requests) == 4  # initial request + 3 followed hops
    assert info.value.attempts == 1
    assert clock.sleeps == []


def test_post_303_becomes_get_and_drops_body() -> None:
    client, adapter, _ = make_client(
        [Reply(303, headers={"Location": "/result"}), Reply(200, b"page")]
    )

    client.post(URL, data={"a": "1"}, headers={"Content-Type": "application/x-www-form-urlencoded"})

    first, second = adapter.requests
    assert first.method == "POST" and first.body
    assert second.method == "GET"
    assert second.body is None
    assert "Content-Type" not in second.headers


def test_post_307_keeps_method_and_body() -> None:
    client, adapter, _ = make_client(
        [Reply(307, headers={"Location": "/again"}), Reply(200, b"ok")]
    )

    client.post(URL, json={"a": 1})

    assert [r.method for r in adapter.requests] == ["POST", "POST"]
    assert adapter.requests[1].body == b'{"a": 1}'


def test_credentials_are_dropped_on_cross_host_redirect() -> None:
    client, adapter, _ = make_client(
        [Reply(302, headers={"Location": "https://other.example/"}), Reply(200)]
    )

    client.get(URL, headers={"Authorization": "Bearer token", "X-Keep": "1"})

    assert adapter.requests[0].headers["Authorization"] == "Bearer token"
    assert "Authorization" not in adapter.requests[1].headers
    assert adapter.requests[1].headers["X-Keep"] == "1"
