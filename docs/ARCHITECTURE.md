---
title: Architecture
status: done
updated_at: 2026-11-24
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
| `config/` | Source registry and packs, screening requirement, taxonomy, automation batches | Secrets |
| `scripts/` | D1 export, Windows scheduled ingestion, docs scan | Runtime logic |

Storage, authentication and the API contract are specified in `docs/structures/2026-10-21-storage-auth-api-architecture.md`. The migrations in `apps/web/migrations/` own the published schema; the worker's `storage/schema.py` mirrors them and `apps/worker/tests/test_schema_parity.py` fails on drift.

## Worker Layout

- `collectors/` one module per upstream shape (TED, BOAMP, ANAC, GGZY, municipal portals, RSS ...), selected by `collector:` in `config/source_packs/`; `collectors/ggzy/` and `collectors/municipal/` are packages.
- `extractors/` turn a fetched document into a `CompetitionRecord` using only evidence in the notice.
- `normalizers/` dates, money, text, identity keys and the confidence formula.
- `verifiers/` compare secondary records with official or authority pages.
- `http/` the single HTTP client: retries for GET, per-host rate limit, size cap, charset detection, SSRF guards, optional raw-response archive under `artifacts/html`.
- `storage/` SQLite connection, schema mirror, field-level merge upsert (`merge.py`), run history, review queue.
- `postprocess/` source-specific maintenance tasks registered by `source_id` (ANAC, GETS), so core modules stay source-agnostic.
- The screening module reads one notice, decides whether it offers creative design work and extracts quoted facts. The same requirement and response schema apply to the official Anthropic Messages and OpenAI Responses clients. Collectors handle source requests and pagination. Before any paid request, the worker checks for original text in the listing or detail. It ignores empty JSON leaves, identifiers, URLs and page navigation. A missing body is reported separately from an unsupported model claim.
- `locking.py` OS-level lock that serializes scheduled batches; `clock.py` the single clock, overridable with `ARCH_COMPETITION_TODAY`.
- `ingest.py`, `automation.py`, `maintenance.py`, `diagnostics.py`, `cli.py` the pipeline, batches, clean-up, health checks and command line.

An ingest records a run per source, writes all records of a source in one transaction, and skips (and reports) individual documents that fail instead of aborting the batch. Failures are reported through exit codes (see `apps/worker/README.md`).

## Record Model And Truth Rules

The canonical object is a professional design opportunity, not a competition listing. Core fields include title, `authority_name`, `organizer` (the buyer, empty when unknown), `source_id`/`source_name` (the publishing platform), `official_url`, `source_url`, `official_notice_id`, jurisdiction, procedure type, CPV codes, implementation path, fees, estimated contract value, deadline, eligibility summary, evidence level, qualification score and status.

Fee, currency, eligibility, identity and merge rules are in `docs/DATA_CONTRACT.md`. Short form: unknown stays unknown (`NULL` fee means pending), values are only taken from explicit evidence, a re-ingest never erases evidence or human decisions, and an official source wins over an aggregator with the conflict kept in `evidence_note`.

## Qualification

The worker calculates an optional qualification score from recorded facts such as a named authority, a contract value or an implementation route. The web and MCP can read the score. Publication accepts missing and low scores.

## AI Extraction And Screening

The default screening model is claude-haiku-5-5 with low reasoning effort. The worker sends one notice and the owner’s screening requirement and a fixed extraction contract to each assessment. Anthropic uses mandatory JSON Schema output. The worker enforces integer bounds locally and checks quoted evidence for every provider.

The worker maps unambiguous structured title, notice ID, buyer, deadline, procedure and explicit euro value when the quoted source supports the value. Multiple lot values and competing dates in prose leave the deadline open for the model. The fixed output schema omits mapped facts, and the record combines both sets of grounded facts. The item links to the judgment and its receipt. Each paid attempt has a separate receipt so that reruns and title generation share the same spending limits. An invalid model answer gets at most one format correction after another budget check.

Structured notices retain source order. Each nonempty scalar is rendered with its field path. Lists keep their order, and lxml extracts its visible text and public links. A clipped JSON fragment remains readable text. The readability check uses the rendered body after URL cleaning and the input limit. The model reads the same text used to validate quotes, including original quotation marks, Unicode and precise numbers. Every answer supplies a title quote separately from the other facts. Both recommended notices and those awaiting review are assessed for all supported facts. An assessment returns source-language fields with exact quotations, plus a bilingual recommendation: `recommend`, `exclude` or `needs_review`. The extraction boundary checks quotations, supplied URLs, monetary values/currency, date consistency and allowed taxonomy labels. Unknown fields remain empty. Quotes and unresolved claims are retained in `evidence_note`; AI extraction still passes through verification and geocoding. Linked PDFs are not read by this path.

