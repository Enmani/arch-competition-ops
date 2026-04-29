---
title: Saved Search And Watchlists Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
structure_doc: docs/structures/2026-04-22-workspace-follow-up-architecture.md
status: 已完成
updated_at: 2026-04-22
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md
  - docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md
  - docs/AI_CONSTRAINTS.md
---

# Saved Search And Watchlists Plan

> Expected Outcome: Teams can persist high-value discovery filters and mark specific opportunities for follow-up without rebuilding the same screen every session. This round adds storage-owned saved searches and watchlists, plus discover-facing controls to create and revisit them. It does not yet send proactive alerts or become a generic CRM.

## Completed State Snapshot

- Discover already reads one storage-owned surface bundle through `getStoredDiscoverSurfaceData()` and should stay on that path.
- `apps/web/src/lib/discover.ts` now owns both canonical discover query parsing and saved-search URL serialization.
- Workspace tables now live in `apps/worker/src/arch_competition_ops/storage/database.py`, and the web-facing read/write contract lives in `packages/storage/src/watchlists.ts`.
- Discover and detail surfaces now expose watch controls, while the existing dashboard renders watched opportunities as the secondary follow-up surface.
- Workspace writes still stay behind `ARCH_ENABLE_WORKSPACE_WRITES`, with explicit read-only behavior when the flag is off.

## This Round

### In Scope

- storage-owned saved-search and watchlist records
- web API entry points for create, list, and remove actions
- discover and opportunity surfaces for saving filters and watching records
- bilingual UI copy for the new controls

### Out Of Scope

- email or SMS delivery
- shared team mentions or comments
- full pursuit workflow
- open public submission

### V1 Operating Assumption

- this round ships as a single-practice local workspace with one implicit `workspace_key`
- it does not add sign-in, multi-user sharing, or cross-practice permissions
- mutations stay disabled unless `ARCH_ENABLE_WORKSPACE_WRITES` is enabled

## Success Criteria

- a discover filter set can be saved and loaded without reconstructing the URL by hand
- an opportunity can be added to or removed from a watchlist from existing browse or detail surfaces
- saved-search and watchlist state is owned by storage-layer helpers, not component-local logic
- saved-search and watchlist persistence lives in shared database tables that later worker-side alert plans can read without scraping web state
- the plan has one workspace truth owner and an explicit read-only off-state when workspace writes are disabled
- locale-aware routing and query state remain intact on port `3400`

## Execution Order

## Task 1: Define the local workspace plus saved-search/watchlist contract
**Goal**  
Create one storage-owned contract for persisted discover state and watched opportunities inside the current local workspace scope.

**Files**  
`apps/worker/src/arch_competition_ops/storage/database.py`  
`packages/storage/src/watchlists.ts`  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`

**Execute**  
Add dedicated workspace tables in `apps/worker/src/arch_competition_ops/storage/database.py`, then add exact read and write helpers for saved searches and watchlist entries in a new `watchlists.ts` owner file. Store canonical filter inputs instead of rendered labels, key the records by one implicit `workspace_key`, and persist them into dedicated workspace tables rather than overloading `competitions`. This round does not add user tables or auth; the resolver should default to one local-practice scope and export a compact contract through `packages/storage/src/index.ts` so the web app does not assemble persistence logic itself.

**Pass Criteria**  
Saved-search and watchlist state has one owner, and the web layer can read it without direct database access.

**Verify**  
Run `npm run test:storage`.

## Task 2: Add API routes for saved-search and watchlist mutations
**Goal**  
Expose one web-side mutation path that reuses storage helpers instead of inventing a second persistence layer.

**Files**  
`apps/web/src/app/api/saved-searches/route.ts`  
`apps/web/src/app/api/watchlists/route.ts`  
`apps/web/src/lib/workspace.ts`

**Execute**  
Create route handlers for creating, listing, and deleting saved searches and watched opportunities. Parse input with the same discover-filter semantics already used by `apps/web/src/lib/discover.ts`, resolve the current local workspace through `apps/web/src/lib/workspace.ts`, and reject writes when `ARCH_ENABLE_WORKSPACE_WRITES` is off. Keep response shapes narrow and aligned with the new storage contract.

**Pass Criteria**  
Mutations flow through API routes into storage-owned helpers with no component-side write logic, and the read-only fallback is explicit when workspace writes are disabled.

**Verify**  
Run `npm run build:web`.

## Task 3: Extend the discover dock with saved-search actions
**Goal**  
Let users save and reapply filter sets from the existing discover entry surface.

**Files**  
`apps/web/src/components/discover-dock.tsx`  
`apps/web/src/components/discover-surface.tsx`  
`apps/web/src/components/discover-saved-searches.tsx`  
`apps/web/src/lib/discover.ts`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Reuse the current discover dock in `apps/web/src/components/discover-dock.tsx` and add a lightweight saved-search rail beside or below the existing filter controls. The current discover page now reads one storage-owned surface bundle through `getStoredDiscoverSurfaceData()` in `apps/web/src/components/discover-surface.tsx`; keep that path intact and do not reintroduce separate feed/filter reads while adding saved-search data. Move serialization and parsing details into `apps/web/src/lib/discover.ts`, keep new copy in `dictionaries.ts`, and avoid adding a second filter shell or dashboard-only control cluster.

**Pass Criteria**  
Users can save the current filter set, reapply a saved filter, and keep locale-aware discover URLs stable.

**Verify**  
Run `npm run lint:web` and manual browser review on port `3400`.

## Task 4: Add watchlist controls to the existing opportunity surfaces
**Goal**  
Make watchlist actions available where users already screen opportunities.

**Files**  
`apps/web/src/components/opportunity-stream-item.tsx`  
`apps/web/src/components/opportunity-detail-surface.tsx`  
`apps/web/src/app/[locale]/dashboard/page.tsx`  
`packages/storage/src/watchlists.ts`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Add a compact watch action to the current feed item and detail surface, then show watched opportunities in the existing dashboard table rather than inventing a separate workspace in this round. Keep discover as the primary screening route and treat the dashboard as a secondary follow-up surface until the pursuit workspace plan lands. Do not expand the dashboard into a full pursuit editor here.

**Pass Criteria**  
Users can watch or unwatch opportunities from screening surfaces and see watched items reflected in the dashboard.

**Verify**  
Run `npm run lint:web`, `npm run build:web`, and manual browser review on port `3400`.

## Rollout Controls

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `ARCH_ENABLE_WORKSPACE_WRITES` | Discover, detail, and dashboard stay read-only; save/watch controls are hidden or disabled; mutation routes reject writes. | One implicit local workspace can create, list, and remove saved searches and watchlist entries. |

## Risks And Rollback

- If auth lands sooner than expected, swap the implicit workspace resolver behind the same contract instead of rewriting the UI flows.
- If discover UI density regresses, keep saved-search management collapsed under the existing dock instead of adding a new panel.
- If watchlists start pulling the dashboard toward a generic CRM, limit v1 to shortlist-only state.

## Execution Notes

- Borrow the current discover shell from `apps/web/src/components/discover-dock.tsx` and `apps/web/src/components/discover-surface.tsx`.
- Borrow the current follow-up entry surface from `apps/web/src/app/[locale]/dashboard/page.tsx`, but do not let it replace discover as the main browse entry.
- Schema creation still lives in the worker storage owner even though the web app writes through `packages/storage`.
- Saved filters must preserve canonical query semantics, not translated labels.

## Verification Evidence

- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `uv run pytest apps/worker/tests/test_storage.py`
- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
