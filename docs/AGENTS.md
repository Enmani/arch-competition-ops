---
title: Docs Guide
status: done
updated_at: 2026-10-21
related_docs:
  - AGENTS.md
  - docs/ai/doc-governance-standard.md
  - docs/changelog/README.md
  - docs/changelog/AGENTS.md
  - docs/roadmaps/README.md
  - docs/plans/README.md
---

# Docs Guide

Repository rules are in `AGENTS.md`; this file only routes work inside `docs/**`. Read `docs/ai/doc-governance-standard.md` first for any non-trivial doc work.

## Routing

- `docs/ARCHITECTURE.md`: system overview; `docs/DATA_CONTRACT.md`: data layers and truth rules in stored data; `docs/SETUP.md`, `docs/PORT_SCRIPT.md`: operating notes
- `docs/AI_CONSTRAINTS.md`: frontend, i18n and data-access detail that backs `AGENTS.md`
- `docs/roadmaps/**`: high-level capability tracks and coarse sequencing
- `docs/goals/**`: stable capability intent, must-haves, non-goals
- `docs/structures/**`: canonical architecture, module boundaries, decision records
- `docs/plans/**`: detailed implementation plans only
- `docs/research/**`: evidence, tradeoffs, competitor and market analysis
- `docs/changelog/**`: dated closeout trace and validation history

## Hard Rules

1. Do not put roadmap docs into `docs/plans/**`, and do not turn `docs/roadmaps/**` into task lists.
2. Do not create a new canonical doc if an existing one already owns the truth.
3. When research changes direction, sync the nearest roadmap, goal, structure, or plan in the same round.
4. A round that changes canonical meaning, plan status or governance with durable trace value also gets an entry in `docs/changelog/CHANGELOG_YYYY-MM-DD.md`. The changelog is a trace, never a second source of truth.
5. Set `updated_at` whenever you change a doc's meaning, and keep `status` in the frontmatter only (never in the filename).

## Check

```bash
npm run check:docs
```