A notice version includes its URL and content. A finished judgment also identifies the requirement text, model-facing schema and its version, provider, model and reasoning effort. Changes invalidate reuse. The field contract generates the remaining field names in the schema and their formats and permitted labels in the system instructions. Only vocabularies used by extracted facts enter the request. Each taxonomy-backed name points to its list in the taxonomy file. The validator uses the same mapping and ignores case and whitespace differences when resolving a label. A change to a permitted label changes the judgment identity and remains subject to paid reading limits.

The worker collects each source before paid reading. Its private SQLite queue preserves pending notices beyond the discovery window. The worker saves the current page or row together with discovered notices. A historical search advances through bounded date windows. Live feeds can only return their current listings. When a requested interval is unavailable, its dates stay in the worker database and run report. HTML fingerprints use visible text and links. Navigation, hidden elements and site footers are excluded. Dates in the notice body and article footers remain part of its identity. Structured feeds discard known request metadata before hashing. Collection-only runs report new notices, text lengths, a lower bound on unfinished pages and the age of the oldest queued notice.

Adapter-generated classifications and evidence annotations are removed from model notice evidence. Normalized record classifications are also excluded from the evidence fields; they must not create a supposed conflict with an explicit supply/works notice. Collection/landing URLs are retained as discovery trails but cannot establish a project-specific official website.

Where an adapter supplies `rawNoticeHtml` or `rawNotice`, the model receives that original content rather than locally guessed fields. API adapters preserve original records so an upstream field rename cannot silently erase the only usable title or qualification clause. A source JSON object supplied directly is itself the notice. The worker identifies collector envelopes at its ingestion and rescreening entry points, where the raw sections contain the authoritative source material. For older adapter rows without raw sections, the worker retains copied listing fields and omits local classifications. Details appended after a JSON notice are also read.

SIMAP uses the publication window and rolling pagination. Its collection request has no procedure or design-code filter.

The daily batch discovers up to 2,000 notices and 40 listing pages per source and run, within seven calendar days by default. Each source has a separate allowance of 100 paid readings per UTC day, shared across runs. The reading pass visits each source once and takes its oldest eligible notices first. A budget or provider quota pause leaves the remaining notices in the worker database without using a notice attempt. A run spanning midnight still has one daily spending allowance. Three unusable answers or notice-specific errors stop retries for that version. Site blocks, service outages and busy locks defer the notice for one hour on the first failure, doubling to a 24-hour ceiling. A broken pagination cursor gets one restart inside the same discovery allowance. Repeated pages leave a dated coverage gap and reset the cursor. The report names the source and error. A known past deadline or 30 days waiting retires an unread notice before a paid call. A usable listing can supply evidence when its detail page is blocked, and the assessment records that limitation.

The same detail response extracts source-backed participation excerpts under five categories: timeline, commercial, eligibility, scope and submission. These are short original-language clauses, not inferred qualification decisions. They live in `ai_screening_results.result_json.notice_details`; the detail read model validates their shape and displays only the current source revision. Country, source notice id and languages can also be normalized when the notice explicitly supports them.

The detail view is one body (`opportunity-detail-body.tsx`) shown two ways: as a side sheet over the list, and as the standalone page for a direct visit or shared link. The sheet opens at once from the list item already on screen (a history entry, not a navigation, so the list keeps its place), then fills in the AI overview and excerpts from `GET /api/opportunities/[slug]`, which is public, one batched read and cacheable (`max-age=60, s-maxage=300`); hovering a card starts that request. Order: image, title, four decisive facts (deadline with days left, value, location, issuer), actions, AI overview and reasons, participation excerpts, conditions, what the notice does not state, project type, and a folded source section. Internal scores and extraction metrics are not shown.

Success means a source-grounded title and usable candidate record, not complete bid eligibility. Missing price/address/qualification fields do not invalidate a record. Unsupported individual fields or participation excerpts are omitted without overriding the model's content judgment; input limitations remain visible. A recommendation with any unsupported decision quote, and any decision with no supported quote, becomes `needs_review`; an `exclude` that keeps at least one verified quote stays `exclude`, and source casing is restored in quotations. Malformed/incomplete responses, API failures and a missing supported title remain failures. `recommend` means worth further review. Source facts and their published assessment are written atomically to preserve the source-revision check.

