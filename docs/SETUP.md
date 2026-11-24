---
title: Setup
status: done
updated_at: 2026-11-24
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

## Notice Extraction And Screening

Put the Anthropic key in the repository-root `.env`, using `.env.example` as a template. Only the worker needs the key.

```dotenv
ANTHROPIC_API_KEY=your-project-key
ARCH_COMPETITION_OPS_AI_PROVIDER=anthropic
ARCH_COMPETITION_OPS_AI_ENABLED=1
ARCH_COMPETITION_OPS_AI_MODEL=claude-haiku-5-5
ARCH_COMPETITION_OPS_AI_REASONING_EFFORT=low
ARCH_COMPETITION_OPS_AI_DAILY_BUDGET_USD=5
ARCH_COMPETITION_OPS_AI_MONTHLY_BUDGET_USD=100
```

Edit the [screening skill](../config/skills/screen-architecture-opportunities/SKILL.md) to change how notices are judged. Existing ingestion commands use AI automatically when enabled. Source search scope and fetch limits remain controlled by the existing collector and automation configuration.

Every notice is screened separately. The skill asks whether the notice offers creative spatial design work and requests exact quotations for facts. Missing evidence goes to review. Region, language, value and fees are available for people to consider after collection.

The Python wheel bundles the repository skill. Rebuild the backend package after editing it. The model receives the skill text, original notice evidence, its public URL and links from that notice.

```bash
uv run arch-competition-ops show-ai-models
uv run arch-competition-ops screen-competitions --dry-run --limit 20
uv run arch-competition-ops screen-competitions --limit 20 --json
uv run arch-competition-ops list-ai-screenings --decision recommend --json
uv run arch-competition-ops analyze-source-file --source-id ted_design_notices --path artifacts/notice.json --source-url https://ted.europa.eu/en/notice/NOTICE/html
```

Title translation uses the selected screening provider, model and shared budget. Daily ingest runs it as a separate best-effort step after screening. A provider or spending pause also pauses titles.

`polish-titles` derives the display titles (see `docs/DATA_CONTRACT.md`): rules for every record, then at most `--max-batches` (default 5) AI requests of 20 titles that give every title not yet derived by the current model a Chinese and an English display title; a changed source title is derived again, unchanged ones never. Requests are cached by exact input and count against the same daily/monthly AI budget; `--no-ai` runs the rules only, and ingest uses only those rules for new records. `screen-competitions` assesses stored records and publishes advice. New ingestion additionally extracts source fields. `analyze-source-file` extracts and screens a local notice snapshot without adding a canonical opportunity. Results are reused for identical evidence and configuration on any later day; `--force` on `screen-competitions` makes a new paid request. Malformed/incomplete output and a missing supported title fail visibly. Unsupported individual fields are omitted, and an unsupported decision quotation sends a recommendation, or a decision left without any supported quotation, to review. A linked PDF, login wall or unavailable page requires further review.

For a different public notice page shape, use `collector: generic_notice_pages`, `extractor: generic_listing_html`, `scan_method: html`, and a `url_list` or `url_list_path` in the existing source registry. Each URL must identify one notice; this collector does not crawl arbitrary listings. AI must be enabled for raw HTML extraction. The existing SSRF guard, request limits and evidence archive apply.

The caps are conservative local estimates in UTC and cover this database's worker requests. The owner's 100 USD monthly credit expires each month. Check the provider's billing dashboard for the actual balance.

`ARCH_COMPETITION_OPS_AI_CONCURRENCY` (1 to 16, default 1) sets how many detailed assessments one source's ingest runs at once. Raise it (the cloud workflow uses 8) to finish a large daily run within a job time limit; the budget caps still apply, and an HTTP 429 from the provider is retried up to 3 times with backoff. Geocoding stays sequential.

Use --collect-only on ingest-source or ingest-batch to save a window without spending money. Each paid request reads one queued notice. Configure reasoning effort with ARCH_COMPETITION_OPS_AI_REASONING_EFFORT. The default is low.

## Browser Fallback (Optional)

Only needed for sources that require a real browser:

```bash
uv sync --extra browser
uv run playwright install chromium
```

## Verify

`npm run check` (see Verification in `AGENTS.md`), plus `npm run build:web` after frontend changes.

### Using another screening service

The default uses Anthropic Messages with strict output. For OpenAI Responses, set ARCH_COMPETITION_OPS_AI_PROVIDER to openai, choose an OpenAI model such as gpt-6-luna and supply OPENAI_API_KEY. For an OpenAI-compatible Chat Completions service, select openai-compatible. Set ARCH_COMPETITION_OPS_AI_CHAT_BASE_URL, ARCH_COMPETITION_OPS_AI_CHAT_API_KEY and ARCH_COMPETITION_OPS_AI_MODEL for that service. Supply its input and output rates in USD per million tokens through ARCH_COMPETITION_OPS_AI_CHAT_INPUT_USD_PER_MILLION and ARCH_COMPETITION_OPS_AI_CHAT_OUTPUT_USD_PER_MILLION. These rates fund the local reservation when reported usage is missing. Each provider must accept strict JSON Schema and the selected reasoning effort.

The run report counts exhausted notices by source and error. Use `uv run arch-competition-ops requeue-failed --source-id SOURCE` to retry those notices after fixing the cause. Run `uv run arch-competition-ops backlog-report --source-id SOURCE` for each failed, expired or aged-out notice, including its public link, error and version. Add `--version HASH` or `--url URL` to the retry command to select just one notice. The settings and defaults for attempts, waiting time and discovery limits are in `.env.example`.
