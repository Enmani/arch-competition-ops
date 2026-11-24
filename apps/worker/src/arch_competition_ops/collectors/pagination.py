"""Report incomplete listings back to the source run, including nested pagination helpers."""

from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass


@dataclass
class Pages:
    multiplier: int
    unfinished: int = 0


_current: ContextVar[Pages | None] = ContextVar("collection_pages", default=None)


@contextmanager
def track_pages(multiplier: int):
    pages = Pages(multiplier)
    token = _current.set(pages)
    try:
        yield pages
    finally:
        _current.reset(token)


def page_limit(default: int) -> int:
    pages = _current.get()
    return default * pages.multiplier if pages else default


def unfinished_page():
    pages = _current.get()
    if pages:
        pages.unfinished += 1
