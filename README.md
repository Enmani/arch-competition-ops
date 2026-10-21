# Arch Competition Ops

Procurement-first opportunity radar for licensed architects. A Python worker collects public design-contest and design-service notices from official procurement sources, normalizes them into one SQLite schema, and a Next.js site serves them for scanning, filtering and follow-up. Production runs on Cloudflare Workers with a D1 database.

## Stack

| Part | What it is |
|------|------------|
| `apps/worker` | Python 3.12 ingestion core (`arch-competition-ops` CLI): collectors, extractors, normalizers, verifiers, SQLite storage with field-level merge |
| `apps/web` | Next.js app (zh/en routes) deployed through OpenNext to Cloudflare Workers; `apps/web/migrations/*.sql` is the only schema authority |
| `packages/storage` | The one storage implementation for the web app: Cloudflare D1 binding in production, better-sqlite3 for local `next dev` |
| `packages/core` | Shared vocabularies, zod API contracts, fee rule, logger |
| `config/` | Source registry (`sources.yml`, `source_packs/`), filters, taxonomy |
| `data/`, `artifacts/`, `reports/` | Runtime output: SQLite file, raw fetches, logs and reports |

Users register and sign in; each user has a private watchlist and saved searches. The operations console (`/ops`, `/api/ops/**`) is limited to the emails in `ARCH_OPS_ADMIN_EMAILS`.

## Quick Start

Requirements: Node.js 22 (`.nvmrc`), Python 3.12 (`.python-version`) and [`uv`](https://docs.astral.sh/uv/).

```bash
uv sync
npm install
cp .env.example .env            # optional, every variable has a default
uv run arch-competition-ops doctor
uv run arch-competition-ops init-db
uv run arch-competition-ops seed-demo        # fictional records, empty database only
npm run dev:web                              # http://localhost:3400
```

On Windows, `npm run dev:web:up` starts the same server through `dev-port.ps1`, which health-checks it and explains port conflicts (see [docs/PORT_SCRIPT.md](docs/PORT_SCRIPT.md)). The web app stays on port `3400`.

Load real data:

```bash
uv run arch-competition-ops ingest-source --source-id ted_design_notices --limit 20
uv run arch-competition-ops ingest-batch --list-batches
uv run arch-competition-ops ingest-batch --batch-id official_daytime
```

On Windows, `npm run ops:auto-fetch:install` registers the two scheduled batches (`official_daytime`, `secondary_nightly`) from `config/automation.yml`; `ops:auto-fetch:status` and `ops:auto-fetch:remove` manage them. Logs go to `artifacts/logs/auto-ingest/`.

## Verify

```bash
npm run check          # docs scan, ruff, ESLint, type checks, all tests, doctor and verify
npm run build:web      # also after frontend or build-affecting changes (check:full runs both)
```

`npm run check:docs` runs only the documentation scan. Individual test commands are listed in `AGENTS.md`.

## Deploy

`npm run build:web:cloudflare`, `npm run d1:migrate:remote`, `npm run d1:export-data` and `npm run deploy:web:cloudflare` are the building blocks; the full procedure, secrets and rollback are in [CLOUDFLARE_DEPLOY_RUNBOOK.md](CLOUDFLARE_DEPLOY_RUNBOOK.md).

## Adding Sources

Each country has one file in `config/source_packs/countries/`; set `collector:` to reuse an existing collector family, and keep long portal lists in `config/source_lists/`. `uv run arch-competition-ops show-country-coverage` prints active, scaffold-only and planned countries. See `config/source_packs/README.md`.

## Documentation

- [AGENTS.md](AGENTS.md): the rules for AI agents (single authority); [docs/AI_CONSTRAINTS.md](docs/AI_CONSTRAINTS.md) holds the frontend, i18n and data-access details.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): system shape and boundaries.
- [docs/DATA_CONTRACT.md](docs/DATA_CONTRACT.md): what is user data, runtime output or code, and the truth rules stored records follow.
- [docs/SETUP.md](docs/SETUP.md): environment details; [.env.example](.env.example): every environment variable.
- [apps/worker/README.md](apps/worker/README.md): worker commands, exit codes and layout.
- [vision.md](vision.md), `docs/roadmaps/`, `docs/plans/`, `docs/changelog/`: direction, plans and dated change trace.
