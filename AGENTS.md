---
title: Arch Competition Ops for Codex
status: 已完成
updated_at: 2026-04-21
related_docs:
  - docs/AI_CONSTRAINTS.md
  - docs/AGENTS.md
  - docs/ai/doc-governance-standard.md
---

# Arch Competition Ops for Codex

Read this file first. It defines how AI agents should work in this repository.

Then read `docs/AI_CONSTRAINTS.md`. That file is the detailed implementation contract for frontend, backend, i18n, routing, ports, and verification.
For non-trivial documentation work under `docs/**`, also read `docs/ai/doc-governance-standard.md`.

## Core Principle

This repository is a competition-intelligence monorepo. Agents should favor evidence, normalized storage, and reproducible outputs over free-form prose.

## Sources of Truth

- `vision.md`: product vision and top-level direction
- `config/sources.yml`: canonical source registry
- `config/filters.yml`: user targeting preferences
- `config/taxonomy.yml`: allowed labels and controlled vocabulary
- `data/competitions.sqlite`: canonical structured opportunity records
- `docs/AI_CONSTRAINTS.md`: repository-wide implementation constraints for all AI agents
- `docs/roadmaps/**`: roadmap layer for capability tracks
- `docs/goals/**`: stable capability intent
- `docs/structures/**`: canonical architecture boundaries
- `docs/plans/**`: detailed implementation plans only
- `docs/research/**`: evidence sidecars and product research
- `docs/changelog/**`: dated closeout trace for governed changes
- `apps/worker/src/arch_competition_ops/*`: ingestion and normalization logic
- `apps/web/src/*`: website and API surface
- `packages/core/src/*`: shared TypeScript contracts and demo data
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
- website or API work: read `apps/web` and `packages/core` before adding new UI or API shapes
- any non-trivial code change: read `docs/AI_CONSTRAINTS.md` before editing
- any non-trivial docs change: read `docs/ai/doc-governance-standard.md` and `docs/AGENTS.md` before editing

## Verification

Before claiming the repository is healthy, run:

```bash
uv run arch-competition-ops doctor
uv run arch-competition-ops verify
npm run test:storage
npm run lint:web
npm run build:web
```

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This repo may be indexed by GitNexus, but GitNexus is optional here.

Use the GitNexus MCP tools when they materially help with code understanding, debugging, impact analysis, or refactoring. Do not treat `gitnexus_impact`, `gitnexus_detect_changes()`, or other GitNexus calls as mandatory before every edit or commit.

If a GitNexus tool warns that the index is stale, either refresh it with `npx gitnexus analyze` or continue with local code reading and normal verification when that is faster and sufficient for the task.

Available references remain under `.claude/skills/gitnexus/**` for cases where graph-aware exploration is actually useful.

<!-- gitnexus:end -->
