---
title: Changelog 2026-10-21
status: done
updated_at: 2026-10-21
related_docs:
  - docs/structures/2026-10-21-storage-auth-api-architecture.md
  - docs/AI_CONSTRAINTS.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-10-21

## Storage, Authentication And API Hardening

### Changed

- Replaced the two duplicated storage runtimes with one implementation over a `D1DatabaseLike` driver interface (Cloudflare D1 binding and a better-sqlite3 adapter); deleted the second copy and the hand-written `LocalStorageModule`.
- Made `apps/web/migrations/*.sql` the only schema source; local development applies pending migrations with `schema_migrations` bookkeeping. Added migration 0005 (`auth_attempts`, session and recency indexes, saved-search uniqueness with de-duplication).
- Pushed filtering, sorting, paging, totals and filter options into SQL; primary-key slug lookup; batched dashboard lookup; escaped `LIKE`; clamped numeric and date inputs (default limit 24, max 100).
- Gave every user a private workspace and made `/ops` and `/api/ops/**` administrator-only (`ARCH_OPS_ADMIN_EMAILS`); removed `ARCH_WORKSPACE_KEY`, `ARCH_ENABLE_WORKSPACE_WRITES`, `ARCH_ENABLE_OPS_REVIEW`.
- Unified password hashing (self-describing scrypt, legacy hashes upgraded on login), hashed session tokens, session rotation and sliding renewal, `__Host-` cookie, same-origin checks, POST logout, login and registration throttling.
- Added zod validation and the `{ error: { code, message } }` envelope to every API route; removed `/api/competitions`, the unused server actions and the swallowed `catch {}` blocks.
- Rewrote `scripts/export-d1-data.mjs` as incremental upserts of worker-owned tables only; `ARCH_COMPETITION_DB_PATH` is replaced by `ARCH_COMPETITION_OPS_DB` everywhere.

### Why

- The audit (P1, P3, P4, P5, P7, S1-S6) found drifting duplicate implementations, a single shared tenant, an unauthenticated operations surface, full-table scans per request, and a D1 sync that wiped user data.

### Validation

- `npm run test:storage`
- `npx tsx --test "apps/web/src/lib/*.test.ts"`
- `node --test tests/export-d1-data.test.mjs`
- `npm run typecheck --workspaces --if-present`
- `npm run lint:web`
- `npm run build:web`

### Modified Files

- `packages/core/**`, `packages/storage/**`
- `apps/web/migrations/0005_auth_attempts_and_saved_search_uniqueness.sql`
- `apps/web/src/lib/**`, `apps/web/src/app/api/**`, `apps/web/src/app/[locale]/{dashboard,ops,login,register}/**`, `apps/web/src/middleware.ts`
- `scripts/export-d1-data.mjs`, `scripts/lib/d1-sync/**`, `tests/export-d1-data.test.mjs`, `tests/helpers/d1-sync-*.mjs`
- `CLOUDFLARE_DEPLOY_RUNBOOK.md`
- `docs/structures/2026-10-21-storage-auth-api-architecture.md`

## Documentation Cleanup

### Changed

- Rewrote `README.md` (repo-relative quick start, real stack, `npm run check`, Cloudflare path) and `docs/ARCHITECTURE.md` (D1/Workers/OpenNext, unified storage, worker layout, migrations as schema authority); rewrote `docs/SETUP.md`.
- Made `AGENTS.md` the only rule authority: `docs/AI_CONSTRAINTS.md` lost its duplicated truth-rule, source-hierarchy, port and verification text; removed the GitNexus block from `AGENTS.md` and `CLAUDE.md`.
- Moved `DATA_CONTRACT.md` and `PORT_SCRIPT.md` to `docs/`; `DATA_CONTRACT.md` now states the current truth rules (NULL fee is pending, empty organizer is unknown, eligibility only from real clauses, record id scheme, `source_name`, field-level merge upsert, TED currency evidence).
- Folded the root `CHANGELOG.md` into `docs/changelog/CHANGELOG_2026-04-20.md` and deleted it.
- Removed the `已完成-`/`施工中-`/`未实施-` filename prefixes from `docs/plans/`; `status` is now one vocabulary (`draft`, `not-started`, `in-progress`, `done`, `archived`) in every doc. Closed the Cloudflare deployment plan as `done`.
- Reduced `scripts/doc-governance.mjs` to a read-only `scan` (frontmatter, status vocabulary, dates, referenced paths, relative links, stale `in-progress` warnings); added `tests/doc-governance.test.mjs`, `npm run check:docs` and `npm run test:docs`, and put `check:docs` first in `npm run check`. Removed the `normalize`, `set-status`, `write`, `rename` and `check-encoding` commands and their npm scripts.
- Removed the `docs/skills/` notes and the goal, research, roadmap and structure templates (nothing used them); removed the placeholder packages `packages/ai` and `packages/sources`.
- Re-checked `.env.example` against the code: added `ARCH_PREVIEW_PREWARM` and the three missing worker settings, removed `ARCH_COMPETITION_OPS_CARD_PREVIEW_PREWARM_ENABLED` (read nowhere).

### Why

- The audit (P10, O2, batch 5 item 24) found contradictory AI instructions, documentation behind the code, and governance tooling heavier than the repository needs.

### Validation

- `node scripts/doc-governance.mjs scan`
- `node --test tests/doc-governance.test.mjs`

### Modified Files

- `README.md`, `AGENTS.md`, `CLAUDE.md`, `.env.example`, `package.json`, `scripts/doc-governance.mjs`, `tests/doc-governance.test.mjs`
- `docs/**` (including the moves and renames above)

