"""Run-local listing limits. Durable continuation is committed together with discovered rows."""

import json
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from datetime import date


@dataclass
class Pages:
    maximum: int
    items: int
    end: str | None
    cursor: str = ""
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
            if pages.used >= pages.maximum:
                unfinished_page()
                return
            pages.used += 1
        yield number


def unfinished_page():
    pages = _current.get()
    if pages:
        pages.unfinished += 1


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


def numbered_pages(numbers):
    first = page_position(numbers.start)
    for number in bounded_pages(range(first, first + len(numbers))):
        yield number
        state = current_pages()
        if state and state.rows >= state.items:
            unfinished_page()
            return
        next_page(number + 1)


def page_items(items):
    state = current_pages()
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
