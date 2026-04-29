---
title: Parser Reliability And Freshness Visibility Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 已完成
updated_at: 2026-04-21
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-01-expand-official-source-coverage-plan.md
  - docs/ARCHITECTURE.md
---

# Parser Reliability And Freshness Visibility Plan

> Expected Outcome: Operators can see which sources are stale, failing, duplicated, or low-confidence, and the worker exposes enough diagnostics to keep ingestion trustworthy. This round improves reliability and visibility; it does not yet build the full review queue UX for operator decisioning.

## This Round

### In Scope

- worker-side diagnostics for freshness and failure visibility
- storage read helpers for ops-facing summaries
- ops page improvements that surface actionable pipeline health

### Out Of Scope

- qualification scoring
- bid/no-bid summary
- public discover UI redesign
- verified submission intake

## Success Criteria

- operators can see freshness and pipeline health by source or source class
- parser failures and duplicate pressure are surfaced as explicit ops signals
- the ops page reads from storage-layer helpers rather than direct ad hoc SQLite access
- diagnostic persistence is additive and stays outside the canonical `competitions` row shape
- worker verification still passes after diagnostics are added

## Execution Order

## Task 1: Add worker-side diagnostic outputs
**Goal**  
Record pipeline health signals in one place so ops surfaces have stable inputs.

**Files**  
`apps/worker/src/arch_competition_ops/operations.py`  
`apps/worker/src/arch_competition_ops/cli.py`  
`apps/worker/src/arch_competition_ops/storage/database.py`

**Execute**  
Extend worker operations so collection and extraction runs produce stable diagnostic outputs for freshness, parser failures, and likely duplicates. Add additive ops tables such as source-run history and source-health snapshots in `storage/database.py` instead of overloading canonical `competitions` rows or forcing the web app to infer diagnostics from feed items.

**Pass Criteria**  
Diagnostics live in the worker/storage path, not in the web layer, and can be used repeatedly by ops views.

**Verify**  
Run `uv run arch-competition-ops doctor`.

## Task 2: Extend the storage read model for ops visibility
**Goal**  
Expose worker diagnostics through reusable storage-layer queries for the web app.

**Files**  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`

**Execute**  
Add storage helpers for source freshness, parser error counts, and review pressure summaries. Keep the existing `getStoredOpsSnapshot()` behavior stable for current callers, and add new query helpers instead of overloading one snapshot object with unrelated concerns.

**Pass Criteria**  
The web app can render ops diagnostics using storage-owned query helpers, with no direct database logic inside `apps/web`.

**Verify**  
Run `npm run test:storage`.

## Task 3: Replace the current ops summary-only view with actionable diagnostics
**Goal**  
Turn the localized ops page into a real pipeline health screen.

**Files**  
`apps/web/src/app/[locale]/ops/page.tsx`  
`apps/web/src/i18n/dictionaries.ts`  
`apps/web/src/components/ops-source-health-table.tsx`

**Execute**  
Create a focused ops component for source freshness and parser health. Keep the existing high-level snapshot at the top, then add source-level health rows below it. Put all product copy in `dictionaries.ts` and preserve locale-aware routing and shell behavior.

**Pass Criteria**  
An operator can open `/[locale]/ops` and immediately see which ingestion areas are stale or failing.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Task 4: Add a duplicate-pressure signal without inventing canonical duplicates logic in the UI
**Goal**  
Surface likely duplicate clusters as an ops concern before building the dedicated review queue.

**Files**  
`apps/worker/src/arch_competition_ops/operations.py`  
`packages/storage/src/index.ts`  
`apps/web/src/app/[locale]/ops/page.tsx`

**Execute**  
Derive a lightweight duplicate-pressure signal from canonical records and expose it in ops. Keep this as a review hint, not a destructive deduplication workflow. Do not delete or merge records in this round.

**Pass Criteria**  
Ops surfaces can identify where duplicate cleanup is needed, but canonical records remain intact until the later review-queue plan lands.

**Verify**  
Run `uv run arch-competition-ops verify`, `npm run test:storage`, and `npm run build:web`.

## Risks And Rollback

- If diagnostics require schema changes, keep them additive and avoid breaking the current web feed.
- If duplicate detection is too noisy, expose it as a low-confidence hint only.
- If ops UI complexity grows too quickly, keep the first pass table-based and information-dense.

## Execution Notes

- Keep ops as an operator surface, not a marketing-facing dashboard.
- Every new visible signal must still derive from worker or storage truth.
- Use one new UI component for source health instead of expanding `page.tsx` inline.
- 2026-04-21: Added additive worker diagnostics tables `source_runs` and `source_health`, keeping canonical `competitions` rows unchanged.
- 2026-04-21: Updated `ingest_source` to persist run history, parse-failure counts, and source-local duplicate hints while preserving existing competition upsert behavior.
- 2026-04-21: Added storage helpers for source health and duplicate pressure without changing `getStoredOpsSnapshot()`.
- 2026-04-21: Replaced the old ops record preview with a bilingual source-health table and duplicate-pressure summary on `/[locale]/ops`.
- 2026-04-21: `gitnexus_detect_changes({ scope: "all" })` could not run because the workspace has no resolvable `HEAD`; file-level verification was used instead.

## Verification Evidence

- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`

