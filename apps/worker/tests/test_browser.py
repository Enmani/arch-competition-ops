from __future__ import annotations

import asyncio

import arch_competition_ops.browser.crawlee_runtime as crawlee_runtime


def test_render_page_reuses_a_single_event_loop(tmp_path, monkeypatch) -> None:
    loop_ids: list[int] = []

    async def fake_render_page_async(*, url: str, timeout_ms: int) -> crawlee_runtime.BrowserPage:
        del url, timeout_ms
        loop_ids.append(id(asyncio.get_running_loop()))
        return crawlee_runtime.BrowserPage(
            final_url="https://example.com/",
            html="<html><body>Example Domain</body></html>",
            text="Example Domain",
            title="Example Domain",
            pdf_links=[],
        )

    existing_loop = getattr(crawlee_runtime, "_EVENT_LOOP", None)
    monkeypatch.setattr(crawlee_runtime, "_EVENT_LOOP", None, raising=False)
    monkeypatch.setattr(crawlee_runtime, "_render_page_async", fake_render_page_async)

    try:
        crawlee_runtime.render_page(
            url="https://example.com",
            storage_dir=tmp_path / "crawlee",
            timeout_ms=10000,
        )
        crawlee_runtime.render_page(
            url="https://example.com/second",
            storage_dir=tmp_path / "crawlee",
            timeout_ms=10000,
        )
        assert len(set(loop_ids)) == 1
    finally:
        loop = getattr(crawlee_runtime, "_EVENT_LOOP", None)
        if loop is not None and not loop.is_closed():
            loop.close()
        monkeypatch.setattr(crawlee_runtime, "_EVENT_LOOP", existing_loop, raising=False)
