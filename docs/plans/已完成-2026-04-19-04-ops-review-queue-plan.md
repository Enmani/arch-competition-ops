---
title: Ops Review Queue Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 已完成
updated_at: 2026-04-21
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-02-parser-reliability-and-freshness-visibility-plan.md
  - docs/plans/已完成-2026-04-19-03-deepen-canonical-normalization-plan.md
---

# Ops Review Queue Plan

> Expected Outcome: Operators can work through the records that most need human review, including low-confidence extractions, source conflicts, duplicates, and external submissions. This round turns the current ops page into an actionable queue backed by explicit review-state storage. It does not automate destructive merges or publish unverified records.

## This Round

### In Scope

- review-candidate and review-decision contracts
- worker-side generation of queue candidates from diagnostics and evidence conflicts
- ops-page queue UI and review actions
- review state that stays separate from canonical opportunity facts
- queue contract readiness for future submission-origin items without shipping the public submission write path yet

### Out Of Scope

- automatic deduplication merges
- direct publishing from ops clicks
- free-form moderation system
- generic analytics dashboarding
- verified submission intake API or public submission route

### V1 Operating Assumption

- review actions run in trusted local-operator mode; this round does not add RBAC or multi-operator auth
- decision writes stay disabled unless `ARCH_ENABLE_OPS_REVIEW` is enabled
- queue decisions may record a simple actor label such as `local_operator`, but they do not depend on a user table

## Success Criteria

- operators can open one queue and see which records need review first
- review candidates are generated from canonical diagnostics, not manual spreadsheet triage
- review decisions are stored separately from the canonical opportunity record so evidence remains intact
- the ops page stays localized and table-driven, not card-heavy
- review state has one decision owner and never mutates source facts directly from the UI

## Single Source Of Truth

- candidate generation truth owner: `apps/worker/src/arch_competition_ops/review_queue.py`
- worker-side queue persistence owner: `apps/worker/src/arch_competition_ops/storage/database.py`
- review-decision web contract owner: `packages/storage/src/ops-review.ts`
- canonical opportunity truth owner remains the worker plus storage read model; review state cannot silently overwrite source facts

## Execution Order

## Task 1: Define review queue storage and decision contracts
**Goal**  
Create one storage owner for review items and operator decisions.

**Files**  
`packages/storage/src/ops-review.ts`  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`  
`apps/worker/src/arch_competition_ops/storage/database.py`

**Execute**  
Add `ops-review.ts` with read helpers for queue ordering and write helpers for operator resolution states such as pending, accepted, rejected, or needs-follow-up, backed by additive queue and decision tables in the worker SQLite schema. Keep optional actor labels separate from canonical opportunity fields so review actions never masquerade as source facts.

**Pass Criteria**  
Queue state and operator decisions can be queried and updated without rewriting canonical opportunity rows directly from the UI.

**Verify**  
Run `npm run test:storage`.

## Task 2: Generate review candidates from worker diagnostics
**Goal**  
Turn parser failures, duplicate pressure, and explicit evidence conflicts into a ranked review queue, while reserving a stable reason code for later submission handoff.

**Files**  
`apps/worker/src/arch_competition_ops/review_queue.py`  
`apps/worker/src/arch_competition_ops/operations.py`  
`apps/worker/src/arch_competition_ops/cli.py`

**Execute**  
Create a worker-side queue generator that reads canonical records plus diagnostics and writes review candidates using stable reason codes through the Python persistence layer. Rank candidates by operational risk so conflicts and likely duplicates appear before low-value cleanup cases. Keep the queue contract ready for future `submission_pending_review` items, but do not assume this round already ships the external submission write path from plan 10.

**Pass Criteria**  
Review candidates are reproducible, traceable, and generated in the existing worker lifecycle.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 3: Replace the current ops summary with a real review queue
**Goal**  
Make `/[locale]/ops` the operator entry point for queue triage and resolution.

**Files**  
`apps/web/src/app/[locale]/ops/page.tsx`  
`apps/web/src/components/ops-review-queue.tsx`  
`apps/web/src/components/ops-review-toolbar.tsx`  
`apps/web/src/components/ops-source-health-table.tsx`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Reuse the current localized ops page and its dense table rhythm, keep the existing ops snapshot plus source-health diagnostics visible, and add the review queue as the next operator section instead of regressing back to a summary-only view. Preserve `apps/web/src/components/ops-source-health-table.tsx` as the source-health owner while introducing the queue table, reason badges, and basic review actions. Keep new UI copy bilingual and operational.

**Pass Criteria**  
Operators can open `/[locale]/ops`, sort through queue items, and record decisions without leaving the product, while still seeing the existing source-health and duplicate-pressure context.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Task 4: Add API routes for review actions and queue filters
**Goal**  
Provide one route layer for queue reads and decision writes.

**Files**  
`apps/web/src/app/api/ops/review/route.ts`  
`apps/web/src/app/api/ops/review/[queueId]/route.ts`

**Execute**  
Add route handlers for queue listing, filtering by reason or status, and writing review decisions. Use the storage helpers directly, gate decision writes behind `ARCH_ENABLE_OPS_REVIEW`, and keep response contracts aligned with the queue model from `packages/storage/src/ops-review.ts`.

**Pass Criteria**  
Queue reads and operator decisions move through stable API contracts with no direct SQL in route handlers.

**Verify**  
Run `npm run build:web`.

## Rollout Controls

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `ARCH_ENABLE_OPS_REVIEW` | `/[locale]/ops` remains read-only diagnostics and snapshot UI; queue actions are hidden or disabled. | Local operators can triage queue items and record review decisions through the ops route. |

## Risks And Rollback

- If the queue becomes noisy, keep only highest-risk reason codes in v1.
- If operators need richer evidence context, link out to canonical detail views before adding more inline complexity.
- If review decisions start mutating facts directly, stop and route those changes back through worker normalization rules.

## Execution Notes

- Keep the ops page an operator surface, not a dashboard vanity screen.
- Review state is derived or supervisory state only; it is not a second fact store.
- This plan is the gate for any later external submission intake.
- 2026-04-21: Added additive worker tables `ops_review_queue_items` and `ops_review_decisions` in `apps/worker/src/arch_competition_ops/storage/database.py`.
- 2026-04-21: Added `apps/worker/src/arch_competition_ops/review_queue.py` and wired queue refresh into `ingest_source`, `verify`, `seed_demo`, and the new `refresh-review-queue` CLI entry.
- 2026-04-21: Added `packages/storage/src/ops-review.ts` plus storage exports for queue reads, summary reads, and operator decision writes.
- 2026-04-21: Reworked `/[locale]/ops` so the existing diagnostics remain visible and the localized review queue now sits underneath them with read-only or writable behavior gated by `ARCH_ENABLE_OPS_REVIEW`.
- 2026-04-21: Added API routes `apps/web/src/app/api/ops/review/route.ts` and `apps/web/src/app/api/ops/review/[queueId]/route.ts`, keeping route handlers on storage helpers instead of direct SQL.
- 2026-04-21: Reserved the queue reason code `submission_pending_review` for the later verified-submission rollout, but kept the actual public submission path out of this round.

## Verification Evidence

- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`
