# Data Contract

This file separates stable system files from user-controlled and runtime files.

## User Layer

These files express the user's research and selection preferences. Do not overwrite them unless the user explicitly asks for it.

| Path | Purpose |
|------|---------|
| `config/sources.yml` | active source registry |
| `config/filters.yml` | active competition targeting preferences |
| `data/competitions.sqlite` | canonical normalized record store |
| `data/inbox/*` | manually collected URLs or notes waiting for processing |
| `artifacts/html/*` | raw fetched pages |
| `artifacts/pdf/*` | downloaded briefs and attachments |
| `artifacts/logs/*` | crawl or extraction logs |
| `reports/*` | synthesized opportunity briefs and digests |

## System Layer

These files define repository behavior and can be improved safely.

| Path | Purpose |
|------|---------|
| `apps/worker/src/arch_competition_ops/*` | worker package code |
| `apps/worker/scripts/*` | thin command wrappers |
| `apps/web/*` | website and API application |
| `packages/core/*` | shared TypeScript contracts and seed data |
| `packages/sources/*` | future shared source adapters |
| `packages/storage/*` | future shared repository helpers |
| `packages/ai/*` | future shared AI prompt/runtime helpers |
| `modes/*` | AI operating modes |
| `config/prompts/*` | reusable prompt fragments |
| `config/taxonomy.yml` | controlled vocabulary |
| `docs/*` | architecture and setup documentation |
| `apps/worker/tests/*` | worker verification coverage |
| `AGENTS.md` | agent rules |
| `README.md` | operator entry point |
| `pyproject.toml` | build and dependency configuration |
| `package.json` | Node workspace configuration |

## Rule

- user-layer files can be read by the system, but should not be replaced without explicit instruction
- system-layer files may evolve as the repository grows
- canonical structured records belong in SQLite or a dedicated application database, not scattered Markdown tables
