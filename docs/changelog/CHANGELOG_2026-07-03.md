---
title: Changelog 2026-07-03
status: 已完成
updated_at: 2026-07-03
related_docs:
  - docs/AI_CONSTRAINTS.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-07-03

## Repair Auto Ingest And English Locale Controls

### Changed

- Made Windows scheduled ingest tasks run from the repository root so relative runtime paths resolve consistently.
- Hardened the batch ingest runner so it can find a user-installed `uv`, logs missing-runtime failures, and exits non-zero when a batch fails.
- Stabilized the storage qualification filter test by pinning the effective current date inside the test case.
- Replaced browser-native discover deadline inputs with bilingual `YYYY-MM-DD` text inputs to avoid OS-localized date picker text on the English surface.
- Simplified the top-right locale switcher into a direct locale-preserving link and corrected English language names.
- Normalized English compact currency output so server-rendered opportunity values hydrate consistently in the browser.
- Added geocoding cache entries produced by the refreshed ingestion run.

### Why

- Automated refreshes need to be reproducible from Windows Task Scheduler, not dependent on the interactive shell's working directory or PATH.
- The English discover surface should not show Chinese UI chrome from native date controls or mislabeled language names.
- Locale switching should preserve current filter query state and work with one click.
- Server and client rendering should agree on compact value-chip text to avoid hydration errors on the discover feed.

### Validation

- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- Browser verification on `http://localhost:3400/en/discover?deadlineBefore=2026-07-15`

### Modified Files

- `apps/web/src/app/globals.css`
- `apps/web/src/components/discover-dock.tsx`
- `apps/web/src/components/locale-switcher.tsx`
- `apps/web/src/i18n/format.ts`
- `apps/web/src/i18n/dictionaries.ts`
- `data/geocoding-cache.json`
- `docs/changelog/CHANGELOG_2026-07-03.md`
- `packages/storage/src/index.test.ts`
- `scripts/register-auto-ingest-tasks.ps1`
- `scripts/run-ingest-batch.ps1`
