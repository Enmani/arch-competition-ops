---
title: Changelog 2026-06-06
status: 已完成
updated_at: 2026-06-06
related_docs:
  - docs/AI_CONSTRAINTS.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-06-06

## Fix Opportunity Detail Links For Encoded Slugs

### Changed

- Added percent-encoded slug fallback lookup for opportunity detail reads in local SQLite storage and Cloudflare D1 storage.
- Preserved canonical opportunity ids and slugs in storage; the fallback only decodes incoming request slugs when the original request value does not match a record.
- Added local SQLite and D1 regression tests for non-ASCII opportunity slugs such as `técnica` and `redacción`.

### Why

- Production detail pages returned Next 404 for opportunity cards whose slug contained non-ASCII characters.
- The discover API returned canonical ids with accents, but browser navigation sent percent-encoded path segments through Cloudflare/OpenNext, causing exact D1 lookup by encoded slug to miss existing records.

### Validation

- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npx gitnexus analyze`

### Modified Files

- `packages/storage/src/index.ts`
- `packages/storage/src/cloudflare.ts`
- `packages/storage/src/index.test.ts`
- `packages/storage/src/cloudflare-auth.test.ts`
