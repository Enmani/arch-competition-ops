"""Content-addressed evidence archive for fetched responses.

Layout: ``<dir>/<sha1>.<ext>`` holds the raw bytes, ``<dir>/<sha1>.json`` holds metadata.
Because the file name is the content hash, fetching identical bytes again never rewrites the
content file. The metadata records the most recent fetch at the top level and keeps every fetch
in ``fetches`` (url, final_url, status_code, fetched_at), so the same content seen at several
URLs or times keeps all of its provenance. Archiving is best-effort: failures are logged and
never propagate to the caller.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import tempfile
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Serialises the read-modify-write of metadata files between threads of this process.
# Separate processes archiving the same hash at the same moment may drop one history entry;
# the content file itself is always intact because writes are atomic.
_metadata_lock = threading.Lock()

_EXTENSIONS: tuple[tuple[str, str], ...] = (
    ("html", "html"),
    ("json", "json"),
    ("xml", "xml"),
    ("pdf", "pdf"),
    ("csv", "csv"),
    ("text/plain", "txt"),
)


def extension_for(content_type: str | None) -> str:
    media = (content_type or "").split(";", 1)[0].strip().lower()
    for needle, ext in _EXTENSIONS:
        if needle in media:
            return ext
    return "bin"


def _atomic_write(path: Path, data: bytes) -> None:
    fd, tmp_name = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as handle:
            handle.write(data)
        os.replace(tmp_name, path)
    except BaseException:
        Path(tmp_name).unlink(missing_ok=True)
        raise


def _load_fetches(path: Path) -> tuple[list[Any], str | None]:
    try:
        existing = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return [], None
    if not isinstance(existing, dict) or not isinstance(existing.get("fetches"), list):
        return [], None
    return list(existing["fetches"]), existing.get("first_fetched_at")


def archive_response(
    archive_dir: Path,
    *,
    url: str,
    final_url: str,
    status_code: int,
    content_type: str | None,
    content: bytes,
) -> Path | None:
    """Store ``content`` and its metadata; return the content path, or None on failure."""
    try:
        digest = hashlib.sha1(content, usedforsecurity=False).hexdigest()
        archive_dir.mkdir(parents=True, exist_ok=True)
        content_path = archive_dir / f"{digest}.{extension_for(content_type)}"
        meta_path = archive_dir / f"{digest}.json"
        if not content_path.exists():
            _atomic_write(content_path, content)
        fetched_at = datetime.now(UTC).isoformat()
        with _metadata_lock:
            fetches, first_fetched_at = _load_fetches(meta_path)
            fetches.append(
                {
                    "url": url,
                    "final_url": final_url,
                    "status_code": status_code,
                    "fetched_at": fetched_at,
                }
            )
            metadata = {
                "url": url,
                "final_url": final_url,
                "status_code": status_code,
                "fetched_at": fetched_at,
                "first_fetched_at": first_fetched_at or fetched_at,
                "content_type": content_type,
                "sha1": digest,
                "bytes": len(content),
                "fetches": fetches,
            }
            _atomic_write(meta_path, json.dumps(metadata, ensure_ascii=False, indent=2).encode())
        return content_path
    except (OSError, ValueError) as exc:
        logger.warning("Failed to archive response for %s into %s: %s", url, archive_dir, exc)
        return None
