---
title: CHANGELOG 2026-04-22
status: 已完成
updated_at: 2026-04-22
related_docs:
  - docs/ai/doc-governance-standard.md
  - docs/structures/2026-04-22-workspace-follow-up-architecture.md
  - docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md
  - docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md
  - docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md
  - docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md
  - docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md
  - docs/plans/未实施-2026-04-19-10-verified-submission-intake-plan.md
---

# CHANGELOG 2026-04-22

## Pending Plan Realignment And Workspace Structure

### Changed

- Added the new structure owner [docs/structures/2026-04-22-workspace-follow-up-architecture.md](../structures/2026-04-22-workspace-follow-up-architecture.md) for the shared `workspace_key`, follow-up-state boundaries, worker schema ownership, and submission-to-review handoff.
- Renamed plan 05 and plan 06 to `施工中-` because the current codebase already implements part of qualification scoring and evidence-first decision support.
- Rewrote [docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md](../plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md) around the current score owner, existing storage exposure, and the remaining explainability work.
- Rewrote [docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md](../plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md) so it builds on the current detail surface and storage path instead of treating the feature as greenfield.
- Updated plans 07, 08, and 09 so new workspace tables stay owned by `apps/worker/src/arch_competition_ops/storage/database.py`, while `packages/storage` remains the web-facing contract owner.
- Updated plan 09 so the future dashboard no longer stays on a raw `queryStoredOpportunityFeed()` call once pursuit state exists.
- Updated plan 10 so verified submissions reuse the existing ops review queue and `submission_pending_review` semantics instead of inventing a second moderation surface.
- Updated [docs/plans/README.md](../plans/README.md) to reflect the new `施工中-` filenames.

### Why

- The codebase had moved far enough that several pending plans were now describing owners, dependencies, or starting points that no longer matched reality.
- Plans 05 and 06 were still marked `未实施` even though numeric scoring, storage exposure, detail-page score rendering, and evidence-first decision framing were already live.
- Plans 07 through 10 shared a missing architecture truth around local workspace state, schema ownership, dashboard responsibility, and submission review reuse.
- Repairing the canonical docs now prevents future delivery rounds from reintroducing deleted paths, duplicating persistence logic, or splitting ops review into disconnected tools.

### Validation

- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npm run check:doc-governance:file -- --file docs/structures/2026-04-22-workspace-follow-up-architecture.md`
- `npm run check:doc-governance:file -- --file docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-10-verified-submission-intake-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/README.md`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-22.md`
- `npm run check:encoding:all`

### Modified Files

- `docs/structures/2026-04-22-workspace-follow-up-architecture.md`
- `docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md`
- `docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md`
- `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`

## Saved Search And Watchlists Implementation

### Changed

- Implemented workspace-owned saved searches and watchlists through `workspace_saved_searches` and `workspace_watchlist_entries` in `apps/worker/src/arch_competition_ops/storage/database.py`.
- Added the web-facing persistence owner in `packages/storage/src/watchlists.ts` and re-exported the contract through `packages/storage/src/index.ts`.
- Added `apps/web/src/lib/workspace.ts` plus the new `apps/web/src/app/api/saved-searches/route.ts` and `apps/web/src/app/api/watchlists/route.ts` handlers, with writes gated by `ARCH_ENABLE_WORKSPACE_WRITES`.
- Extended discover with `apps/web/src/components/discover-saved-searches.tsx`, added `apps/web/src/components/watch-toggle-button.tsx`, and switched the existing dashboard table to watched opportunities through `apps/web/src/components/watchlist-dashboard-table.tsx`.
- Updated bilingual product copy and styles so discover, detail, and dashboard all expose the new save/watch controls without changing the procurement-first surface model.
- Marked plan 07 complete and renamed it to `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`.

### Why

- Plan 07 was the first remaining `未实施` workspace follow-up capability after the canonical doc realignment.
- The repo needed one additive workspace state owner for filter persistence and follow-up selection before alerts, digests, or pursuit workflow could be built safely.
- This implementation keeps canonical opportunity facts separate from practice-facing workflow state and preserves the existing discover bundle path.

### Validation

- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `uv run pytest apps/worker/tests/test_storage.py`
- Write-enabled E2E verification on a temporary SQLite copy:
  `ARCH_COMPETITION_DB_PATH=artifacts/plan07-e2e.sqlite`
  `ARCH_ENABLE_WORKSPACE_WRITES=true`
  `ARCH_WORKSPACE_KEY=e2e_practice`
  Saved-search and watchlist create/list/delete routes passed, discover/detail/dashboard HTML reflected the new state, and the temporary workspace tables were cleaned back to zero rows after verification.

### Modified Files

- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/tests/test_storage.py`
- `packages/storage/src/watchlists.ts`
- `packages/storage/src/watchlists.test.ts`
- `packages/storage/src/index.ts`
- `apps/web/src/lib/workspace.ts`
- `apps/web/src/lib/discover.ts`
- `apps/web/src/app/api/saved-searches/route.ts`
- `apps/web/src/app/api/watchlists/route.ts`
- `apps/web/src/components/discover-dock.tsx`
- `apps/web/src/components/discover-surface.tsx`
- `apps/web/src/components/discover-saved-searches.tsx`
- `apps/web/src/components/opportunity-stream-item.tsx`
- `apps/web/src/components/opportunity-detail-surface.tsx`
- `apps/web/src/components/watch-toggle-button.tsx`
- `apps/web/src/components/watchlist-dashboard-table.tsx`
- `apps/web/src/app/[locale]/dashboard/page.tsx`
- `apps/web/src/app/[locale]/opportunities/[slug]/page.tsx`
- `apps/web/src/i18n/dictionaries.ts`
- `apps/web/src/app/globals.css`
- `.env.example`
- `docs/plans/README.md`
- `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
- `docs/structures/2026-04-22-workspace-follow-up-architecture.md`
- `docs/changelog/CHANGELOG_2026-04-22.md`
- `docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
- `docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md`
- `docs/plans/未实施-2026-04-19-10-verified-submission-intake-plan.md`
- `docs/plans/README.md`
- `docs/changelog/CHANGELOG_2026-04-22.md`

## Downstream Workspace Plan Baseline Sync

### Changed

- Updated [docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md](../plans/未实施-2026-04-19-08-alerts-and-digests-plan.md) so its baseline now reflects the live watchlist-backed dashboard, and so digest work explicitly preserves the existing watched-opportunity follow-up table instead of replacing it with a digest-only screen.
- Updated [docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md](../plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md) so its baseline and dashboard task now start from the current `queryStoredWatchlistEntries()` plus `getStoredOpportunityFeedItemBySlug()` join, rather than the older raw-feed assumption.

### Why

- Plan 09 still described the dashboard as if it were backed by a direct `queryStoredOpportunityFeed()` call, which no longer matches the code after plan 07 landed.
- Plan 08 was directionally correct, but it did not lock in the current watchlist table as part of the dashboard baseline, which left too much room for a future executor to accidentally replace the existing follow-up surface instead of extending it.
- Syncing the downstream plans now reduces the chance that alerts or pursuit work reintroduce obsolete dashboard data paths or silently drop the current watchlist workflow.

### Validation

- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-22.md`
- `npm run check:encoding:all`

### Modified Files

- `docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
- `docs/plans/未实施-2026-04-19-09-pursuit-workspace-v1-plan.md`
- `docs/changelog/CHANGELOG_2026-04-22.md`
