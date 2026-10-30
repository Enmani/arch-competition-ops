---
title: Architecture
status: done
updated_at: 2026-10-30
related_docs:
  - vision.md
  - AGENTS.md
  - docs/AI_CONSTRAINTS.md
  - docs/DATA_CONTRACT.md
  - docs/structures/2026-10-21-storage-auth-api-architecture.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Architecture

This file is the system overview. Detailed decisions live in `docs/structures/`; the rules agents must follow live in `AGENTS.md`.

## Product Position

A professional opportunity radar for licensed architects and established design teams who need public-sector work with a credible path to implementation. Official procurement and authority sources outrank media visibility. The product prefers design-contest notices, design-service procurement, framework agreements and negotiated follow-on appointments, and downgrades speculative idea contests, student-only competitions and publicity-driven calls.

Primary users are licensed architects and studios; secondary users are practice managers and bid coordinators.

## Overview

```text
official procurement portals + authority pages + secondary sources
                          |
                          v
        apps/worker (Python): collect -> extract -> normalize -> verify -> store
                          |
                          v   SQLite  data/competitions.sqlite  (worker-owned tables)
                          |
                          |  scripts/export-d1-data.mjs   incremental upserts, never touches user tables
                          v
        Cloudflare D1  <-- schema from apps/web/migrations/*.sql
                          ^
                          |  D1 binding (production)  /  better-sqlite3 (local next dev)
        packages/storage  (one implementation, one SQL dialect)
                          ^
        apps/web (Next.js on Cloudflare Workers via OpenNext): discover, detail, dashboard, ops, API
```

Data flows one way: the worker writes opportunities, the web app reads them and writes only what it owns (accounts, sessions, watchlists, saved searches, review decisions).

## Modules

| Module | Owns | Does not own |
| --- | --- | --- |
| `apps/worker/src/arch_competition_ops` | Source loading, collection, extraction, normalization, verification, SQLite persistence | Presentation, accounts, per-user state |
| `apps/web` | Pages, route handlers (thin), auth and CSRF, migrations | Source parsing, inventing facts |
| `packages/storage` | Queries and row mapping for every web read and write, password hashing, sessions | HTTP, cookies, business-rule copies |
| `packages/core` | Vocabularies, zod contracts, fee rule, logger | Database access |
| `config/` | Source registry and packs, filters, taxonomy, automation batches | Secrets |
| `scripts/` | D1 export, Windows scheduled ingestion, docs scan | Runtime logic |

Storage, authentication and the API contract are specified in `docs/structures/2026-10-21-storage-auth-api-architecture.md`. The migrations in `apps/web/migrations/` are the only schema authority; the worker's `storage/schema.py` mirrors them and `apps/worker/tests/test_schema_parity.py` fails on drift.

## Worker Layout

- `collectors/` one module per upstream shape (TED, BOAMP, ANAC, GGZY, municipal portals, RSS ...), selected by `collector:` in `config/source_packs/`; `collectors/ggzy/` and `collectors/municipal/` are packages.
- `extractors/` turn a fetched document into a `CompetitionRecord` using only evidence in the notice.
- `normalizers/` dates, money, text, identity keys and the confidence formula.
- `verifiers/` compare secondary records with official or authority pages.
- `http/` the single HTTP client: retries for GET, per-host rate limit, size cap, charset detection, SSRF guards, optional raw-response archive under `artifacts/html`.
- `storage/` SQLite connection, schema mirror, field-level merge upsert (`merge.py`), run history, review queue.
- `postprocess/` source-specific maintenance tasks registered by `source_id` (ANAC, GETS), so core modules stay source-agnostic.
- `screening/` calls the OpenAI Responses API for source-grounded field extraction and targeting decisions. With AI enabled, collection bypasses client-side relevance gates and the worker uses shared AI extraction. A source-specific parser retains upstream notice ids and CPV identifiers. Portal search queries, pagination, authentication and transport remain with collectors.
- `locking.py` OS-level lock that serializes scheduled batches; `clock.py` the single clock, overridable with `ARCH_COMPETITION_TODAY`.
- `ingest.py`, `automation.py`, `maintenance.py`, `diagnostics.py`, `cli.py` the pipeline, batches, clean-up, health checks and command line.

