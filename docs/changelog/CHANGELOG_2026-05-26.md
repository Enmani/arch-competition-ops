---
title: Changelog 2026-05-26
status: 已完成
updated_at: 2026-05-26
related_docs:
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-05-26

## Cloudflare Auth Runtime Repair

### Changed

- Replaced the Cloudflare/D1 auth password hashing path with a worker-compatible `scrypt` implementation using `node:crypto`.
- Added a D1 auth regression test that verifies registered users can authenticate with the stored hash.
- Redeployed the Cloudflare worker and validated the live register/login routes against production.
- Removed the temporary remote D1 debug accounts used during diagnosis, leaving only the real user account.

### Why

- Production register requests were redirecting with `error=unexpected`, and login requests for a valid D1 user were returning `500`.
- The root cause was the Cloudflare runtime rejecting the high-iteration PBKDF2 path used in the worker-specific auth implementation.
- Aligning the Cloudflare auth hash flow with a worker-safe `scrypt` path restores account creation and session issuance without changing the user-facing auth contract.

### Validation

- `npx tsx --test packages/storage/src/auth.test.ts packages/storage/src/cloudflare-auth.test.ts`
- `npm run test:storage`
- `npm run deploy:web:cloudflare`
- `curl.exe -i -s -X POST https://arch-competition.com/api/auth/register -H "Content-Type: application/x-www-form-urlencoded" --data-raw "locale=zh&email=<test>&password=password123&passwordConfirmation=password123"`
- `curl.exe -i -s -X POST https://arch-competition.com/api/auth/login -H "Content-Type: application/x-www-form-urlencoded" --data-raw "locale=zh&email=<test>&password=password123"`
- `npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM auth_users; SELECT COUNT(*) AS total FROM auth_sessions;"`

### Modified Files

- `docs/changelog/CHANGELOG_2026-05-26.md`
- `packages/storage/src/cloudflare-auth.test.ts`
- `packages/storage/src/cloudflare.ts`
