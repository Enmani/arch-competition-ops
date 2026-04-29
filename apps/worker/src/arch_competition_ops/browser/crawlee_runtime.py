from __future__ import annotations

import asyncio
import logging
import os
import re
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urljoin

from arch_competition_ops.collectors.common import strip_html

_EVENT_LOOP: asyncio.AbstractEventLoop | None = None


@dataclass(frozen=True)
class BrowserPage:
    final_url: str
    html: str
    text: str
    title: str | None
    pdf_links: list[str]


@contextmanager
def _storage_dir_env(storage_dir: Path):
    previous = os.environ.get("CRAWLEE_STORAGE_DIR")
    os.environ["CRAWLEE_STORAGE_DIR"] = str(storage_dir)
    try:
        yield
    finally:
        if previous is None:
            os.environ.pop("CRAWLEE_STORAGE_DIR", None)
        else:
            os.environ["CRAWLEE_STORAGE_DIR"] = previous


@contextmanager
def _quiet_crawlee_logs():
    logger_names = (
        "crawlee",
        "crawlee.crawlers",
        "crawlee._autoscaling",
    )
    previous_levels: dict[str, int] = {}
    try:
        for logger_name in logger_names:
            logger = logging.getLogger(logger_name)
            previous_levels[logger_name] = logger.level
            logger.setLevel(logging.WARNING)
        yield
    finally:
        for logger_name, level in previous_levels.items():
            logging.getLogger(logger_name).setLevel(level)


def _extract_pdf_links(html: str, base_url: str) -> list[str]:
    matches = re.findall(
        r"""<a[^>]+href=["']([^"'#?]+(?:\.pdf)(?:\?[^"']*)?)["']""",
        html,
        flags=re.I,
    )
    links: list[str] = []
    seen: set[str] = set()
    for match in matches:
        link = urljoin(base_url, match.strip())
        if not link or link in seen:
            continue
        seen.add(link)
        links.append(link)
    return links


async def _render_page_async(*, url: str, timeout_ms: int) -> BrowserPage:
    try:
        from crawlee.crawlers import PlaywrightCrawler, PlaywrightCrawlingContext
    except ImportError as exc:  # pragma: no cover - depends on optional extra
        raise RuntimeError(
            "Crawlee browser runtime requires the browser extra. Run `uv sync --extra browser`."
        ) from exc

    result: BrowserPage | None = None

    crawler = PlaywrightCrawler(
        max_requests_per_crawl=1,
        headless=True,
        browser_type="chromium",
    )

    @crawler.router.default_handler
    async def request_handler(context: PlaywrightCrawlingContext) -> None:
        nonlocal result

        try:
            await context.page.wait_for_load_state("networkidle", timeout=timeout_ms)
        except Exception:  # noqa: BLE001
            pass

        html = await context.page.content()
        final_url = context.page.url
        title = await context.page.title()
        result = BrowserPage(
            final_url=final_url,
            html=html,
            text=strip_html(html) or "",
            title=title or None,
            pdf_links=_extract_pdf_links(html, final_url),
        )

    await crawler.run([url])

    if result is None:
        raise RuntimeError(f"Crawlee rendered no page result for {url}")
    return result


def _get_event_loop() -> asyncio.AbstractEventLoop:
    global _EVENT_LOOP

    if _EVENT_LOOP is None or _EVENT_LOOP.is_closed():
        _EVENT_LOOP = asyncio.new_event_loop()
    return _EVENT_LOOP


def render_page(*, url: str, storage_dir: Path, timeout_ms: int = 20000) -> BrowserPage:
    storage_dir.mkdir(parents=True, exist_ok=True)
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        pass
    else:  # pragma: no cover - sync worker path is the intended caller
        raise RuntimeError("render_page cannot run inside an active asyncio event loop")

    with _storage_dir_env(storage_dir):
        with _quiet_crawlee_logs():
            loop = _get_event_loop()
            asyncio.set_event_loop(loop)
            return loop.run_until_complete(_render_page_async(url=url, timeout_ms=timeout_ms))
