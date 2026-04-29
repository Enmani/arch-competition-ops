---
title: Alerts And Digests Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
structure_doc: docs/structures/2026-04-22-workspace-follow-up-architecture.md
status: 未实施
updated_at: 2026-04-22
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md
  - docs/plans/已完成-2026-04-19-02-parser-reliability-and-freshness-visibility-plan.md
---

# Alerts And Digests Plan

> Expected Outcome: Saved searches and watchlists can generate structured alert events for new matches, deadline proximity, and important record changes, and users can review those events in a first digest surface. This round establishes the event model and in-product digest flow. It does not add email providers, SMS, or marketing automation.

## Current Baseline

- No alert or digest tables exist yet.
- The worker already owns the background lifecycle for canonical data health and ops review refresh, so alert evaluation should hook into that runtime rather than into web requests.
- `apps/web/src/app/[locale]/dashboard/page.tsx` already resolves the implicit workspace, joins `queryStoredWatchlistEntries()` to `getStoredOpportunityFeedItemBySlug()`, and renders watched opportunities through `WatchlistDashboardTable`.
- The dashboard is already the watchlist-backed secondary follow-up surface, while ops review remains a separate trust-maintenance surface.
- This plan depends on the workspace and watchlist truth from plan 07.

## This Round

### In Scope

- alert-event and digest-entry contracts
- worker-side evaluation of saved searches, watched records, and deadline changes
- digest presentation and basic alert preferences on a secondary follow-up route
- bilingual product copy for alert states

### Out Of Scope

- email delivery infrastructure
- push notifications
- campaign messaging
- AI-written summary prose

### V1 Operating Assumption

- this plan reuses the implicit local-workspace scope defined in `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
- saved-search and watchlist writes must already be available before alert generation runs
- digest presentation stays disabled unless `ARCH_ENABLE_ALERTS_DIGEST` is enabled

## Success Criteria

- the system can derive alert events from canonical opportunity changes and saved filters
- alert generation runs through the worker or storage path, not component-side polling logic
- users can review digest-worthy events from the localized product surface
- alert preferences and digest entries remain traceable to exact saved searches or watched records
- alert events stay keyed to one workspace truth owner instead of inventing per-user state that the repo does not yet have
- the dashboard digest layer does not regress the existing watched-opportunity table into a digest-only screen

## Execution Order

## Task 1: Define the alert and digest data contract
**Goal**  
Create one storage-facing model for alert events, digest entries, and user preferences.

**Files**  
`apps/worker/src/arch_competition_ops/storage/database.py`  
`packages/storage/src/alerts.ts`  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`

**Execute**  
Add dedicated alert and digest tables in `apps/worker/src/arch_competition_ops/storage/database.py`, then add a dedicated `alerts.ts` owner file for alert-event reads and web-facing acknowledgement or preference writes. Define event types for new-match, deadline-near, and record-updated cases, along with the originating saved-search or watchlist reference plus the implicit `workspace_key`. Export only the contract the web app needs for digest rendering and preference updates.

**Pass Criteria**  
Alert state is stored and queried through one storage module, with no UI-side event derivation.

**Verify**  
Run `npm run test:storage`.

## Task 2: Evaluate alert events in the worker pipeline
**Goal**  
Turn canonical record changes into reusable alert events without adding a second ingestion path.

**Files**  
`apps/worker/src/arch_competition_ops/alerts/evaluator.py`  
`apps/worker/src/arch_competition_ops/operations.py`  
`apps/worker/src/arch_competition_ops/cli.py`  
`apps/worker/src/arch_competition_ops/storage/database.py`

**Execute**  
Create a worker-side evaluator that compares the latest normalized opportunity set against saved-search and watchlist state, then writes alert events through the Python persistence layer into the shared alert tables that `packages/storage/src/alerts.ts` reads. Register an explicit CLI or operations entry for alert evaluation so digest generation can run in the existing worker lifecycle without piggybacking on a web request. Do not assume the worker can call TypeScript storage helpers directly.

**Pass Criteria**  
Alert generation is reproducible, runs off canonical records, and can be invoked without web-side scraping or polling.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 3: Add digest review and preference controls to the dashboard follow-up route
**Goal**  
Expose proactive value in the current localized product surface without inventing a new dashboard system.

**Files**  
`apps/web/src/app/[locale]/dashboard/page.tsx`  
`apps/web/src/components/alert-digest-panel.tsx`  
`apps/web/src/components/alert-preferences-form.tsx`  
`apps/web/src/components/watchlist-dashboard-table.tsx`  
`packages/storage/src/alerts.ts`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Extend the current dashboard page, which already renders a watched-opportunity table plus roadmap panel, with a digest panel for recent alert events and simple preference controls. Keep the visual language operational and information-dense, reuse the existing dashboard page as the digest entry point, preserve the current watched-opportunity follow-up flow and unwatch action, and keep discover as the primary browse route. Avoid routing digest reads through ops-review helpers or other trust-only surfaces.

**Pass Criteria**  
Users can open `/[locale]/dashboard` and review recent alert events tied to saved searches or watched opportunities.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Task 4: Add API routes for preference and digest acknowledgement state
**Goal**  
Give the web app one mutation path for alert settings and read-state changes.

**Files**  
`apps/web/src/app/api/alerts/route.ts`  
`apps/web/src/app/api/alerts/preferences/route.ts`  
`apps/web/src/lib/workspace.ts`

**Execute**  
Add API routes for reading digest entries, marking them seen, and updating simple preference flags. Reuse the workspace resolver introduced by `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`, gate mutation behavior behind `ARCH_ENABLE_ALERTS_DIGEST`, keep delivery-channel fields narrow so the product can stay in-app first, and wire the routes to storage helpers rather than direct SQL in the handlers. Keep these routes separate from the existing ops-review APIs and feature flag.

**Pass Criteria**  
Alert read state and preferences update through stable API contracts and storage helpers.

**Verify**  
Run `npm run build:web`.

## Rollout Controls

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `ARCH_ENABLE_WORKSPACE_WRITES` | Saved searches and watchlists stay read-only, so the worker skips alert evaluation entirely. | Workspace state can feed alert evaluation. |
| `ARCH_ENABLE_ALERTS_DIGEST` | Dashboard hides digest and preference controls; alert routes reject mutations; worker may skip event generation. | Local in-product digest, acknowledgement, and simple preference controls become available. |

## Risks And Rollback

- If event volume is too noisy, keep only deadline-near and new-match cases in v1.
- If dashboard density becomes too high, collapse digest rows behind a count and latest-event preview.
- If worker evaluation becomes expensive, schedule only incremental comparisons keyed by captured record changes.

## Execution Notes

- This plan depends on saved-search and watchlist truth from `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`.
- Keep alerts operational and evidence-first; do not turn digests into marketing copy.
- The worker owns event generation; the web layer only reads and acknowledges alert state.
- Delivery stays in-product until the event model proves useful.
- Keep the current watched-opportunity table visible on `/[locale]/dashboard` unless a later canonical plan explicitly retires that follow-up surface.

## Verification Evidence

- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
