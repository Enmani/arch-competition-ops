---
title: Near-Term Product Roadmap
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: done
updated_at: 2026-04-19
related_docs:
  - docs/ARCHITECTURE.md
  - docs/AI_CONSTRAINTS.md
  - docs/goals/2026-04-19-future-direction.md
  - docs/research/2026-04-19-ai-era-disruption-and-strategy.md
  - docs/research/2026-04-19-monetization-models-and-government-distribution.md
  - docs/research/2026-04-19-posting-entry-and-product-boundary.md
---

# Near-Term Product Roadmap

> Expected Outcome: The product becomes a stronger AI-first procurement intelligence surface for architects. It should ingest more official opportunities, normalize them better, help teams decide `bid / no-bid`, support follow-up workflow, and create the first credible paths to monetization. This roadmap does not turn the product into a homeowner marketplace or a generic posting board.

## This Round

### In Scope

- Stronger official-source coverage
- Better parsing, normalization, and evidence quality
- Qualification scoring and decision support
- Watchlists, alerts, and team workflow
- Ops review flows for trust and data quality
- Verified submission intake for future distribution and growth

### Out Of Scope

- Homeowner renovation marketplace
- Ratings/reviews trust model
- Quote comparison and payments
- Generic CRM expansion
- Open public posting directly into discover

## Success Criteria

- Official-source coverage materially expands across target jurisdictions
- Core opportunity records expose cleaner procedure, value, deadline, and qualification fields
- Users can save filters, watch opportunities, and receive alerts
- Teams can mark, triage, and track pursuit decisions in-product
- Low-confidence or conflicting records are visible in an operator review queue
- Verified external submissions can enter review without bypassing canonical normalization

## Execution Order

### Phase 1: Data Foundation

## Task 1: Expand official source coverage
**Goal**  
Add more official procurement and authority sources so discovery depth improves before higher-layer features depend on it.

**Files**  
`config/source_packs/countries/*.yml`  
`apps/worker/src/arch_competition_ops/collectors/*`  
`apps/worker/src/arch_competition_ops/extractors/*`  
`apps/worker/src/arch_competition_ops/country_packs.py`

**Execute**  
Prioritize additional target jurisdictions and authority pages that match public design opportunities. Keep `config/sources.yml` thin, land country-specific source definitions in `config/source_packs/countries/*.yml`, reuse collector families before source-id-specific branches, and keep blocked official sources scaffold-only instead of pretending they are live.

**Pass Criteria**  
New official sources are represented through country packs and can feed the worker pipeline without introducing parallel ingestion logic. Coverage reporting can distinguish enabled, scaffold-only, and empty country packs.

**Verify**  
Run `uv run arch-competition-ops doctor`, `uv run arch-competition-ops verify`, and `uv run arch-competition-ops show-country-coverage`.

## Task 2: Improve parser reliability and freshness visibility
**Goal**  
Reduce parser failures, stale records, and silent source regressions.

**Files**  
`apps/worker/src/arch_competition_ops/*`  
`apps/web/src/app/[locale]/ops/page.tsx`  
`packages/storage/src/index.ts`

**Execute**  
Add clearer source freshness, parser failure, and duplicate visibility to the ops surface while tightening extraction behavior in the worker.

**Pass Criteria**  
Operators can see where source coverage is stale or failing, and parser regressions are easier to diagnose.

**Verify**  
Run `uv run arch-competition-ops doctor`, `uv run arch-competition-ops verify`, and `npm run build:web`.

## Task 3: Deepen canonical normalization
**Goal**  
Strengthen the normalized contract for procedure type, implementation path, qualification signals, official notice identity, value, and deadline quality.

**Files**  
`config/taxonomy.yml`  
`packages/storage/src/index.ts`  
`apps/worker/src/arch_competition_ops/*`  
`packages/core/src/*`

**Execute**  
Extend the current normalized schema only through worker and storage ownership. Keep unknown fields explicit rather than inferred.

**Pass Criteria**  
The web surface can rely on cleaner normalized keys and fewer fallback-only labels.

**Verify**  
Run `npm run test:storage`, `uv run arch-competition-ops verify`, and `npm run build:web`.

### Phase 2: Decision Intelligence

## Task 4: Ship qualification scoring v1
**Goal**  
Give each opportunity a clearer professional-value score with explainable signals.

**Files**  
`apps/worker/src/arch_competition_ops/*`  
`packages/storage/src/index.ts`  
`apps/web/src/components/opportunity-stream-item.tsx`  
`apps/web/src/components/opportunity-detail-surface.tsx`

**Execute**  
Define score inputs and reason codes from normalized facts, then expose them in feed and detail surfaces without inventing unsupported conclusions.

