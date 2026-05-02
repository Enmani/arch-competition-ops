---
title: Cloudflare Workers And D1 Deployment Plan
status: 施工中
updated_at: 2026-04-30
vision_doc: vision.md
related_docs:
  - docs/AI_CONSTRAINTS.md
  - docs/ai/doc-governance-standard.md
---

# Cloudflare Workers And D1 Deployment Plan

> Expected Outcome: the web app runs as a Next.js app on Cloudflare Workers through OpenNext, with Cloudflare D1 as the production database. Local development still uses the existing SQLite storage path.

## This Round

### In Scope

- Add Cloudflare/OpenNext/Wrangler configuration for `apps/web`.
- Add a D1 migration matching the canonical SQLite schema plus simple email/password auth tables.
- Add a Workers-compatible D1 read/write layer while preserving the existing local SQLite storage layer.
- Add commands for local D1 migration, remote D1 migration, Cloudflare build, preview, deploy, and local SQLite data export.

### Out Of Scope

- Creating the real Cloudflare account resources, because `wrangler login` and the D1 database id require the operator account.
- Migrating old local auth users, because local auth used Node `scrypt` hashes and Workers auth now uses WebCrypto PBKDF2 hashes.

## Success Criteria

- `npm run d1:migrate:local` applies `apps/web/migrations/0001_initial.sql`.
- `npm run build:web:cloudflare` emits `.open-next/worker.js`.
- Web pages and API routes no longer require `better-sqlite3` at Cloudflare request time.
- Existing normalized opportunity data can be exported with `npm run d1:export-data`.

## Execution Order

## Task 1: Create Cloudflare Resources
**Goal**  
Create the account-owned production targets.

**Files**  
`apps/web/wrangler.jsonc`

**Execute**  
Run:

```bash
npm --workspace apps/web exec wrangler login
npm run d1:create
```

Copy the returned D1 `database_id` into `apps/web/wrangler.jsonc`, replacing `REPLACE_WITH_D1_DATABASE_ID`.

**Pass Criteria**  
Wrangler can resolve the `arch-competition-ops` D1 database remotely.

**Verify**  

```bash
npm --workspace apps/web exec wrangler d1 list
```

## Task 2: Apply D1 Schema
**Goal**  
Create production tables before importing data or deploying write paths.

**Files**  
`apps/web/migrations/0001_initial.sql`

**Execute**  

```bash
npm run d1:migrate:remote
```

**Pass Criteria**  
Wrangler reports `0001_initial.sql` as applied.

**Verify**  

```bash
npm --workspace apps/web exec wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM competitions"
```

## Task 3: Import Existing Data
**Goal**  
Seed D1 with the existing normalized opportunity and ops data from `data/competitions.sqlite`.

**Files**  
`scripts/export-d1-data.mjs`

**Execute**  

```bash
npm run d1:export-data
npm --workspace apps/web exec wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-data.sql
```

**Pass Criteria**  
D1 contains the same canonical opportunity records as local SQLite.

**Verify**  

```bash
npm --workspace apps/web exec wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM competitions"
```

## Task 4: Deploy Worker
**Goal**  
Publish the Next.js app to Cloudflare Workers.

**Files**  
`apps/web/open-next.config.ts`  
`apps/web/wrangler.jsonc`

**Execute**  

```bash
npm run build:web:cloudflare
npm run deploy:web:cloudflare
```

**Pass Criteria**  
Cloudflare returns a Workers URL for `arch-competition-ops`.

**Verify**  
Open the Workers URL and check `/zh/discover`, `/en/discover`, `/zh/login`, register, login, watchlist toggle, and `/zh/ops`.

## Task 5: Attach Custom Domain
**Goal**  
Use an owned domain without running a server locally.

**Execute**  
Buy or connect a domain in Cloudflare, then add a Workers route or custom domain for `arch-competition-ops`.

**Pass Criteria**  
The domain points to Cloudflare Workers and requests reach the app even when the local computer is off.

## Risks And Rollback

- If D1 import fails, rerun migrations and import with a fresh export from `npm run d1:export-data`.
- If deployment fails after a code change, redeploy the previous Git commit or previous Cloudflare deployment.
- If old local auth users are needed, users must reset/re-register because password hashes cannot be converted without plaintext passwords.

## Execution Notes

- Cloudflare Workers/OpenNext is the production target; classic static-only Pages is not sufficient for login/session/API/database behavior.
- D1 is the cheapest long-term fit for this project because it keeps storage serverless and account-managed.
- Local development continues to use `data/competitions.sqlite` unless a Cloudflare D1 binding is present.

## Verification Evidence

- `npm run d1:migrate:local`
- `npm run d1:export-data`
- `npm run test:storage`
- `npm run lint:web`
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build:web`
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build:web:cloudflare`
