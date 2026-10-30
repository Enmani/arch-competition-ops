---
title: Data Contract
status: done
updated_at: 2026-10-30
related_docs:
  - AGENTS.md
  - docs/ARCHITECTURE.md
  - docs/structures/2026-10-21-storage-auth-api-architecture.md
---

# Data Contract

Which files are user-owned or runtime output (do not overwrite), which are system code, and what a stored record is allowed to say. The rule text lives in `AGENTS.md`; this file records how the data model applies it.

## User And Runtime Layer

Read by the system, never replaced without an explicit instruction.

| Path | Purpose |
|------|---------|
| `config/sources.yml`, `config/source_packs/**`, `config/source_lists/**` | source registry |
| `config/filters.yml` | targeting preferences |
| `config/skills/screen-architecture-opportunities/SKILL.md` | shared AI judgment skill, versioned with the project and bundled into backend packages |
| `data/competitions.sqlite` | canonical normalized record store (worker writes opportunities; the web app writes accounts, workspaces and review decisions) |
| `data/inbox/*` | manually collected URLs or notes waiting for processing |
| `data/eval/*` | evaluation fixtures kept out of git |
| `artifacts/html/*` | raw fetched responses kept as evidence (written by the worker HTTP client) |
| `artifacts/pdf/*` | downloaded briefs and attachments |
| `artifacts/logs/*`, `artifacts/automation/*` | run logs, ingest lock, cleanup state |
| `reports/*` | synthesized briefs, digests and audits |

## System Layer

| Path | Purpose |
|------|---------|
| `apps/worker/src/arch_competition_ops/*` | Python ingestion, normalization, verification |
| `apps/web/*` | Next.js site and API; `apps/web/migrations/*.sql` is the schema authority |
| `packages/core/*` | vocabularies, zod contracts, fee rule, logger |
| `packages/storage/*` | the one storage implementation (D1 binding and better-sqlite3 adapter) |
| `scripts/*` | D1 export, Windows scheduled ingestion, doc scan |
| `config/taxonomy.yml`, `config/procedure-type-registry.json` | controlled vocabulary |
| `modes/*`, `config/prompts/*` | agent operating instructions (read by agents, not by code) |
| `docs/*`, `AGENTS.md`, `README.md` | documentation and agent rules |

## Truth Rules In The Data

- Fees: `NULL` means unknown (pending). Only an explicit `0` means "no participation fee". The rule is `describeParticipationFee` in `packages/core`.
- `organizer` is the real buyer, or `''` when the notice does not name one. The publishing platform is `source_id` / `source_name` and is never shown as the buyer; `authority_name` wins over `organizer` for display.
- `eligibility_summary` is filled only from a real eligibility clause in the notice. A generic summary or description is never stored as eligibility; the column stays empty.
- Currency: `estimated_contract_value_eur` is set only when the source states EUR. TED values need `estimated-value-cur-lot`; without currency evidence the amount is kept as text with "(currency not stated)" and the euro field stays empty. Amounts in another currency stay in `estimated_contract_value_text`.
- Record id: `{title-slug}__{source_id}__{notice-id|sha1(source_url)[:10]}`. The deadline is not part of the id, so a corrected deadline updates the same row. `dedup_key` (title + buyer + deadline) is only a fuzzy duplicate signal for the review queue.
- Upsert is field-level (`apps/worker/src/arch_competition_ops/storage/merge.py`): an empty incoming value never erases stored evidence; a human status (`shortlisted`, `verified`, `discarded`) and `archived` survive re-ingest; `evidence_level` never weakens; a different `official_url` is kept out of the row and recorded in `evidence_note` as a conflict.
- For adapters that guarantee one notice per URL, a title correction keeps the existing record id. Listing/API-root URLs never merge unrelated projects on URL alone.
- Classification columns (`project_types`, `building_categories`, `design_scopes`, `project_modes`) are written by the worker; the web app reads them and does not re-derive them.

- AI-extracted facts require an exact quote from the supplied notice or its links. Euro monetary fields also require an explicit euro currency and matching amount; other currencies stay in source text. Unknown, rejected and conflicting claims remain empty or are flagged for review. Model recommendations never overwrite canonical opportunity status or human decisions.
- `ai_screening_runs` retains local inputs, results, usage and budget reservations. `ai_screening_results` contains the published recommendation and source revision; only this projection is exported to D1. An outdated exclusion does not hide a newer source record.
- Candidate success is distinct from verified eligibility: a supported title is required, but missing optional fields are allowed. Unsupported individual fields are omitted, and unsupported decision evidence changes the result to `needs_review` rather than discarding the entire candidate. Generated recommendations never establish eligibility as fact.

## Rule

- User-layer files can be read by the system, but must not be replaced without explicit instruction.
- System-layer files may evolve as the repository grows.
- Table and column definitions live only in `apps/web/migrations/*.sql`; the worker's `storage/schema.py` mirrors them and `test_schema_parity.py` enforces parity.
- Canonical structured records belong in the database, not in scattered Markdown tables.