**Pass Criteria**  
Users can see not only a score, but why the score is high or low.

**Verify**  
Run `npm run test:storage`, `npm run lint:web`, and `npm run build:web`.

## Task 5: Build bid/no-bid assistant v1
**Goal**  
Turn the product from a listing surface into a decision surface.

**Files**  
`packages/storage/src/index.ts`  
`apps/web/src/components/opportunity-detail-surface.tsx`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Generate a structured summary that answers relevance, qualification fit, evidence confidence, and implementation path using only normalized facts and explicit uncertainty.

**Pass Criteria**  
A user can open a record and quickly understand whether it is worth further pursuit.

**Verify**  
Run `npm run test:storage`, `npm run lint:web`, and manual browser review on port `3400`.

### Phase 3: Team Workflow

## Task 6: Add saved search and watchlists
**Goal**  
Let teams persist high-value discovery patterns instead of rebuilding filters every session.

**Files**  
`apps/web/src/lib/discover.ts`  
`apps/web/src/app/[locale]/discover/page.tsx`  
`apps/web/src/components/discover-dock.tsx`  
Future owner: practice-facing storage path

**Execute**  
Introduce a lightweight watchlist and saved-filter model that fits the current discover workflow and locale routing.

**Pass Criteria**  
A user can save a filter set and return to it without reconstructing the same screen.

**Verify**  
Run `npm run lint:web`, `npm run build:web`, and browser-check locale switching plus query persistence.

## Task 7: Add alerts and digests
**Goal**  
Convert saved discovery state into proactive user value.

**Files**  
`apps/web/src/*`  
`packages/storage/src/index.ts`  
Worker-side delivery owner to be defined in the next plan

**Execute**  
Create the first alert model for new matches, deadline proximity, and important record changes.

**Pass Criteria**  
The product can represent alertable states and define digest-worthy events even if delivery starts simple.

**Verify**  
Run `npm run test:storage` and `npm run build:web`.

## Task 8: Build pursuit workspace v1
**Goal**  
Support team triage, notes, status, and next actions around shortlisted opportunities.

**Files**  
`apps/web/src/app/[locale]/dashboard/page.tsx`  
`apps/web/src/i18n/dictionaries.ts`  
`packages/storage/src/index.ts`

**Execute**  
Evolve the current dashboard from a static table into a practice-facing pursuit workspace with basic collaboration state.

**Pass Criteria**  
Teams can move from browse to shortlist to next-action tracking without leaving the product.

**Verify**  
Run `npm run lint:web`, `npm run build:web`, and browser review of dashboard flows.

### Phase 4: Trust, Supply, and Monetization Readiness

## Task 9: Build ops review queue
**Goal**  
Create an explicit operator surface for conflicts, duplicates, and low-confidence records.

**Files**  
`apps/web/src/app/[locale]/ops/page.tsx`  
`packages/storage/src/index.ts`  
`apps/worker/src/arch_competition_ops/*`

**Execute**  
Turn the current ops surface into a usable review queue for canonical trust maintenance.

**Pass Criteria**  
Operators can see and work through the records that most need review.

**Verify**  
Run `uv run arch-competition-ops verify`, `npm run test:storage`, and `npm run build:web`.

## Task 10: Add verified submission intake
**Goal**  
Open a controlled path for official opportunity submissions and external leads without weakening canonical evidence rules.

**Files**  
`apps/web/src/app/[locale]/*`  
`apps/web/src/i18n/dictionaries.ts`  
`apps/worker/src/arch_competition_ops/*`  
`packages/storage/src/index.ts`

**Execute**  
Create a submission intake that collects official URLs and source evidence, then routes all submissions into review instead of publishing directly.

**Pass Criteria**  
External submissions can enter the system safely and visibly, but the public feed still depends on verified normalized records.

**Verify**  
Run `npm run lint:web`, `npm run build:web`, and `uv run arch-competition-ops verify`.

## Risks And Rollback

- If source expansion reduces data quality, pause source growth and prioritize parser stability.
- If qualification scoring introduces overconfident output, reduce it to explicit signals and reason codes before expanding summaries.
- If workflow features start to resemble a generic CRM, cut back to pursuit-specific state only.
- If submission intake increases noise faster than review capacity, keep it invite-only or authority-only.

## Execution Notes

- Keep all factual truth inside worker normalization and storage reads.
- Do not add direct UI-side fact invention to accelerate product polish.
- Do not mix homeowner demand flows into this roadmap.
- Preserve locale-aware routing and bilingual copy for every new user-facing surface.
- Keep web development on port `3400`.

## Verification Evidence

- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
