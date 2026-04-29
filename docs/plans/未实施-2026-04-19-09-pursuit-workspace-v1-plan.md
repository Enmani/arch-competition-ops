---
title: Pursuit Workspace V1 Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
structure_doc: docs/structures/2026-04-22-workspace-follow-up-architecture.md
status: 未实施
updated_at: 2026-04-22
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md
  - docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md
  - docs/AI_CONSTRAINTS.md
---

# Pursuit Workspace V1 Plan

> Expected Outcome: The dashboard evolves from a static list into a lightweight pursuit workspace where teams can shortlist opportunities, assign a pursuit stage, capture notes, and track the next action. This round supports real follow-up work after discovery while staying procurement-first and narrow. It does not become a general project-management suite.

## Current Baseline

- `apps/web/src/app/[locale]/dashboard/page.tsx` currently resolves the implicit workspace, reads `queryStoredWatchlistEntries({ limit: 24, workspaceKey })`, joins each row through `getStoredOpportunityFeedItemBySlug()`, and renders the result through `WatchlistDashboardTable`.
- No pursuit tables, pursuit storage owner, or pursuit mutation APIs exist yet.
- Discover and detail are already the primary screening surfaces and should stay that way.
- The dashboard still keeps a separate roadmap panel beside the watched-opportunity table.
- This plan should build on the workspace boundary from plan 07 rather than inventing a second follow-up state model.

## This Round

### In Scope

- storage-owned pursuit records tied to canonical opportunities
- shortlist, stage, note, and next-action fields
- dashboard and opportunity-detail entry points into pursuit state
- bilingual UI copy for pursuit workflow

### Out Of Scope

- task boards
- document storage
- team chat or mentions
- assignee or ownership fields
- generic CRM account management

### V1 Operating Assumption

- this round reuses the implicit local-workspace scope from `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
- it does not add assignee, permissions, or multi-user collaboration
- pursuit editing stays disabled unless `ARCH_ENABLE_WORKSPACE_WRITES` is enabled

## Success Criteria

- a team can move an opportunity from browse to shortlist to tracked pursuit state
- pursuit stage, note, and next-action fields are stored outside UI components and remain tied to canonical opportunity ids
- the dashboard becomes the main localized pursuit workspace without replacing discover as the primary screening route
- the detail page can show or update pursuit state without duplicating dashboard logic
- when workspace writes are disabled, the dashboard cleanly falls back to the current watchlist table or empty-state behavior plus the roadmap surface

## ASCII UI Sketch

```text
+--------------------------------------------------------------+
| Dashboard header                                              |
| [Digest summary] [Saved searches] [Watched count]            |
+--------------------------------------------------------------+
| Pursuit table                                                 |
| Opportunity | Stage | Deadline | Next action | Note  |
| ------------------------------------------------------------ |
| ...                                                           |
+--------------------------------------------------------------+
| Side panel / inline editor                                    |
| Stage                                                         |
| Next action                                                   |
| Notes                                                         |
+--------------------------------------------------------------+
```

## Execution Order

## Task 1: Define pursuit workspace state in storage
**Goal**  
Create one storage-owned pursuit record that downstream UI and alerts can reuse.

**Files**  
`apps/worker/src/arch_competition_ops/storage/database.py`  
`packages/storage/src/pursuits.ts`  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`

**Execute**  
Add dedicated pursuit tables in `apps/worker/src/arch_competition_ops/storage/database.py`, then add a dedicated `pursuits.ts` owner file for shortlist state, pursuit stage, note text, and next-action fields keyed by canonical opportunity id plus one implicit `workspace_key`. Keep fields narrow, define a small stage enum with explicit unknown fallback, and avoid drifting into a generic CRM or assignee model.

**Pass Criteria**  
Pursuit state has one truth owner and can be queried independently of raw opportunity feed rendering.

**Verify**  
Run `npm run test:storage`.

## Task 2: Add pursuit mutation APIs
**Goal**  
Give the web app one path for updating shortlist and follow-up state.

**Files**  
`apps/web/src/app/api/pursuits/route.ts`  
`apps/web/src/app/api/pursuits/[opportunityId]/route.ts`  
`apps/web/src/lib/workspace.ts`

**Execute**  
Create API handlers for creating or updating pursuit records and for reading a focused pursuit detail view by opportunity id. Reuse storage helpers, resolve the current local workspace through `apps/web/src/lib/workspace.ts`, and keep mutation semantics aligned with the narrow pursuit contract. Reject writes when `ARCH_ENABLE_WORKSPACE_WRITES` is off.

**Pass Criteria**  
Dashboard and detail surfaces can update pursuit state through stable API routes with no component-local persistence.

**Verify**  
Run `npm run build:web`.

## Task 3: Turn the current dashboard into the pursuit workspace
**Goal**  
Reuse the existing localized dashboard route and table structure as the pursuit entry surface.

**Files**  
`apps/web/src/app/[locale]/dashboard/page.tsx`  
`apps/web/src/components/pursuit-workspace-table.tsx`  
`apps/web/src/components/pursuit-editor.tsx`  
`apps/web/src/components/watchlist-dashboard-table.tsx`  
`packages/storage/src/pursuits.ts`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Replace the current watchlist-entry join in `apps/web/src/app/[locale]/dashboard/page.tsx` with a storage-owned pursuit workspace surface helper, then render a pursuit-focused table and inline editor. Borrow the existing `panel` and `table-panel` rhythm from the page instead of introducing a new dashboard shell, and explicitly decide whether watched-at context remains visible as part of the workspace bundle instead of leaving the old join path alive beside the new one. Put all new copy in `dictionaries.ts`, and keep the route clearly secondary to the discover surface.

**Pass Criteria**  
`/[locale]/dashboard` works as a real pursuit workspace while preserving the current locale-aware route and severe visual language.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Task 4: Add pursuit entry and status cues to opportunity detail
**Goal**  
Let users move directly from screening to follow-up without leaving the opportunity page blind.

**Files**  
`apps/web/src/components/opportunity-detail-surface.tsx`  
`apps/web/src/components/opportunity-stream-item.tsx`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Add a compact pursuit-state block and call-to-action on the existing detail surface, plus a small stage cue in the browse item when a pursuit record exists. Keep the current watch action intact, keep full editing in the dashboard workspace, and let the detail page expose entry and summary rather than a second full editor.

**Pass Criteria**  
Users can see pursuit status from detail and browse views while the dashboard remains the main editing surface.

**Verify**  
Run `npm run lint:web` and manual browser review on port `3400`.

## Rollout Controls

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `ARCH_ENABLE_WORKSPACE_WRITES` | `/[locale]/dashboard` stays on the current read-only table and roadmap surface; pursuit actions are hidden or disabled. | One implicit local workspace can shortlist opportunities, set stage, edit notes, and update next actions. |

## Risks And Rollback

- If the workspace starts accumulating general-purpose fields, cut back to shortlist, stage, note, and next action only.
- If dashboard density regresses, move note editing to a side panel instead of inline table growth.
- If stage names prove unstable, keep them as a narrow enum with explicit unknown fallback.

## Execution Notes

- Borrow the current dashboard shell from `apps/web/src/app/[locale]/dashboard/page.tsx`.
- Keep `packages/storage/src/pursuits.ts` as the primary truth owner for follow-up state.
- Do not leave the dashboard on the current watchlist-entry join once pursuit state exists; the route should read one workspace-owned surface bundle.
- This is a pursuit workspace for opportunity screening, not a delivery or project execution workspace.

## Verification Evidence

- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md`