An ingest records a run per source, writes all records of a source in one transaction, and skips (and reports) individual documents that fail instead of aborting the batch. Failures are reported through exit codes (see `apps/worker/README.md`).

## Record Model And Truth Rules

The canonical object is a professional design opportunity, not a competition listing. Core fields include title, `authority_name`, `organizer` (the buyer, empty when unknown), `source_id`/`source_name` (the publishing platform), `official_url`, `source_url`, `official_notice_id`, jurisdiction, procedure type, CPV codes, implementation path, fees, estimated contract value, deadline, eligibility summary, evidence level, qualification score and status.

Fee, currency, eligibility, identity and merge rules are in `docs/DATA_CONTRACT.md`. Short form: unknown stays unknown (`NULL` fee means pending), values are only taken from explicit evidence, a re-ingest never erases evidence or human decisions, and an official source wins over an aggregator with the conflict kept in `evidence_note`.

## Qualification

`qualification_score` is a professional viability score, not a popularity score. Positive signals: an official notice, an explicit authority and procedure type, a downstream implementation route, architect qualification required, a visible budget and an available brief. Negative signals: participation fees with no implementation path, student-only or open-to-all calls, no identifiable authority or notice id, and rights-heavy publicity contests. The score is computed in the worker (`normalizers/competition.py`) and only displayed by the web app.

## AI Extraction And Screening

AI mode is enabled by `ARCH_COMPETITION_OPS_AI_ENABLED=1`. The default is `gpt-6-luna` with `high` reasoning. The existing source registry and `config/filters.yml` remain in use. `config/skills/screen-architecture-opportunities/SKILL.md` is the shared judgment skill for both AI stages: assess the advertised deliverable, current participation and meaningful uncertainty. Its repository copy is bundled into the Python wheel at build time so backend deployments need no local user-profile files. A missing custom skill is an error. `generic_notice_pages` accepts configured notice URLs without site-specific parsing. API listing records are supplemented with the linked notice page where accessible.

An assessment returns source-language fields with exact quotations, plus a bilingual recommendation: `recommend`, `exclude` or `needs_review`. The extraction boundary checks quotations, supplied URLs, monetary values/currency, date consistency and allowed taxonomy labels. Unknown fields remain empty. Quotes and unresolved claims are retained in `evidence_note`; AI extraction still passes through verification and geocoding. Linked PDFs are not read by this path.

Candidate retrieval is permissive. The worker collects up to five times the per-source extraction limit (capped at 100), then asks Luna's Decisions API to choose `keep`, `exclude` or `uncertain`. Only `exclude` with confidence at or above the configurable 0.98 threshold removes a candidate; missing/refused answers keep it. Confidence is an uncalibrated model estimate, not a measured error probability. `keep` candidates rank ahead of uncertain ones. Survivors beyond the extraction limit are counted as deferred. TED's AI query defaults to CPV `71*`; a source's `search_query` can override it. Other portal search scopes, allowlists and transport limits still apply.

AI mode bypasses source-adapter title, topical classification, notice-type and missing-deadline rejection gates, including GGZY listing validation and municipal/TenderNed candidate checks. Discovery queries and bounded retrieval still determine which notices can be seen; this is not an exhaustive crawl. The shared skill owns semantic matching in both stages. Legacy keyword exclusions and positive-keyword bonuses apply only without AI.

`ingest-batch --batch-id all_enabled` resolves every currently enabled source from the registry, with a 30-day publication window and a default 20 detail assessments per source. AI batches run at most three sources concurrently by default (`max_workers`, capped at four), while the ingest lock prevents overlapping batches. Batch results distinguish collected documents, model first-pass exclusions, processed records, document failures and deferred candidates. Budget exhaustion stops paid detail work for the source without treating the remaining candidates as irrelevant, and collection continues for later sources.

