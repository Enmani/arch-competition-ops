---
title: Plans Docs Index
status: done
updated_at: 2026-10-21
vision_doc: vision.md
related_docs:
  - docs/ai/doc-governance-standard.md
  - docs/plans/_template.md
---

# Plans Docs Index

`docs/plans/**` is for detailed implementation plans only.

Use this folder when another AI or developer should be able to execute the work with low ambiguity.

Plan filenames are `YYYY-MM-DD[-NN]-topic-plan.md` and never carry a status. The state is the frontmatter `status`, one vocabulary for every doc in the repository:

| status | meaning |
| --- | --- |
| `draft` | being written, not ready to execute |
| `not-started` | ready, nothing implemented yet |
| `in-progress` | partly implemented; `updated_at` should move whenever work lands (the docs scan warns after 60 days) |
| `done` | implemented and verified |
| `archived` | superseded or abandoned; kept for history |

## A plan should contain

- expected outcome
- in scope / out of scope
- success criteria
- ordered task blocks
- verification
- risks and rollback

## A plan should not contain

- product vision
- broad roadmap summaries
- research-only discussion
- long-term architecture truth that belongs in `docs/structures/**`

## Current Files

- [_template.md](./_template.md)
- [2026-04-19-01-expand-official-source-coverage-plan.md](./2026-04-19-01-expand-official-source-coverage-plan.md)
- [2026-04-19-02-parser-reliability-and-freshness-visibility-plan.md](./2026-04-19-02-parser-reliability-and-freshness-visibility-plan.md)
- [2026-04-19-03-deepen-canonical-normalization-plan.md](./2026-04-19-03-deepen-canonical-normalization-plan.md)
- [2026-04-19-04-ops-review-queue-plan.md](./2026-04-19-04-ops-review-queue-plan.md)
- [2026-04-19-05-qualification-scoring-v1-plan.md](./2026-04-19-05-qualification-scoring-v1-plan.md)
- [2026-04-19-06-bid-no-bid-assistant-v1-plan.md](./2026-04-19-06-bid-no-bid-assistant-v1-plan.md)
- [2026-04-19-07-saved-search-and-watchlists-plan.md](./2026-04-19-07-saved-search-and-watchlists-plan.md)
- [2026-04-19-08-alerts-and-digests-plan.md](./2026-04-19-08-alerts-and-digests-plan.md)
- [2026-04-19-09-pursuit-workspace-v1-plan.md](./2026-04-19-09-pursuit-workspace-v1-plan.md)
- [2026-04-19-10-verified-submission-intake-plan.md](./2026-04-19-10-verified-submission-intake-plan.md)
- [2026-04-19-11-introduce-crawlee-browser-fallback-plan.md](./2026-04-19-11-introduce-crawlee-browser-fallback-plan.md)
