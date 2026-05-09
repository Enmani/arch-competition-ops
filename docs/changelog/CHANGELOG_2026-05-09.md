---
title: Changelog 2026-05-09
status: 已完成
updated_at: 2026-05-09
related_docs:
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-05-09

## Cloudflare Runtime Deployment Repair

### Changed

- Restored Cloudflare D1 selection so the web app only falls back to local SQLite during local development instead of in every Node-compatible runtime.
- Replaced Unicode property regex usage in shared storage helpers and web presentation helpers with worker-safe combining-mark stripping.
- Simplified explicit city extraction to avoid Unicode property escapes that were still being bundled into the worker build.
- Stopped the production web runtime from silently falling back to local SQLite storage, and marked the local storage import as webpack-ignored so the worker bundle no longer needs the local `better-sqlite3` path.

### Why

- Production deploys were still returning `500 Internal Server Error` after the China procurement release because the worker runtime was skipping D1 and bundling regex patterns unsupported by the deployed environment.
- The remaining failure mode was that any Cloudflare context lookup miss could still route production requests into the local SQLite storage path, which is not valid inside Workers.
- These fixes keep the normalized storage path intact while making the Cloudflare worker bundle compatible with the actual production runtime.

### Validation

- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npm run build:web:cloudflare`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-05-09.md`
- `npm run check:encoding:all`
- `curl.exe -I https://arch-competition.com/zh/discover`
- `curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"`

### Modified Files

- `apps/web/src/lib/server-storage.ts`
- `apps/web/src/lib/opportunity-display.ts`
- `apps/web/src/lib/opportunity-location.ts`
- `packages/storage/src/cloudflare.ts`
- `packages/storage/src/index.ts`
- `docs/changelog/CHANGELOG_2026-05-09.md`
