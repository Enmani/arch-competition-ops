---
title: Changelog 2026-05-11
status: 已完成
updated_at: 2026-05-11
related_docs:
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-05-11

## Cloudflare Satellite Preview Build Closure

### Changed

- Added shared Cloudflare build helpers so the web workspace prepares `.open-next` and syncs cached satellite previews before building and deploying.
- Hardened the Cloudflare build prep script so it cleanly skips `.open-next` cleanup when the build output directory is already absent.
- Updated the opportunity image route to try synced static satellite preview assets first and to return binary preview buffers without widening `Uint8Array` payloads.
- Reused a shared satellite preview cache-path helper from the runtime generator and ignored generated preview directories so local build outputs stop polluting source control.
- Updated the discover surface Chinese `loadMore` copy to `加载更多项目`.

### Why

- Cloudflare deploys need pre-synced satellite preview assets because the Worker runtime cannot rely on the local Sharp-based generation pipeline.
- The original Windows cleanup step failed on stale `.open-next` directories with long preview filenames, which blocked repeatable Cloudflare builds.
- First-run or already-clean worktrees were still able to fail before the actual build started because the prep step assumed `.open-next` always existed.
- Ignoring generated directories keeps commit and push rounds focused on source changes instead of derived artifacts.

### Validation

- `npm run lint:web`
- `npm run build:web:cloudflare`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-05-11.md`
- `npm run check:encoding:all`

### Modified Files

- `.gitignore`
- `apps/web/package.json`
- `apps/web/src/app/api/opportunities/[slug]/image/route.ts`
- `apps/web/src/i18n/dictionaries.ts`
- `apps/web/src/lib/opportunity-satellite-preview.ts`
- `apps/web/src/lib/opportunity-satellite-preview-cache.ts`
- `docs/changelog/CHANGELOG_2026-05-11.md`
- `scripts/prepare-cloudflare-build.ps1`
- `scripts/sync-satellite-previews.mjs`
