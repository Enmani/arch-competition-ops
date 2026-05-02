---
title: Changelog 2026-04-30
status: 已完成
updated_at: 2026-04-30
related_docs:
  - docs/plans/施工中-2026-04-30-cloudflare-workers-d1-deployment-plan.md
---

# Changelog 2026-04-30

## Cloudflare Workers And D1 Deployment Path

### Changed

- Added OpenNext Cloudflare, Wrangler, D1 migration, and Cloudflare build/deploy scripts for `apps/web`.
- Added a Workers-compatible D1 storage adapter and switched web pages/API/auth paths through a runtime storage facade that falls back to local SQLite.
- Added a D1 data export script for normalized opportunity, source health, ops review, saved search, and watchlist data.
- Documented the remaining account-owned Cloudflare steps in the deployment plan.

### Why

- The project needs a low-cost hosted route that does not require keeping a local computer online.
- Cloudflare Workers plus D1 keeps the app serverless while preserving normalized storage as the website source of truth.

### Validation

- `npm run d1:migrate:local`
- `npm run d1:export-data`
- `npm run test:storage`
- `npm run lint:web`
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build:web`
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build:web:cloudflare`

### Modified Files

- `.gitignore`
- `apps/web/migrations/0001_initial.sql`
- `apps/web/next.config.ts`
- `apps/web/open-next.config.ts`
- `apps/web/package.json`
- `apps/web/src/app/**`
- `apps/web/src/components/**`
- `apps/web/src/lib/**`
- `apps/web/wrangler.jsonc`
- `package.json`
- `packages/storage/package.json`
- `packages/storage/src/cloudflare.ts`
- `scripts/export-d1-data.mjs`
