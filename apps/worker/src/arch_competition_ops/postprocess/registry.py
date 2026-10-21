"""Registry of source-specific maintenance tasks, keyed by the ``source_id`` they apply to.

Core modules (storage, ingest, CLI) know nothing about individual sources; adding another source's
clean-up means adding a module here and one entry below.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from arch_competition_ops.postprocess import anac, gets
from arch_competition_ops.settings import Settings


@dataclass(frozen=True)
class PostprocessTask:
    task_id: str
    source_id: str
    description: str
    run: Callable[..., int]

    def execute(self, settings: Settings, *, limit: int = 500) -> int:
        return self.run(settings, limit=limit)


_TASKS = (
    PostprocessTask(
        task_id="normalize-anac-source-traces",
        source_id=anac.SOURCE_ID,
        description="rewrite stored ANAC source trace links to human-readable ANAC detail pages",
        run=anac.normalize_source_traces,
    ),
    PostprocessTask(
        task_id="normalize-anac-record-statuses",
        source_id=anac.SOURCE_ID,
        description="mark archived ANAC result notices as archived records",
        run=anac.normalize_record_statuses,
    ),
    PostprocessTask(
        task_id="normalize-gets-preannouncement-statuses",
        source_id=gets.SOURCE_ID,
        description="discard GETS advance notices that are not yet open tenders",
        run=gets.normalize_preannouncement_statuses,
    ),
)

POSTPROCESS_TASKS: dict[str, PostprocessTask] = {task.task_id: task for task in _TASKS}
