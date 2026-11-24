"""Collect a bounded window and restart once if the saved position is no longer usable."""

from arch_competition_ops.collectors.pagination import track_pages
from arch_competition_ops.run_errors import error_class
from arch_competition_ops.storage.backlog import reset_cursor


def collect_window(db, source_id, settings, end, cursor, collect):
    pages_left, items_left = settings.discovery_page_cap, settings.ai_candidate_cap
    notes = []
    spent_pages = 0
    for attempt in range(2):
        with track_pages(pages_left, items_left, end, cursor) as pages:
            try:
                documents = collect(items_left)
                pages.used += spent_pages
                return documents, pages, notes
            except Exception as exc:
                if not cursor or attempt:
                    if attempt:
                        reset_cursor(db, source_id, gap=True)
                    raise
                reset_cursor(db, source_id)
                notes.append(f"cursor_reset={error_class(exc)}")
                spent_pages = pages.used
                pages_left -= spent_pages
                items_left -= pages.rows
                if pages_left <= 0 or items_left <= 0:
                    # Save the restart for the next run when this run used its entire allowance.
                    pages.cursor = ""
                    pages.unfinished = 1
                    return [], pages, notes
                cursor = ""
