---
title: AI Repository Constraints
status: 已完成
updated_at: 2026-04-20
related_docs:
  - AGENTS.md
  - docs/AGENTS.md
  - .impeccable.md
  - docs/ARCHITECTURE.md
---

# AI Repository Constraints

This file is the durable implementation contract for all AI agents working in this repository.

Read it together with `AGENTS.md`.

## Product Intent

This product is not a generic architecture-competition gallery.

It is a procurement-first intelligence surface for:

- licensed architects
- established architecture studios
- multidisciplinary design teams screening realistic public-sector opportunities

The repository should bias toward opportunities that can lead to:

- downstream service appointments
- negotiated design awards
- framework or consultancy contracts
- real built-work pipelines

The repository should not drift toward:

- student competitions
- speculative idea calls
- inspirational competition galleries
- design-award showcase aesthetics

## Non-Negotiable Truth Rules

1. Never invent deadlines, fees, prizes, organizer names, authority names, contract values, languages, or eligibility conditions.
2. If evidence is missing, keep the field empty, `null`, or an explicit pending/unknown state.
3. If an aggregator conflicts with an official notice, the official notice wins and the conflict must be recorded in `evidence_note`.
4. Every canonical opportunity must preserve provenance through `official_url` and `source_url` when available.
5. The web surface may format or localize data, but it must not invent facts that are not present in normalized storage.

## Source Of Truth Hierarchy

Use these layers in order:

1. `config/sources.yml`
2. `config/filters.yml`
3. `config/taxonomy.yml`
4. `data/competitions.sqlite`
5. `packages/storage/src/*`
6. `apps/worker/src/arch_competition_ops/*`
7. `apps/web/src/*`

Implications:

- ingestion and normalization live in `apps/worker`
- the canonical professional-opportunity read model lives in SQLite plus `packages/storage`
- the website is a consumer of normalized records
- UI code must not bypass the storage layer with parallel ad hoc data logic

## Frontend Constraints

### UX Direction

The website must feel like an operational procurement wall, not a SaaS dashboard.

Required traits:

- full-bleed browsing surface
- typography-led hierarchy
- restrained card or sheet framing built from thin rules, not soft dashboard panels
- information density without visual clutter
- search and filters visible at the top of the browse surface
- a fast first-pass scan of the few fields that matter most on entry
- a clear one-click path from scan view into the full normalized record

Avoid:

- nested rounded-card dashboards
- decorative gradients as the main visual idea
- generic admin-panel or gallery-style card grids as the primary browse experience
- burying deadline, value, or access to route, authority, and evidence-quality context

### Discover Surface

The primary entry experience is the discover radar.

Rules:

- `/` should resolve into the localized discover surface, not a marketing homepage
- the discover page must stay focused on scanning and filtering, not landing-page storytelling
- the top search and filter strip is mandatory
- key filters include country, capture time, deadline, and price/value
- opportunity entries should prioritize image, value, title, location, and deadline for fast scan speed
- full commercial, qualification, and evidence-trace fields should live on the detail page without disappearing from the product

### Design Guardrails

- preserve the current severe, editorial, procurement-first visual language from `.impeccable.md`
- do not regress to “AI slop” patterns such as stacked soft cards, glossy shadows, or decorative metrics
- if cards are used, keep them severe, image-led, and procurement-first rather than lifestyle-gallery-like
- if redesigning, stay within the same product personality: severe, exacting, editorial, information-forward

## I18n And Language Constraints

This repository now uses route-level i18n.

Supported locales:

- `zh`
- `en`

Rules:

1. All user-facing product copy added by code changes must exist in both Chinese and English.
2. New pages must be implemented under `apps/web/src/app/[locale]/...` unless there is a specific reason to keep a legacy redirect route.
3. New internal navigation must preserve locale prefixes.
4. The locale switcher must remain available in the top-right shell area.
5. Query-string state should survive locale switching when reasonable.
6. Do not hardcode UI strings directly inside components when they are product copy.
7. Put product copy in `apps/web/src/i18n/dictionaries.ts`.
8. Use locale-aware formatting helpers for dates, currency, and normalized taxonomy labels.

Important distinction:

- normalized taxonomy labels may be localized
- official-source text, titles, notes, and evidence prose may remain in the source language unless there is an explicitly designed translation layer
- do not silently machine-translate source evidence and present it as canonical fact

## Backend And Data Constraints

### Worker Side

- keep scraping, parsing, normalization, and verification in `apps/worker`
- do not move ingestion logic into the web app
- source-specific extraction belongs in worker extractors, not UI formatters

### Storage Side

- `packages/storage` is the canonical read layer for the website
- if the website needs additional fields, extend the storage read model rather than rebuilding a second mapping inside the page component
- prefer adding feed/detail query helpers in storage over ad hoc SQLite access in `apps/web`

### API Side

- API routes must reuse storage-layer queries and i18n-safe filter parsing where applicable
- do not introduce alternative API shapes that duplicate discover filtering semantics without a clear reason
- API output should carry normalized keys where necessary so the frontend can localize safely

## Routing Constraints

The current route model intentionally supports both canonical localized routes and non-localized compatibility redirects.

Keep this pattern:

- canonical pages live under `/[locale]/...`
- bare routes such as `/discover` may redirect to the preferred locale
- legacy routes such as `/competitions/[slug]` may redirect to `/[locale]/opportunities/[slug]`

Do not add new primary pages outside the locale segment unless they are explicitly designed as redirects or technical endpoints.

## Port And Runtime Constraints

This repository must avoid Trinity-related ports already in use elsewhere.

Hard rule:

- web development must stay on port `3400` unless the user explicitly changes the repo standard

Do not casually move the web app back to:

- `3000`
- `3001`
- or other Trinity-adjacent defaults already called out by the user

## File Placement Constraints

- website UI and route code: `apps/web/src/*`
- i18n config and dictionaries: `apps/web/src/i18n/*`
- storage read model and tests: `packages/storage/src/*`
- ingestion and verification: `apps/worker/src/arch_competition_ops/*`
- raw downloads, source artifacts, and fetched files: `artifacts/`
- reports and synthesized outputs: `reports/`
- canonical structured data: `data/competitions.sqlite`

Do not create parallel folders for the same concern unless the repository is intentionally being restructured.

## Testing And Verification Constraints

Before claiming a change is complete, run the checks that match the affected surface.

Minimum expectations:

- storage changes: `npm run test:storage`
- web changes: `npm run lint:web`
- route or build-affecting web changes: `npm run build:web`
- worker or repository health changes: `uv run arch-competition-ops doctor` and `uv run arch-competition-ops verify`

When validating UI work, also verify in a browser when possible:

- locale switching works
- discover filters still work
- root and legacy redirects still resolve correctly
- no console errors on a fresh load

## Change Discipline For AI Agents

When making changes:

1. Read `AGENTS.md` first.
2. Read this file before any non-trivial modification.
3. If touching the web app, inspect `apps/web/src/i18n`, `apps/web/src/components`, and the relevant `app/[locale]` route before coding.
4. If touching data shape, inspect `packages/storage/src/index.ts` before coding.
5. If touching ingestion or source truth, inspect `apps/worker` plus `config/sources.yml` and `config/taxonomy.yml`.

Do not:

- add hardcoded English-only UI
- add a second unofficial data access path
- introduce speculative/non-normalized opportunity fields directly in the UI
- weaken evidence and provenance rules for speed
- redesign the browse surface into a generic dashboard

## When In Doubt

Choose the option that is:

- more evidence-grounded
- more storage-centered
- more procurement-first
- more bilingual by default
- more consistent with the existing severe minimal browse surface
