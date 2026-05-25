---
title: Changelog 2026-05-25
status: 已完成
updated_at: 2026-05-25
related_docs:
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-05-25

## Opportunity Preview Pipeline And Auth Bootstrap Stabilization

### Changed

- Expanded the web opportunity preview pipeline with cached/static satellite preview revision tracking, richer preview quality handling, and updated stream-card presentation logic.
- Updated Cloudflare build and deploy support files so preview revision assets are prepared during production builds.
- Extended worker-side operations, storage, and related tests for the new preview and cleanup flow.
- Hardened D1-backed auth storage so registration and session flows bootstrap `auth_users` and `auth_sessions` automatically when the auth tables are still missing.
- Added a D1 auth regression test and stabilized a storage query test that previously depended on wall-clock time.

### Why

- Production preview delivery now depends on a coordinated cacheable asset pipeline instead of ad hoc runtime generation alone.
- The registration failure on the deployed app was caused by D1 auth paths assuming the auth tables already existed, which surfaced as a generic authentication failure instead of allowing account creation.
- Date-sensitive tests were starting to fail as time moved forward, which made end-of-round verification noisy and less trustworthy.

### Validation

- `npx tsx --test packages/storage/src/auth.test.ts packages/storage/src/cloudflare-auth.test.ts`
- `npm run test:storage`

### Modified Files

- `.env.example`
- `CLOUDFLARE_DEPLOY_RUNBOOK.md`
- `apps/web/next.config.ts`
- `apps/web/package.json`
- `apps/web/src/app/api/opportunities/[slug]/image/route.ts`
- `apps/web/src/components/opportunity-stream-item.tsx`
- `apps/web/src/lib/opportunity-card-placeholder.test.ts`
- `apps/web/src/lib/opportunity-card-placeholder.ts`
- `apps/web/src/lib/opportunity-display.ts`
- `apps/web/src/lib/opportunity-location.test.ts`
- `apps/web/src/lib/opportunity-location.ts`
- `apps/web/src/lib/opportunity-preview-revision.ts`
- `apps/web/src/lib/opportunity-satellite-preview-cache.test.ts`
- `apps/web/src/lib/opportunity-satellite-preview-cache.ts`
- `apps/web/src/lib/opportunity-satellite-preview-quality.ts`
- `apps/web/src/lib/opportunity-satellite-preview.test.ts`
- `apps/web/src/lib/opportunity-satellite-preview.ts`
- `apps/web/src/lib/server-storage.ts`
- `apps/web/tsconfig.build.json`
- `apps/worker/src/arch_competition_ops/cli.py`
- `apps/worker/src/arch_competition_ops/operations.py`
- `apps/worker/src/arch_competition_ops/settings.py`
- `apps/worker/src/arch_competition_ops/storage/__init__.py`
- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/tests/test_collectors.py`
- `apps/worker/tests/test_operations_cleanup.py`
- `apps/worker/tests/test_storage.py`
- `data/geocoding-cache.json`
- `docs/changelog/CHANGELOG_2026-05-12.md`
- `docs/changelog/CHANGELOG_2026-05-25.md`
- `packages/storage/src/cloudflare-auth.test.ts`
- `packages/storage/src/cloudflare.ts`
- `packages/storage/src/index.test.ts`
- `packages/storage/src/index.ts`
- `scripts/lib/*`
- `scripts/prepare-cloudflare-build.ps1`
- `scripts/run-ingest-batch.ps1`
- `scripts/sync-satellite-previews.mjs`
- `scripts/write-opportunity-preview-revisions.mjs`
