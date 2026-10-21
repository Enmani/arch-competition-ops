"""Offline fakes shared by the HTTP client tests.

Nothing here touches the network or DNS: requests are served by a scripted ``BaseAdapter`` mounted
on a real ``requests.Session``, name resolution uses an injected resolver, and time is a fake clock.
"""

from __future__ import annotations

import io
import threading
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from typing import Any

import requests
from requests.adapters import BaseAdapter
from requests.structures import CaseInsensitiveDict

from arch_competition_ops.http import HttpClient

PUBLIC_IP = "93.184.216.34"
URL = "https://example.org/page"


@dataclass
class Reply:
    status: int = 200
    body: bytes = b""
    headers: dict[str, str] = field(default_factory=dict)
    raw: io.BytesIO | None = None


class ScriptedAdapter(BaseAdapter):
    """Serves replies from a list (in order) or a callable; records every request."""

    def __init__(self, script: Iterable[Reply | Exception] | Callable[[Any], Reply | Exception]):
        super().__init__()
        self._script = script if callable(script) else iter(script)
        self.requests: list[requests.PreparedRequest] = []
        self.kwargs: list[dict[str, Any]] = []
        self._lock = threading.Lock()

    def send(self, request, stream=False, timeout=None, verify=True, cert=None, proxies=None):
        with self._lock:
            self.requests.append(request)
            self.kwargs.append({"stream": stream, "timeout": timeout})
            item = self._script(request) if callable(self._script) else next(self._script)
        if isinstance(item, Exception):
            raise item
        response = requests.Response()
        response.status_code = item.status
        response.headers = CaseInsensitiveDict(item.headers)
        response.raw = item.raw or io.BytesIO(item.body)
        response.url = request.url
        response.request = request
        return response

    def close(self) -> None:
        return None


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0
        self.sleeps: list[float] = []

    def sleep(self, seconds: float) -> None:
        self.sleeps.append(seconds)
        self.now += seconds

    def monotonic(self) -> float:
        return self.now


def public_resolver(host: str) -> Sequence[str]:
    return [PUBLIC_IP]


def make_client(
    script: Iterable[Reply | Exception] | Callable[[Any], Reply | Exception],
    **kwargs: Any,
) -> tuple[HttpClient, ScriptedAdapter, FakeClock]:
    adapter = ScriptedAdapter(script)
    session = requests.Session()
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    clock = FakeClock()
    kwargs.setdefault("resolver", public_resolver)
    client = HttpClient(session=session, sleep=clock.sleep, monotonic=clock.monotonic, **kwargs)
    return client, adapter, clock


class TrackedBody(io.BytesIO):
    """BytesIO that remembers how many bytes were read (``tell`` fails once closed)."""

    bytes_read = 0

    def read(self, size: int | None = -1) -> bytes:
        data = super().read(size)
        self.bytes_read += len(data)
        return data
