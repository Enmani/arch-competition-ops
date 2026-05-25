---
title: Changelog 2026-05-12
status: 已完成
updated_at: 2026-05-12
related_docs:
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-05-12

## Cloudflare API Token Deploy Flow

### Changed

- Updated `CLOUDFLARE_DEPLOY_RUNBOOK.md` to make Cloudflare User API tokens the default authentication path for deploy, migration, and D1 import steps.
- Documented the exact token permissions and production resource scope needed for `arch-competition-ops`.
- Added a verification step with `wrangler whoami` before running deploy commands.
- Added a Windows-specific troubleshooting note that redirects failed `wrangler login` attempts to the API-token flow.
- Added a post-deploy shell cleanup step for temporary Cloudflare environment variables.

### Why

- The Windows OAuth callback path behind `wrangler login` proved unreliable on this host and blocked repeatable deploys.
- API tokens provide a deterministic, shell-local authentication path that works for `wrangler whoami`, deploys, D1 imports, and remote migrations.
- Future deploy handoffs need an explicit authentication recipe so operators do not lose time debugging `localhost:8976` callback failures.

### Validation

- `npm --workspace apps/web exec -- wrangler whoami`
- `npm run deploy:web:cloudflare`
- `curl.exe -I https://arch-competition.com/zh/discover`
- `curl.exe -I https://www.arch-competition.com/zh/discover`
- `curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-05-12.md`
- `npm run check:encoding:all`

### Modified Files

- `CLOUDFLARE_DEPLOY_RUNBOOK.md`
- `docs/changelog/CHANGELOG_2026-05-12.md`
