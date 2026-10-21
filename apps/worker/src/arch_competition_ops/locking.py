"""Cross-process, non-blocking file lock for ingest batches.

Three scheduled batches may overlap, and every one of them writes the same SQLite file. The lock
is an OS-level advisory lock on ``artifacts/automation/ingest.lock``:

* Windows: ``msvcrt.locking`` on one byte far past the end of the file;
* POSIX: ``fcntl.flock``.

The OS drops the lock when the owning process dies for any reason, so there is no stale-lock
state to clean up and no pid-liveness guessing. The holder's pid and start time are written into
the (otherwise unlocked) head of the file purely so a waiting process can say who is running.
"""

from __future__ import annotations

import json
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

# The Windows lock byte lives here so readers can still read the holder info at the file head.
_WINDOWS_LOCK_OFFSET = 0x7FFFFFF0


class LockHeldError(RuntimeError):
    """Another process holds the lock."""

    def __init__(self, path: Path, holder: LockHolder | None) -> None:
        self.path = path
        self.holder = holder
        detail = (
            f" (pid {holder.pid}, started {holder.started_at}, label {holder.label!r})"
            if holder
            else ""
        )
        super().__init__(f"Lock is held by another process: {path}{detail}")


@dataclass(frozen=True)
class LockHolder:
    pid: int
    started_at: str
    label: str


def _try_lock(fd: int) -> bool:
    if sys.platform == "win32":
        import msvcrt

        os.lseek(fd, _WINDOWS_LOCK_OFFSET, os.SEEK_SET)
        try:
            msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
        except OSError:
            return False
        return True

    import fcntl

    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        return False
    return True


def _unlock(fd: int) -> None:
    if sys.platform == "win32":
        import msvcrt

        os.lseek(fd, _WINDOWS_LOCK_OFFSET, os.SEEK_SET)
        msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
        return

    import fcntl

    fcntl.flock(fd, fcntl.LOCK_UN)


def read_lock_holder(path: Path) -> LockHolder | None:
    """Best-effort read of the holder info; ``None`` when absent or unreadable."""
    try:
        payload = json.loads(path.read_text(encoding="utf-8").strip() or "null")
    except (OSError, ValueError):
        return None
    if not isinstance(payload, dict):
        return None
    try:
        return LockHolder(
            pid=int(payload["pid"]),
            started_at=str(payload["started_at"]),
            label=str(payload.get("label", "")),
        )
    except (KeyError, TypeError, ValueError):
        return None


def is_locked(path: Path) -> bool:
    """True when another process currently holds the lock (probes without keeping it)."""
    if not path.exists():
        return False
    fd = os.open(path, os.O_RDWR)
    try:
        if _try_lock(fd):
            _unlock(fd)
            return False
        return True
    finally:
        os.close(fd)


@contextmanager
def exclusive_lock(path: Path, *, label: str = "") -> Iterator[LockHolder]:
    """Hold the lock for the ``with`` body; raise ``LockHeldError`` immediately if it is taken."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o644)
    try:
        if not _try_lock(fd):
            raise LockHeldError(path, read_lock_holder(path))

        holder = LockHolder(pid=os.getpid(), started_at=datetime.now(UTC).isoformat(), label=label)
        os.lseek(fd, 0, os.SEEK_SET)
        os.ftruncate(fd, 0)
        os.write(
            fd,
            json.dumps(
                {"pid": holder.pid, "started_at": holder.started_at, "label": holder.label}
            ).encode("utf-8"),
        )
        try:
            yield holder
        finally:
            _unlock(fd)
    finally:
        os.close(fd)
