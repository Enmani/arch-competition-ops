---
title: Setup
status: done
updated_at: 2026-10-21
related_docs:
  - README.md
  - .env.example
  - docs/PORT_SCRIPT.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Setup

## Requirements

- Python 3.12 (`.python-version`) and `uv`
- Node.js 22 and npm 10 (`.nvmrc`, `engines` in `package.json`)
- PowerShell on Windows for `dev-port.ps1` and the scheduled-ingestion scripts; the worker and `npm run dev:web` work on any OS

## Bootstrap

```bash
uv sync
npm install
uv run arch-competition-ops doctor
uv run arch-competition-ops init-db
uv run arch-competition-ops seed-demo
```

`seed-demo` inserts fictional records and refuses to run against a database that already has data.

## Configuration

Copy `.env.example` to `.env` only when a default needs to change. The file lists every variable the code reads, which process reads it and the default. The database path is `ARCH_COMPETITION_OPS_DB` for the worker, the web app and the D1 export script.

## Run The Website

```bash
npm run dev:web        # any OS
npm run dev:web:up     # Windows: health check, explains port problems
```

The site runs on `http://localhost:3400`. If Windows excludes port `3400` (an excluded TCP range), `dev:web:up` fails with an explicit diagnostic. The local server uses better-sqlite3 on `data/competitions.sqlite` and applies pending `apps/web/migrations/*.sql` on first use. To exercise the Cloudflare D1 path in development, set `ARCH_COMPETITION_USE_D1_IN_DEV=1` and use `npm run preview:web:cloudflare` for a workerd preview.

## Ingest Notices

```bash
uv run arch-competition-ops ingest-source --source-id ted_design_notices --limit 20
uv run arch-competition-ops ingest-batch --list-batches
```

## Browser Fallback (Optional)

Only needed for sources that require a real browser:

```bash
uv sync --extra browser
uv run playwright install chromium
```

## Verify

`npm run check` (see Verification in `AGENTS.md`), plus `npm run build:web` after frontend changes.
