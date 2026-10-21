---
title: Workspace And Follow-Up Architecture
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: done
updated_at: 2026-10-21
related_docs:
  - docs/AI_CONSTRAINTS.md
  - docs/structures/2026-10-21-storage-auth-api-architecture.md
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/2026-04-19-07-saved-search-and-watchlists-plan.md
  - docs/plans/2026-04-19-08-alerts-and-digests-plan.md
  - docs/plans/2026-04-19-09-pursuit-workspace-v1-plan.md
  - docs/plans/2026-04-19-10-verified-submission-intake-plan.md
---

# Workspace And Follow-Up Architecture

## Completed-State Architecture

The product has two adjacent but separate truths:

- canonical opportunity facts in `competitions`
- practice-facing follow-up state keyed by one private `workspace_key` per signed-in user (`user:<id>`)

`discover` remains the primary screening surface. `detail` remains the evidence and decision-support surface for one opportunity. `dashboard` is the follow-up workspace for saved searches, watchlists, alerts, and pursuit state. `ops` remains the operator trust surface for diagnostics, review, and submission triage.

No practice-facing workflow feature may write back into canonical opportunity fact columns. Workflow state must stay additive and reversible.

## Capability Summary

This structure exists to support the near-term workflow plans without drifting into a generic CRM or turning the public browse surface into a dashboard.

The current repo already has a stable worker-owned schema path, a storage-owned TypeScript read layer, a discover bundle path, a detail path, and a live ops review queue. The missing capability work should extend those owners instead of creating new direct-SQL routes, component-local persistence, or plan-specific side stores.

## Shared Model

- One `workspace_key` per authenticated user (`user:<id>`, derived server-side, never taken from a request) represents that user's private scope.
- Saved searches persist canonical discover filter inputs, not translated labels or UI-only state.
- Watchlists, alerts, digests, and pursuits all key off `workspace_key` plus canonical opportunity ids or saved-search ids.
- Submission intake records stay outside canonical opportunities until they are reviewed and normalized.
- Authentication gates every workspace read and write; feature flags gate new surfaces but do not change the ownership model. See `docs/structures/2026-10-21-storage-auth-api-architecture.md`.

## Module Boundaries

| Module / Area | Responsibility | Must Not Own |
| --- | --- | --- |
| `apps/web/migrations/*.sql` and the worker's schema module | Table definitions (migrations are the authority; the worker mirrors them for the local database) | TypeScript-only contract design without matching schema truth |
| `apps/worker/src/arch_competition_ops/operations.py` and future worker helpers | Background evaluation and handoff flows such as alerts and submission-to-review sync | Component-triggered polling logic |
| `packages/storage/src/workspace/*` and future owner folders such as `alerts`, `pursuits`, `submissions` | Web-facing read/write helpers and row-to-contract mapping | Creating schema outside `apps/web/migrations` |
| `apps/web/src/lib/discover.ts` | Canonical discover query parsing and serialization | Persisting saved searches by itself |
| `apps/web/src/lib/auth.ts` | Authenticate the caller and require sign-in or administrator rights | Canonical opportunity truth |
| `apps/web/src/app/api/**` | Narrow mutation and read routes that reuse storage helpers | Direct ad hoc SQLite access |
| `apps/web/src/components/discover-*` | Save/apply discover-state controls on top of the existing discover bundle path | A second discover data pipeline |
| `apps/web/src/app/[locale]/dashboard/page.tsx` and dashboard components | Secondary follow-up surface for watched items, digests, and pursuit state | Replacing discover as the main browse entry |
| `apps/web/src/app/[locale]/ops/page.tsx` and ops-review components | Unified operator review and trust-maintenance surface | Practice-facing workspace state editing |

## Main Flows

1. Saved search and watchlist flow

The web app serializes discover filters through `apps/web/src/lib/discover.ts`, derives the `workspace_key` from the signed-in user, and writes saved-search/watchlist records through storage helpers backed by worker-owned SQLite tables.

2. Alert and digest flow

The worker evaluates canonical opportunity changes against saved searches and watched records, writes alert events and digest entries into shared tables, and the dashboard reads them through storage helpers plus narrow API routes for acknowledgement or preferences.

3. Pursuit workspace flow

The dashboard reads a storage-owned workspace bundle that joins canonical opportunity rows with pursuit state. Detail and browse surfaces only show compact cues and entry points; the dashboard remains the main editing surface.

4. Verified submission flow

The localized submit route writes strict pending submission records. A worker-side handoff converts accepted intake records into the existing ops review queue using `origin = submission` and `reason_code = submission_pending_review`. Canonical opportunities remain untouched until review and normalization complete.

## Rollout Controls

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `ARCH_ENABLE_ALERTS_DIGEST` | Dashboard hides digest controls; alert routes reject mutations; worker may skip alert generation. | In-product digest and preference flows are enabled. |
| `ARCH_ENABLE_VERIFIED_SUBMISSIONS` | `/[locale]/submit` stays unavailable and submission writes are rejected. | Controlled intake opens, but every record still routes into review. |

## Extension Points

- Add sharing between users by introducing an explicit membership table; the per-user key stays the default.
- Add delivery channels for alerts after the event model proves useful in-product.
- Expand submission anti-abuse controls without changing the pending-review boundary.

## Out Of Scope

- Per-person roles inside one practice (only the administrator allow-list exists)
- Cross-practice sharing
- Email or SMS delivery in the first alert round
- Generic CRM account models
- Direct public publishing from submission intake

## Linked Plans

- `docs/plans/2026-04-19-07-saved-search-and-watchlists-plan.md`
- `docs/plans/2026-04-19-08-alerts-and-digests-plan.md`
- `docs/plans/2026-04-19-09-pursuit-workspace-v1-plan.md`
- `docs/plans/2026-04-19-10-verified-submission-intake-plan.md`
