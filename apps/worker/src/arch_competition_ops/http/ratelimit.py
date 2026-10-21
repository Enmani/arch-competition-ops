"""Per-host request pacing shared by all threads of one HttpClient."""

from __future__ import annotations

import threading
from collections.abc import Callable, Mapping


class HostRateLimiter:
    """Guarantees at least ``interval`` seconds between request *starts* to the same host."""

    def __init__(
        self,
        *,
        default_interval: float,
        host_intervals: Mapping[str, float] | None,
        sleep: Callable[[float], None],
        monotonic: Callable[[], float],
    ) -> None:
        self._default = default_interval
        self._intervals = {host.lower(): value for host, value in (host_intervals or {}).items()}
        self._sleep = sleep
        self._monotonic = monotonic
        self._lock = threading.Lock()
        self._last_start: dict[str, float] = {}

    def wait(self, host: str) -> None:
        host = host.lower()
        interval = self._intervals.get(host, self._default)
        if interval <= 0:
            return
        # Reserve the start slot under the lock but sleep outside it, so concurrent threads
        # queue up at interval spacing instead of serialising on the sleep itself.
        with self._lock:
            now = self._monotonic()
            last = self._last_start.get(host)
            start = now if last is None else max(now, last + interval)
            self._last_start[host] = start
        if start > now:
            self._sleep(start - now)