`ai_screening_runs` is a local ledger and exact-input cache. Source-specific AI locks serialize requests for the same source across checkouts; each reservation is checked and written in one database transaction so concurrent sources, and concurrent assessments within one ingest, share the daily/monthly ceiling. Ambiguous network outcomes retain their reservation. Rate limits allow up to three retries with bounded backoff and a numeric Retry-After of up to 60 seconds. Anthropic server errors (including 529) use the same retry limit. The worker preauthorizes four attempts for Anthropic, retains one attempt’s reserve per ambiguous outcome and releases unused headroom. Other client errors receive no retry. A rejected credential, HTTP 402 or an explicitly typed billing or credit error pauses the batch. Untyped payment wording in an ordinary HTTP 400 stays a reported error. One HTTP 400 defers that notice without counting an attempt, and three in a row in one source pause the batch, because they point at the account or request shape. A request timeout counts as that notice's failure and does not pause the batch; connection errors and 5xx still do. Screening and titles share the same provider retry and reservation policy. The queue separately schedules deferred work across runs.

Within one source's ingest the detailed assessments run on `ai_concurrency` threads (default 1; the cloud workflow uses 8), each with its own client, holding the source lock once for the whole pass. Results are consumed in input order, so parsing, verification, geocoding (paced for Nominatim) and storage stay sequential. Budget exhaustion, provider quota exhaustion and a persistent rate limit pause the whole batch: notices not yet started are deferred, and one that finished after the stop point in input order is left for the next run, which reuses its stored result at no cost. The default estimated limits are USD 5 per UTC day and USD 100 per UTC calendar month across models. Haiku reserves 1.7 times the UTF-8 byte count of the full request plus framing headroom, and the maximum output (16,000 tokens by default). Accounting includes cache reads and writes in total input. For prompts up to 100,000 tokens, cached reads cost USD 0.01 per million, ordinary and cache-creation input are budgeted at USD 0.10, and output at USD 0.50. The provider’s invoice is authoritative.

`ai_screening_results` is the latest published assessment per opportunity and is exported to D1. A newly excluded notice completes the private queue without creating an opportunity. When a notice matches an existing opportunity, its current exclusion is published without modifying the stored facts or human status. Discovery hides `exclude` only while its source revision matches the record; `shortlisted` and `verified` human statuses remain visible. Detail and watchlist lookups keep access to the record. The ledger, full prompts and API key are not exported. A failed assessment is reported as a document failure rather than silently substituting rule-based extraction.

Retention is one daily cleanup (`cleanup-expired-competitions`, at most once per calendar day). It deletes opportunities whose deadline passed more than `expired_competition_retention_days` (7) ago, and opportunities whose current assessment is `exclude` and more than the same 7 days old, together with their cached preview images. Watchlists protect against both cleanup rules. Shortlisted and verified records also survive exclusion cleanup; an exclusion made for an older source revision does not count. The items registry marks excluded notices as screened, so deleting the record does not cause a re-screen. Completed queue payloads are cleared after 45 days and their registry entries after 400 days. A separate best-effort workflow step creates bilingual display titles with the selected provider and the shared spending limits.

The same pass blanks the stored prompt and result (`input_json`, `result_json`) of `ai_screening_runs` rows older than 45 days and keeps the rows, so spend accounting is unchanged; blanked rows no longer serve as cache hits.

AI supplies quoted project address, city, region and country components, never coordinates. The existing Nominatim geocoder tries the stated location and progressively coarser components, keeping the original address. Unicode location keys preserve Chinese place names. Fallbacks use `nominatim:area` or `nominatim:country` with capped confidence, so the detail page can label the approximate coverage and link to a map. Cache writes merge independent source workers' snapshots atomically. The geocoder is limited to the record's country, so a record whose jurisdiction is not a country used to be skipped without a trace; `countries.py` now reads the country from the notice (see `docs/DATA_CONTRACT.md`) and `get_country_label_for_jurisdiction` / `get_country_code_for_jurisdiction` fall back to the country registry for every country, not only the 41 targeted jurisdictions.

Queries include available city/region context and reject results that drop the supplied place components; cache keys use the v2 lookup algorithm. Country-only coordinates never fill the project address. Coordinate refreshes atomically rebase already-current advice to the new derived-data timestamp; stale advice remains stale, and the original assessment time is retained.

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
