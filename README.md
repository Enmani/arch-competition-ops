# Arch Competition Ops

Local-first monorepo for discovering, normalizing, qualifying, and publishing public design opportunities for licensed architects.

The repository now has two runtime surfaces:

- `apps/worker`: Python ingestion and verification core
- `apps/web`: Next.js website and API surface

The repository still keeps three concerns separate:

- system logic: prompts, validation, storage code, APIs
- user configuration: source lists, filters, ranking preferences
- runtime outputs: SQLite data, raw artifacts, reports

## What It Does

- registers official procurement and authority sources in YAML
- stores normalized professional opportunity records in SQLite
- serves the website from the canonical SQLite opportunity store
- ranks opportunities by implementation path, qualification fit, and evidence strength
- keeps discover scan-first with compact cards while detail pages carry the expanded record
- ingests live TED notices through the official TED Search API
- supports scheduled batch ingestion for official and secondary source groups on Windows
- reserves explicit modes for scanning, extraction, verification, and digests
- gives AI agents clear rules for evidence, provenance, and conflict handling
- provides local worker commands: `doctor`, `verify`, `seed-demo`, `list`, and `ingest-source`

## Quick Start

```bash
cd C:\Users\fangx\arch-competition-ops
uv sync
npm install
uv run arch-competition-ops doctor
uv run arch-competition-ops init-db
uv run arch-competition-ops seed-demo
npm run dev:web:up
```

The web app defaults to `http://localhost:3400` so it does not collide with Trinity's `3000/3001` pair.
Use `npm run dev:web:up` when possible so the repo can perform a health check and explain port-binding failures, including Windows excluded port ranges that block `3400`.
The repo now auto-prepares opportunity preview image revisions and static satellite assets before `dev`, `build`, `start`, and Cloudflare builds, so local and production image URLs stay aligned without a separate manual sync step.

## Default Conventions

- run commands from the repository root
- keep website code in `apps/web`
- keep ingestion and normalization code in `apps/worker`
- keep source onboarding in `config/sources.yml`
- keep country-specific source definitions in `config/source_packs/countries/`
- keep long city or portal lists in `config/source_lists/`
- prefer reusable collector families via `collector:` in country packs instead of hardcoding every new source id in Python
- keep user targeting preferences in `config/filters.yml`
- keep taxonomy and allowed labels in `config/taxonomy.yml`
- keep structured records in `data/competitions.sqlite`
- keep raw HTML and PDF fetches in `artifacts/`
- keep synthesized summaries in `reports/`
- read `AGENTS.md` and `docs/AI_CONSTRAINTS.md` before AI-assisted code changes

## AI Constraints

The repository now includes a durable AI-facing implementation contract:

- `AGENTS.md`
- `docs/AI_CONSTRAINTS.md`

Those files define:

- product direction and audience constraints
- frontend UX and visual rules
- route-level i18n rules for `zh` and `en`
- storage-first backend boundaries
- port constraints such as keeping the web app on `3400`
- required verification before claiming changes are complete

## Source Pack Workflow

- `config/sources.yml` is now a short manifest of root packs plus a glob over `config/source_packs/countries/*.yml`
- each country should normally live in its own file under `config/source_packs/countries/`
- when a new source can reuse an upstream shape, set `collector:` in the pack and keep Python changes at the collector-family level
- long buyer lists and portal URL sets should live under `config/source_lists/`
- this layout is meant to reduce merge conflicts when multiple AIs add multiple countries in parallel
- `uv run arch-competition-ops show-country-coverage` prints which country packs are active vs still empty

## Project Layout

```text
arch-competition-ops/
├─ apps/
│  ├─ web/
│  └─ worker/
├─ packages/
│  ├─ core/
│  ├─ sources/
│  ├─ storage/
│  └─ ai/
├─ config/
├─ data/
├─ artifacts/
├─ docs/
├─ modes/
└─ apps/worker/tests/
```

## Current MVP Scope

- official-source registration
- normalized professional opportunity schema
- SQLite persistence
- SQLite-backed web reads through `packages/storage`
- website scaffold and API routes
- repo health checks
- sample data seeding

## Commands

```bash
# worker
uv run arch-competition-ops doctor
uv run arch-competition-ops verify
uv run arch-competition-ops show-country-coverage
uv run arch-competition-ops list
uv run arch-competition-ops ingest-source --source-id ted_design_notices --limit 20
uv run arch-competition-ops parse-source-file --source-id ted_design_notices --path apps/worker/tests/fixtures/ted-demo.json
uv run python apps/worker/scripts/ingest_batch.py --list-batches
uv run python apps/worker/scripts/ingest_batch.py --batch-id official_daytime

# web
npm run dev:web
npm run dev:web:up
npm run prepare:web
npm run build:web
npm run lint:web
npm run test:storage
npm run test:dev-port
npm run ops:auto-fetch:day
npm run ops:auto-fetch:night
npm run ops:auto-fetch:install
npm run ops:auto-fetch:status
```

## Windows Auto Ingest

The repository now includes a Windows-first scheduled ingestion path that reuses the existing worker pipeline.

- `official_daytime`: all enabled `official_procurement` sources, default 7-day publication window
- `secondary_nightly`: all enabled `authority_portal` and `aggregator` sources, default 30-day publication window

Run them manually:

```bash
npm run ops:auto-fetch:day
npm run ops:auto-fetch:night
```

Install default scheduled tasks for the current Windows user:

```bash
npm run ops:auto-fetch:install
npm run ops:auto-fetch:status
```

Default schedule:

- `official_daytime`: `06:30` and `14:30`
- `secondary_nightly`: `02:30`

Task registration uses the current interactive Windows user and writes per-run logs to `artifacts/logs/auto-ingest/`.
