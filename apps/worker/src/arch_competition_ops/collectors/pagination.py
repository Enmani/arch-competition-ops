"""Run-local listing limits. Durable continuation is committed together with discovered rows."""

import hashlib
import json
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import date
from xml.etree import ElementTree


@dataclass
class Pages:
    maximum: int
    items: int
    end: str | None
    cursor: str = ""
    complete: bool = False
    repeated: bool = False
    seen_pages: set[bytes] = field(default_factory=set)
    unfinished: int = 0
    used: int = 0
    rows: int = 0
    position: int = 0
    page: str = ""


_current: ContextVar[Pages | None] = ContextVar("collection_pages", default=None)


@contextmanager
def track_pages(maximum, items, end, cursor):
    pages = Pages(maximum, items, end, cursor)
    token = _current.set(pages)
    try:
        yield pages
    finally:
        _current.reset(token)


def current_pages():
    return _current.get()


def page_limit(default):
    pages = _current.get()
    return min(default, max(0, pages.maximum - pages.used)) if pages else default


def bounded_pages(numbers):
    for number in numbers:
        pages = _current.get()
        if pages:
            if pages.repeated:
                return
            if pages.used >= pages.maximum:
                unfinished_page()
                return
            pages.used += 1
        yield number


def unfinished_page():
    pages = _current.get()
    if pages:
        pages.unfinished += 1


def repeated_page():
    if state := current_pages():
        state.repeated = True
        unfinished_page()


def observe_page(keys):
    state = current_pages()
    if state is None:
        return True
    encoded = sorted(json.dumps(key, sort_keys=True, default=str) for key in keys)
    if not encoded:
        return True
    signature = hashlib.sha256(json.dumps(encoded).encode()).digest()
    if signature in state.seen_pages:
        repeated_page()
        return False
    state.seen_pages.add(signature)
    return True


def page_position(default):
    state = current_pages()
    if not state:
        return default
    page, offset = json.loads(state.cursor) if state.cursor else [default, 0]
    state.page = page
    state.position = offset
    return page


def next_page(page):
    state = current_pages()
    if state:
        state.page = page
        state.position = 0
        state.cursor = json.dumps([page, 0])


def numbered_pages(numbers, *, last=None):
    first = page_position(numbers.start)
    stop = first + len(numbers) if last is None else min(first + len(numbers), last + 1)
    for number in bounded_pages(range(first, stop)):
        yield number
        state = current_pages()
        if state and state.rows >= state.items:
            unfinished_page()
            return
        next_page(number + 1)
    if last is not None and stop <= last:
        unfinished_page()


def page_items(items):
    state = current_pages()
    if state and iter(items) is items:
        items = list(items)
    if state and not observe_page(
        ElementTree.tostring(item, encoding="unicode")
        if isinstance(item, ElementTree.Element)
        else item
        for item in items
    ):
        return
    for index, item in enumerate(items):
        if state:
            if index < state.position:
                continue
            if state.rows >= state.items:
                unfinished_page()
                return
            state.rows += 1
            state.cursor = json.dumps([state.page, index + 1])
        yield item


def window_end(fallback: date) -> date:
    state = current_pages()
    return min(date.fromisoformat(state.end), fallback) if state and state.end else fallback


def snapshot_pages(keys):
    """Resume a finite list of feeds or listing URLs by stable key."""
    state = current_pages()
    if not state:
        yield from keys
        return
    first, after = json.loads(state.cursor) if state.cursor else ["", ""]
    for key in sorted(set(keys)):
        if key < first:
            continue
        if state.used >= state.maximum or state.rows >= state.items:
            state.cursor = json.dumps([key, ""])
            unfinished_page()
            return
        state.used += 1
        state.page = key
        state.cursor = json.dumps([key, after if key == first else ""])
        yield key
        if state.unfinished:
            return
    state.complete = True


def snapshot_items(rows, limit, key):
    """Stable continuation inside a snapshot even if its upstream ordering changes."""
    state = current_pages()
    if not state:
        yield from rows[:limit]
        return
    page, after = json.loads(state.cursor) if state.cursor else ["", ""]
    for row in sorted(rows, key=key):
        item = key(row)
        if after and item <= after:
            continue
        if state.rows >= state.items:
            unfinished_page()
            return
        state.rows += 1
        state.cursor = json.dumps([page, item])
        yield row


def snapshot_documents(documents, limit):
    return [
        doc
        for _ in snapshot_pages(["feed"])
        for doc in snapshot_items(documents, limit, lambda doc: doc.source_url)
    ]
