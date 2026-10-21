---
title: Doc Governance Standard
status: done
updated_at: 2026-10-21
related_docs:
  - AGENTS.md
  - docs/AGENTS.md
  - docs/changelog/README.md
  - docs/roadmaps/README.md
  - docs/plans/README.md
---

# Doc Governance Standard

Keep documentation light. The goal is one truth owner per layer, fast recovery of context, and a dated trace without turning plans into diaries. Agent rules are not defined here; they live only in `AGENTS.md`.

## Layers

| Layer | Owns | Must not own |
| --- | --- | --- |
| `vision.md` | stable product intent | everything else |
| `docs/roadmaps/**` | product tracks, stage ordering | detailed tasks |
| `docs/goals/**` | who a capability serves, must-haves, non-goals | implementation sequence |
| `docs/structures/**` | module boundaries, shared models, decision records | execution slicing |
| `docs/plans/**` | implementation steps, verification, risk and rollback | product thesis, long-term architecture truth |
| `docs/research/**` | evidence and option analysis (sidecar) | canonical direction after adoption |
| `docs/changelog/**` | dated closeout trace | any canonical truth |

Prefer editing the existing canonical doc over creating a sibling. Research is a sidecar: when it changes direction, absorb the result into the nearest roadmap, goal, structure or plan. Do not keep two copies of the same truth.

## Frontmatter

Every Markdown file under `docs/` and `AGENTS.md` carries:

```md
---
title: Example Title
status: in-progress
updated_at: 2026-10-21
---
```

`status` is one of `draft`, `not-started`, `in-progress`, `done`, `archived`. It lives only here; file names never carry a status. `updated_at` is an ISO date. Optional fields: `vision_doc`, `goal_doc`, `structure_doc`, `related_docs` (repo-relative paths that must exist).

## Daily Changelog

Use `docs/changelog/CHANGELOG_YYYY-MM-DD.md` for a meaningful code or product closeout, a plan status change that matters to future work, or a governance change. Each round section has `Changed`, `Why`, `Validation` and `Modified Files`. Paths are repo-relative and commands copy-pastable. If a round changed meaning, ownership or plan status, update the owning doc first; the changelog never gets ahead of it. Typo-only fixes skip the changelog.

## Automation

`npm run check:docs` (`node scripts/doc-governance.mjs scan`) validates frontmatter, the status vocabulary, `updated_at` dates, frontmatter paths and relative links. It warns when an `in-progress` doc has not been updated for 60 days (`--stale-days <n>` changes the limit, `--strict` turns warnings into failures). It never rewrites files; edit docs and rename files with ordinary tools and fix links the scan reports.
