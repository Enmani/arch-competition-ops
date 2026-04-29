---
title: Docs Guide
status: done
updated_at: 2026-04-21
related_docs:
  - docs/ai/doc-governance-standard.md
  - docs/changelog/README.md
  - docs/changelog/AGENTS.md
  - docs/roadmaps/README.md
  - docs/plans/README.md
  - docs/skills/doc-governance-workflow.md
---

# Docs Guide

Read `docs/ai/doc-governance-standard.md` first for any non-trivial doc work.

This file only adds routing for the `docs/**` subtree.

## Routing

- `docs/roadmaps/**`: high-level capability tracks and coarse sequencing
- `docs/goals/**`: stable capability intent, must-haves, non-goals
- `docs/structures/**`: canonical architecture, module boundaries, shared models
- `docs/plans/**`: detailed implementation plans only
- `docs/research/**`: evidence, tradeoffs, competitor and market analysis
- `docs/changelog/**`: dated closeout trace and validation history
- `docs/skills/**`: lightweight workflow notes for future doc work

## Hard Rules

1. Do not put roadmap docs into `docs/plans/**`.
2. Do not turn `docs/roadmaps/**` into task lists.
3. Do not create a new canonical doc if an existing one already owns the truth.
4. When research changes direction, sync the nearest roadmap, goal, structure, or plan in the same round.
5. Use `scripts/doc-governance.mjs` for normalize, scan, status updates, and whole-file writes.
6. If a round changes canonical doc meaning, executable plan status, or doc-governance rules with durable trace value, sync the same-day file under `docs/changelog/CHANGELOG_YYYY-MM-DD.md` in the same round.
7. `docs/changelog/**` is a closeout trace layer, not a second source of roadmap, goal, structure, or plan truth.

## Minimum Checks

```bash
npm run check:doc-governance
npm run check:encoding:all
```

For a single file:

```bash
npm run check:doc-governance:file -- --file docs/roadmaps/2026-04-19-near-term-product-roadmap.md
```
