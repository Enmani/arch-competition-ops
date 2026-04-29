---
title: Architecture
status: 已完成
updated_at: 2026-04-20
related_docs:
  - vision.md
  - docs/AI_CONSTRAINTS.md
  - README.md
---

# Architecture

## Product Position

This repository is not a generic architecture competition directory.

It is a professional opportunity radar for licensed architects and established design teams who need public-sector opportunities with a credible path to implementation.

The product is built around one operating assumption:

- official procurement and contracting sources matter more than media visibility

That means the platform prefers:

- design contest notices
- design service procurement
- framework agreements
- negotiated follow-on appointments after competitions

And it explicitly downgrades:

- speculative idea contests
- student-only competitions
- publicity-driven calls with no downstream commission path

## User Model

Primary user:

- licensed architect
- established studio or emerging practice with professional qualification
- searching for public opportunities that can lead to built work or design service revenue

Secondary user:

- practice manager
- business development lead
- competition coordinator

## Architecture Overview

```text
official procurement portals + authority pages + secondary discovery sources
                                |
                                v
                     apps/worker ingestion pipeline
       collect -> parse -> normalize -> qualify -> verify -> persist
                                |
                                v
                     canonical structured opportunity store
                                |
              +-----------------+-----------------+
              |                                   |
              v                                   v
        apps/web public surface             apps/web operator surface
    discover / detail / search           dashboard / ops / review flows
```

## System Boundaries

### `apps/worker`

Owns:

- source registry loading
- procurement and authority page collection
- field extraction
- normalization into the canonical schema
- qualification scoring
- verification state transitions
- SQLite persistence for local-first development

Does not own:

- frontend presentation
- public search experience
- auth and per-user state

### `apps/web`

Owns:

- public discovery pages
- opportunity detail pages
- private practice-facing dashboard
- ops and verification UI
- API routes for UI consumption

Does not own:

- source truth generation
- procurement fact inference
- source parsing logic

### `packages/core`

Owns:

- shared TypeScript contracts for UI-facing opportunity objects
- shared sample and seed shapes for frontend development
- summary-level derived helpers used by the web app

### `packages/storage`

Owns:

- server-side SQLite reads for the web app
- row-to-contract mapping between worker persistence and UI objects
- fallback behavior when the canonical store is unavailable

### `config/*`

Owns:

- source registration
- targeting preferences
- controlled vocabulary and taxonomy

## Source Strategy

The platform uses a tiered source model.

### Tier 1: Primary official procurement

Examples:

- TED
- BOAMP
- simap
- ANAC / BDNCP
- national public contract hubs

Use:

- first-pass ingestion
- official notice IDs
- procedure type detection
- procurement fact verification

### Tier 2: Primary authority pages

Examples:

- buyer profiles
- municipal procurement pages
- regional agency tender pages

Use:

- confirm attachments and addenda
- verify dossier links
- capture local qualification constraints

### Tier 3: Secondary discovery

Examples:

- aggregators
- media listings
- professional association roundups

Use:

- discovery hints only
- never final authority for critical facts

## Canonical Opportunity Model

The platform should treat the canonical object as a professional design opportunity, not merely a competition listing.

Minimum core fields:

- `title`
- `authority_name`
- `organizer`
- `official_url`
- `source_url`
- `official_notice_id`
- `jurisdiction`
- `opportunity_type`
- `procedure_type`
- `competition_types`
- `cpv_codes`
- `implementation_path`
- `licensed_architect_required`
- `local_partner_required`
- `registration_fee_eur`
- `submission_fee_eur`
- `estimated_contract_value_eur`
- `estimated_contract_value_text`
- `deadline_at`
- `eligibility_summary`
- `evidence_level`
- `qualification_score`
- `status`

Why this matters:

- `competition` is too narrow
- public-sector architectural work often appears as procurement, not as branded competitions
- qualification fit and implementation route are more valuable than aesthetic category labels

## Qualification Model

The platform should rank opportunities by professional value, not by surface popularity.

### Strong positive signals

- official procurement notice exists
- contracting authority is explicit
- procedure type is explicit
- downstream implementation route exists
- architect qualification is required or strongly implied
- budget or service value is visible
- dossier or brief is available

### Negative signals

- participation fee with no implementation path
- student-only or open-to-all call
- no identifiable authority
- no notice identifier
- no contract continuation or built-work path
- rights-heavy publicity contests

### Output

Use a `qualification_score` in the data layer and expose it where it supports judgment, especially in operator views and selected public detail contexts.

This score is not a beauty score. It is a professional viability score.

## Worker Pipeline

### 1. Discovery

Read `config/sources.yml` and collect candidate records from enabled primary and secondary sources.

### 2. Parsing

Extract:

- authority
- notice type
- deadlines
- qualification signals
- contract value signals
- implementation path

### 3. Normalization

Map multilingual procurement wording into canonical labels:

- `concorso di progettazione`
- `avis de concours`
- `maitrise d'oeuvre`
- `design contest notice`
- `planning competition`

For commercial value:

- keep `estimated_contract_value_eur` only when the source amount is explicitly EUR or already normalized to EUR by the source
- keep `estimated_contract_value_text` for the official raw amount signal when the source is explicit but uses another currency or only exposes a display string
- do not coerce native-currency source amounts into EUR without an explicit upstream EUR value

### 4. Qualification

Apply procurement-first ranking and downrank speculative calls.

### 5. Verification

Where secondary discovery conflicts with official sources, official sources win and the conflict is preserved in `evidence_note`.

### 6. Persistence

Store normalized opportunities in SQLite during local development. The schema should remain compatible with later migration to Postgres.

## Web Surface

The public browse experience is intentionally split in two:

- `discover` optimizes for fast first-pass screening
- `detail` owns the expanded record, evidence, and qualification context

### Public discovery

Needs:

- compact image-led opportunity cards for first-pass screening
- jurisdiction filters
- procedure filters
- qualification-oriented sorting
- visible title, location, deadline, and value at scan speed
- clear separation between verified and merely discovered records
- direct handoff into the detail page for the full record

### Opportunity detail

Needs:

- authority and procedure
- implementation route
- full qualification requirements
- full commercial signal and participation cost context
- evidence note and evidence-trace context
- official links

### Practice dashboard

Needs:

- shortlist state
- reminders
- teaming notes
- jurisdictional watchlists
- AI briefing based on verified facts

### Ops console

Needs:

- source freshness
- parser failure tracking
- duplicate clusters
- verification backlog
- primary-source coverage by jurisdiction

## Persistence Strategy

Current local-first persistence:

- SQLite in `data/competitions.sqlite`

Planned evolution:

- move the canonical application store to Postgres
- keep raw fetched artifacts outside the application database
- retain a clear separation between raw artifacts, normalized records, and derived summaries

## Why This Architecture

This structure avoids the main failure mode of architecture competition products:

- looking broad but being unusable for real practices

The system is intentionally narrow:

- official-source-first
- qualification-aware
- implementation-oriented

That constraint is the product advantage.
