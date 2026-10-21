"""URL safety checks (SSRF protection) applied to every request and every redirect hop.

Rules: only http/https, a host is mandatory, and *every* address the host resolves to must be a
public unicast address. ``allow_private_hosts=True`` skips the address check (local tests or
intranet deployments) but still enforces the scheme.

Known residual risk (DNS rebinding / TOCTOU): the guard resolves the hostname once to validate it,
and the HTTP connection resolves it again when connecting. A hostile DNS server can answer
differently the second time, so this check cannot fully exclude a rebinding attack. Closing the gap
requires pinning the validated IP in the connection (custom adapter with SNI/Host handling), which
is intentionally not done here; deployments handling untrusted URLs should also restrict egress at
the network layer.
"""

from __future__ import annotations

import ipaddress
import socket
from collections.abc import Callable, Sequence
from urllib.parse import urlsplit

from arch_competition_ops.http.errors import UnsafeUrlError

Resolver = Callable[[str], Sequence[str]]

ALLOWED_SCHEMES = frozenset({"http", "https"})


def default_resolver(host: str) -> list[str]:
    """Resolve ``host`` with the system resolver. ``OSError`` (gaierror) propagates."""
    infos = socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
    return [str(info[4][0]) for info in infos]


def _is_public(address: str) -> bool:
    ip = ipaddress.ip_address(address.split("%", 1)[0])  # drop IPv6 zone id
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    # is_global is False for private, loopback, link-local, reserved, unspecified and shared
    # (CGNAT) ranges; multicast is checked explicitly because some multicast blocks are "global".
    return ip.is_global and not ip.is_multicast


def validate_url(url: str, *, resolver: Resolver, allow_private_hosts: bool = False) -> None:
    """Raise ``UnsafeUrlError`` unless ``url`` is a safe http(s) destination."""
    try:
        parts = urlsplit(url)
        host = parts.hostname
    except ValueError as exc:
        raise UnsafeUrlError(f"Malformed URL: {exc}", url=url) from exc
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise UnsafeUrlError(f"Scheme {scheme!r} is not allowed", url=url)
    if not host:
        raise UnsafeUrlError("URL has no host", url=url)
    if allow_private_hosts:
        return
    lowered = host.lower().rstrip(".")
    if lowered == "localhost" or lowered.endswith(".localhost"):
        raise UnsafeUrlError("Host resolves to a non-public address (localhost)", url=url)
    try:
        ipaddress.ip_address(lowered)
        addresses: Sequence[str] = [lowered]
    except ValueError:
        addresses = resolver(lowered)
    if not addresses:
        raise UnsafeUrlError(f"Host {host!r} resolved to no addresses", url=url)
    for address in addresses:
        try:
            public = _is_public(address)
        except ValueError as exc:
            raise UnsafeUrlError(f"Host {host!r} resolved to invalid address", url=url) from exc
        if not public:
            raise UnsafeUrlError(f"Host {host!r} resolves to non-public address {address}", url=url)