The same detail response extracts source-backed participation excerpts under five categories: timeline, commercial, eligibility, scope and submission. These are short original-language clauses, not inferred qualification decisions. They live in `ai_screening_results.result_json.notice_details`; the detail read model validates their shape and displays only the current source revision. Country, source notice id and languages can also be normalized when the notice explicitly supports them.

Success means a source-grounded title and usable candidate record, not complete bid eligibility. Missing price/address/qualification fields do not invalidate a record. Unsupported individual fields are omitted, unsupported decision quotes downgrade the recommendation to `needs_review`, and source casing is restored in quotations. Malformed/incomplete responses, API failures and a missing supported title remain failures. `recommend` means worth further review. Source facts and their published assessment are written atomically to preserve the source-revision check.

`ai_screening_runs` is a local ledger and exact-input cache. Source-specific AI locks serialize requests for the same source across checkouts; each reservation is checked and written in one database transaction so concurrent sources share the daily/monthly ceiling. Ambiguous network outcomes retain their reservation. Automatic paid retries are disabled. The default estimated limits are USD 1 per UTC day and USD 31 per UTC calendar month, including other models using the same database. These estimates ignore cache discounts and are not the organization's invoice or credit balance.

`ai_screening_results` is the latest published assessment per opportunity and is exported to D1. Discovery hides `exclude` only while its source revision matches the record; `shortlisted` and `verified` human statuses remain visible. Detail and watchlist lookups keep access to the record. The ledger, full prompts and API key are not exported. A failed assessment is reported as a document failure rather than silently substituting rule-based extraction.

AI supplies quoted project address, city, region and country components, never coordinates. The existing Nominatim geocoder tries the stated location and progressively coarser components, keeping the original address. Unicode location keys preserve Chinese place names. Fallbacks use `nominatim:area` or `nominatim:country` with capped confidence, so the detail page can label the approximate coverage and link to a map. Cache writes merge independent source workers' snapshots atomically.

## Web Surface

- Discover: image-led compact cards for first-pass screening; filters, sort, paging and facets are computed in SQL.
- Detail: authority, procedure, implementation route, qualification requirements, commercial signals, evidence note and official links.
- Dashboard: the signed-in user's private watchlist and saved searches.
- Ops console (administrators only): source health, duplicate pressure, review queue and decisions.
- Opportunity card previews are generated offline by `packages/previews` (satellite imagery, official images, a `manifest.json`); the Web image route only serves what the manifest names and otherwise draws a placeholder. The worker can run the generator after ingest (`ARCH_PREVIEW_PREWARM=1`). See `docs/structures/2026-10-21-preview-pipeline-architecture.md`.

## Deployment

Production is one Cloudflare Worker (OpenNext bundle with static assets) plus one D1 database, bound as `DB` in `apps/web/wrangler.jsonc`. The worker pipeline runs on an operator machine (Windows scheduled tasks or any scheduler), and its results reach D1 with `npm run d1:export-data` followed by a D1 import. Procedure, secrets and rollback: `CLOUDFLARE_DEPLOY_RUNBOOK.md`. Local development needs no Cloudflare account.

## Source Strategy

1. Primary official procurement (TED, BOAMP, simap, ANAC/BDNCP, national hubs): first-pass ingestion, official notice ids, procedure detection.
2. Primary authority pages (buyer profiles, municipal and regional pages): confirm attachments and addenda, capture local qualification constraints.
3. Secondary discovery (aggregators, media, association round-ups): discovery hints only, never the final authority for a critical fact.

## Why This Shape

The system is deliberately narrow: official-source-first, qualification-aware and implementation-oriented. That constraint is the product advantage; the architecture keeps facts in the worker and storage layers so the website cannot drift into inventing them.
