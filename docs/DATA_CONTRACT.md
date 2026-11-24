---
title: Data Contract
status: done
updated_at: 2026-11-24
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
- Worker SQLite keeps notice versions, read attempts, coverage gaps and interrupted windows private. A notice starts as `queued`, then becomes `done`, `failed` after repeated notice errors, `expired_unread` when its listed deadline passes, or `aged_out` after the waiting period. A content correction creates a new version. A changed screening contract or an explicit retry can reopen a failure. Completed payloads are cleared after 45 days. The registry retains the version for 400 days and records retirement counts for backup verification.
- The public opportunity revision advances only for changed facts. Identical published judgments retain their revision. Poll times, attempts and model reservations stay out of public change detection. Full evidence and model provenance for each judgment are available in the private screening log until its normal cleanup.
- `ai_screening_runs` retains local inputs, results, usage and budget reservations; inputs and results older than 45 days are blanked (`input_json = ''`, `result_json = NULL`) while the row and its cost columns stay. A record whose current assessment is `exclude` is deleted by the daily cleanup after the 7-day retention window unless it is `shortlisted`, `verified` or watchlisted. `ai_screening_results` contains the published recommendation and source revision; only this projection is exported to D1. An outdated exclusion does not hide a newer source record.
- Anthropic screening stores total reported input tokens including cache reads and cache creation. A refused or truncated reply records its usage but cannot publish a judgment. Server errors with unknown usage retain budget, and unfinished notices stay in the worker queue.
- Candidate success is distinct from verified eligibility: a supported title is required, but missing optional fields are allowed. Unsupported individual fields and participation excerpts are omitted without changing the content judgment; the published assessment reports input limitations. A recommendation with unsupported decision evidence, or any decision left with no supported evidence, changes to `needs_review` rather than discarding the candidate; an exclusion with at least one verified quote stays an exclusion. Generated recommendations never establish eligibility as fact.
- Participation excerpts are published as `notice_details` in the advisory result JSON, grouped into timeline, commercial, eligibility, scope and submission. Both excerpt and quotation must match the supplied notice; unknown clauses are omitted. They are not additional canonical columns or verified bid conditions. Storage exposes them on detail lookup only when the published source revision is current.
- The model's reader-facing summary, reasons and missing-information list (`summary_zh/en`, `reasons_zh/en`, `missing_information` and `decision` in the same result JSON) reach the detail lookup as `aiAssessment`, again only for the current source revision. The site shows them labelled as AI output; the free-form missing-information entries are sorted into a fixed set of plain topics and processing remarks are dropped, so they never appear as notice facts.
- `title` is the source's own wording and stays untouched. Cards and headings show a derived display title: `display_title` (rule-cleaned: platform prefixes, reference numbers and typography removed, never reworded), or `display_title_zh` / `display_title_en` (one AI pass per title: translated, and condensed when long). Each is checked against the source (no number may appear that the source title lacks) and the detail page shows the original title beside it. A changed `title` clears all of them for re-derivation; `display_title_source` records the cleaner/model version.
- AI-extracted city/region components are transient geocoding inputs, not invented coordinates or new database columns. Nominatim supplies coordinates; the original project address stays in `location_label`. Coarse lookups retain `:area`/`:country` in `geo_source` and cap `geo_confidence` at 0.6/0.25 respectively. A country centroid does not establish the project's street address, and neither does the centre of a whole state, region or province: the lookup asks for English names, reads "à Nouakchott, en Mauritanie" as "Nouakchott" (prepositions, "Municipiul"-style prefixes and the country itself are dropped) and skips hits of that size.
- A record's `jurisdiction` is the product's own vocabulary plus the generic `eu`, `europe` and `global` that multi-country sources (TED, the Islamic Development Bank) fall back to. When extraction leaves a generic value, the country is read from what the notice states about itself: TED's structured `placeOfPerformance` (ISO 3166-1 alpha-3), a `country` field in the listing, "Place of performance Country : ...", the record's place names, and the `Country – ` lead of a TED title (nothing else of the title). The table is the country registry shared with the Web app (`packages/previews/data/countries.json`, copy in `apps/worker/src/arch_competition_ops/data/`, built by `npm run build:countries -w @arch-competition/previews`); a name two countries share ("Congo", "Georgia") resolves to none. A record that names no country keeps its generic value, and the card then shows the place name in text instead of a drawing. `arch-competition-ops repair-jurisdictions` applies the same reading to stored records (idempotent; it only sets the country, and geocoding the stored place is opt-in with `--geocode` because a bare name like "Burg" can match a homonym).

## Rule

- User-layer files can be read by the system, but must not be replaced without explicit instruction.
- System-layer files may evolve as the repository grows.
- Published table and column definitions live in `apps/web/migrations/*.sql`; the worker's `storage/schema.py` mirrors them and `test_schema_parity.py` enforces parity.
- Canonical structured records belong in the database, not in scattered Markdown tables.
