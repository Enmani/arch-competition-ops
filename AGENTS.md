---
title: Arch Competition Ops for Codex
status: done
updated_at: 2026-10-21
related_docs:
  - docs/AI_CONSTRAINTS.md
  - docs/AGENTS.md
  - docs/ai/doc-governance-standard.md
---

# Arch Competition Ops for Codex

Read this file first. It defines how AI agents should work in this repository.

Then read `docs/AI_CONSTRAINTS.md`. That file holds the frontend, i18n, routing and data-access details behind these rules. This file is the single authority for rules; other docs link here instead of restating them.
For non-trivial documentation work under `docs/**`, also read `docs/ai/doc-governance-standard.md`.

## Core Principle

This repository is a competition-intelligence monorepo. Agents should favor evidence, normalized storage, and reproducible outputs over free-form prose.

## Sources of Truth

- `vision.md`: product vision and top-level direction
- `config/sources.yml`: canonical source registry
- `config/filters.yml`: user targeting preferences
- `config/taxonomy.yml`: allowed labels and controlled vocabulary
- `data/competitions.sqlite`: canonical structured opportunity records
- `docs/AI_CONSTRAINTS.md`: frontend, i18n, routing and data-access detail
- `docs/roadmaps/**`: roadmap layer for capability tracks
- `docs/goals/**`: stable capability intent
- `docs/structures/**`: canonical architecture boundaries
- `docs/plans/**`: detailed implementation plans only
- `docs/research/**`: evidence sidecars and product research
- `docs/changelog/**`: dated closeout trace for governed changes
- `apps/worker/src/arch_competition_ops/*`: ingestion and normalization logic
- `apps/web/src/*`: website and API surface
- `apps/web/migrations/*.sql`: the only database schema authority (the worker's `storage/schema.py` mirrors it)
- `packages/storage/src/*`: the one storage implementation for the web app (D1 binding and better-sqlite3)
- `packages/core/src/*`: shared vocabularies, zod API contracts, fee rule and logger
- `docs/DATA_CONTRACT.md`: data layers and the truth rules stored records follow
- `modes/*.md`: task-specific agent behavior
- `config/prompts/*.md`: reusable prompt fragments

## Rules

1. Never invent deadlines, fees, prizes, organizer names, or eligibility conditions.
2. Every opportunity record must retain both `official_url` and `source_url` when available.
3. If an aggregator conflicts with an official source, prefer the official source and record the conflict in `evidence_note`.
4. Missing fields must stay empty or `unknown`; do not infer them unless the evidence is explicit.
5. Do not write raw browsing output into canonical records without normalization.
6. Keep runtime outputs inside `data/`, `artifacts/`, or `reports/`; do not mix them with source code.
7. Reuse the existing modes, config files, and storage layer instead of adding parallel workflows.
8. Treat the website as a consumer of normalized records, not as the place where source facts are invented.
9. Preserve the procurement-first product direction for licensed architects; do not drift into generic competition-gallery logic or styling.
10. All new product UI copy must follow the repository i18n contract and ship in both `zh` and `en`.
11. Do not let `docs/changelog/**` get ahead of canonical docs; if a round changes roadmap, goal, structure, plan, or governance truth, update the owning doc in the same round and use changelog only as the dated trace.
12. Keep the web app on port `3400` unless the user explicitly changes the repo standard.

## Routing

- discovery work: `modes/scan.md`
- field extraction: `modes/extract.md`
- conflict checks: `modes/verify.md`
- single-opportunity brief: `modes/brief.md`
- weekly or thematic summary: `modes/digest.md`
- roadmap work: `docs/roadmaps/**`
- detailed execution plans: `docs/plans/**`
- evidence and competitor research: `docs/research/**`
- changelog and closeout trace: `docs/changelog/**`
- website or API work: read `apps/web`, `packages/storage` and `packages/core` before adding new UI or API shapes
- any non-trivial code change: read `docs/AI_CONSTRAINTS.md` before editing
- any non-trivial docs change: read `docs/ai/doc-governance-standard.md` and `docs/AGENTS.md` before editing

## Verification

Before claiming the repository is healthy, run:

```bash
npm run check
```

`npm run check` runs, in order: the docs scan (`check:docs`), ruff (`lint:worker`), web ESLint (`lint:web`), `tsc --noEmit` for `packages/core`, `packages/storage` and `apps/web` (`typecheck`), then `npm test` (pytest, storage tests, web tests, export tool tests, Windows script tests), and finally `uv run arch-competition-ops doctor` and `verify`.

After changing the frontend or anything the production build depends on, also run `npm run build:web` (`npm run check:full` does both).

Individual pieces: `npm run test:worker` (pytest), `npm run test:storage`, `npm run test:web` (`apps/web/src/**/*.test.ts`), `npm run test:tools` (D1 export tool), `npm run test:docs` (docs scan), `npm run test:scripts` (Windows scheduled-task and dev-port scripts; Windows only).
