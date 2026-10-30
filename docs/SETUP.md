---
title: Setup
status: done
updated_at: 2026-10-30
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

## OpenAI Extraction And Screening

Claim API credits in the intended API organization, then create a project key at [API keys](https://platform.openai.com/api-keys). Put it in the repository-root `.env`, using `.env.example` as a template. The key is read only by the Python worker.

```dotenv
OPENAI_API_KEY=your-project-key
ARCH_COMPETITION_OPS_AI_ENABLED=1
ARCH_COMPETITION_OPS_AI_MODEL=gpt-6-luna
ARCH_COMPETITION_OPS_AI_REASONING_EFFORT=high
ARCH_COMPETITION_OPS_AI_DAILY_BUDGET_USD=1
ARCH_COMPETITION_OPS_AI_MONTHLY_BUDGET_USD=31
```

Edit the [screening skill](../config/skills/screen-architecture-opportunities/SKILL.md) to change how notices are judged, and `config/filters.yml` for structured preferences. Existing ingestion commands use AI automatically when enabled. Source search scope and fetch limits remain controlled by the existing collector and automation configuration.

The skill judges the advertised deliverable, the current participation opportunity and the difference between a mismatch and missing evidence. It covers architecture, urban and landscape design. Countries and languages are priorities, while missing prices or eligibility clauses remain gaps to check.

Both AI stages read the same versioned skill. Source deployments use the repository file; the Python wheel bundles that file for backend deployments outside a checkout. No user-profile skill directory is required. A custom `ARCH_COMPETITION_OPS_AI_PREFERENCES` path must exist in the deployed environment; missing or empty instructions fail visibly. Rebuild the backend package after updating the skill.

TED listing inputs include notice type, project description, place of performance and separate tender/request deadlines before repeated multilingual metadata. This keeps those facts available within the bounded AI preview. A country preference does not add a national portal collector or guarantee balanced sampling across countries; the source registry and query limits still determine coverage.

```bash
uv run arch-competition-ops show-ai-models --live
uv run arch-competition-ops screen-competitions --dry-run --limit 20
uv run arch-competition-ops screen-competitions --limit 20 --json
uv run arch-competition-ops list-ai-screenings --decision recommend --json
uv run arch-competition-ops analyze-source-file --source-id ted_design_notices --path artifacts/notice.json --source-url https://ted.europa.eu/en/notice/NOTICE/html
```

`screen-competitions` assesses stored records and publishes advice. New ingestion additionally extracts source fields. `analyze-source-file` extracts and screens a local notice snapshot without adding a canonical opportunity. Results reuse exact inputs/configuration within the same day; `--force` on `screen-competitions` makes a new paid request. Malformed/incomplete output and a missing supported title fail visibly. Unsupported individual fields are omitted, and unsupported decision quotations cause review. A linked PDF, login wall or unavailable page requires further review.

For a different public notice page shape, use `collector: generic_notice_pages`, `extractor: generic_listing_html`, `scan_method: html`, and a `url_list` or `url_list_path` in the existing source registry. Each URL must identify one notice; this collector does not crawl arbitrary listings. AI must be enabled for raw HTML extraction. The existing SSRF guard, request limits and evidence archive apply.

The caps are conservative local estimates in UTC and cover this database's worker requests. Check [OpenAI billing](https://platform.openai.com/settings/organization/billing/overview) for actual credits and expiration. Model catalog prices were checked on 2026-10-30 and need updating when provider prices change. Decisions API supports Luna classification/scoring without generated explanations; the current extraction path uses Responses for quotations and written reasons.

Candidate-list triage uses Luna's Decisions API automatically. Detailed extraction uses the selected model and `high` reasoning. Set `ARCH_COMPETITION_OPS_AI_CANDIDATE_MULTIPLIER` to change how many candidates are considered before the per-source extraction limit, or disable triage with `ARCH_COMPETITION_OPS_AI_TRIAGE_ENABLED=0`. The initial exclusion threshold is 0.98 (`ARCH_COMPETITION_OPS_AI_TRIAGE_EXCLUDE_THRESHOLD`); uncertain candidates are retained. See the architecture's success criteria before treating a recommendation as verified eligibility.

## Browser Fallback (Optional)

Only needed for sources that require a real browser:

```bash
uv sync --extra browser
uv run playwright install chromium
```

## Verify

`npm run check` (see Verification in `AGENTS.md`), plus `npm run build:web` after frontend changes.
