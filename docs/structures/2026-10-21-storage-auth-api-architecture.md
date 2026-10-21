---
title: Storage, Auth And API Architecture
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: done
updated_at: 2026-10-21
related_docs:
  - docs/AI_CONSTRAINTS.md
  - docs/structures/2026-04-22-workspace-follow-up-architecture.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
  - reports/2026-10-21-code-audit.md
---

# Storage, Auth And API Architecture

> 文件开头状态：done

This document is the architecture decision record for the 2026-10-21 audit round (P1, P3, P4, P5, P7 and S1-S6 of `reports/2026-10-21-code-audit.md`). It states the stable shape of the TypeScript data layer, the authentication and authorisation model, the API contract, and every non-obvious decision together with its risk and removal condition.

## Completed-State Architecture

One storage implementation serves every runtime.

```
apps/web (pages, route handlers, middleware)
   |  getStorage()                      apps/web/src/lib/server-storage.ts
   v
packages/storage  createStorage({ reader, writer })      runtime-agnostic: no fs, no better-sqlite3
   |  opportunities | ops | watchlist | savedSearches | auth        one SQL dialect, one code path
   v
D1DatabaseLike driver interface (prepare / bind / all / first / run / batch)
   |-- Cloudflare D1 binding            (asD1Driver, production and `ARCH_COMPETITION_USE_D1_IN_DEV=1`)
   '-- better-sqlite3 adapter           (@arch-competition/storage/node, `next dev` and tests)
packages/core   vocabularies, zod contracts (filters, API bodies), fee rule, logger
apps/web/migrations/*.sql   the only schema authority
```

- `batch()` is the only multi-statement atomicity primitive (D1 rejects explicit transactions; the SQLite adapter wraps a batch in one transaction).
- The Worker bundle contains `@arch-competition/storage` only. The Node entry (`/node`) is imported behind a literal `process.env.NODE_ENV === "development"` test so production bundles drop it.
- Two SQLite connections locally, one adapter: a read-only `reader` for opportunity and diagnostics reads, a read-write `writer` for everything the Web app owns (auth, workspace, review decisions). `journal_mode` belongs to the Python worker (WAL); both connections only set `busy_timeout = 5000`. `SQLITE_BUSY` becomes `StorageBusyError` and the API answers `503` + `Retry-After`, never an empty list.

## Capability Summary

The read model is computed in SQL: filters, sort, `LIMIT/OFFSET`, a separate `COUNT` and filter options (`GROUP BY` / `json_each`) are one three-statement `batch()` per discover render. Detail lookup is a primary-key read, the dashboard resolves watched ids with one `IN` query per 90 ids, `LIKE` terms are escaped, numeric inputs are clamped (`limit` default 24, max 100) and dates must be real ISO calendar dates.

Accounts are real: each user has a private workspace (`user:<id>`), the `/ops` surface and `/api/ops/**` are administrator-only, passwords use one self-describing scrypt format on every runtime, sessions are rotated and slide, and every state-changing request is same-origin checked.

## Shared Model

- `competitions.organizer` is the real buyer or `''` when unknown; `authority_name` wins over it for display; `source_name` / `source_id` are the publishing platform and are never shown as the buyer. `officialUrl` is `null` unless the worker stored one.
- Fees: `NULL` is unknown ("pending"); only an explicit `0` is "no participation fee". The rule is `describeParticipationFee` in `packages/core` and is used by storage (English fallback label) and by the web formatter (localised label).
- Classification (`project_types`, `building_categories`, `design_scopes`, `project_modes`) is read from the columns the worker wrote. See Decision 4.
- Vocabularies live in `packages/core/src/taxonomy.ts`; `taxonomy-consistency.test.ts` compares them with `config/taxonomy.yml`.
- Procedure aliases have one copy: `config/procedure-type-registry.json`, imported as JSON (inlined by bundlers, so workerd needs no filesystem).

## Module Boundaries

| Module / Area | Responsibility | Must Not Own |
| --- | --- | --- |
| `apps/web/migrations/*.sql` | The only table/index definitions (D1 applies them with `wrangler d1 migrations apply`) | Data backfills that need application logic |
| `packages/storage/src/driver/*` | Driver interface, D1 validation, better-sqlite3 adapter, SQL helpers, storage errors | Business rules |
| `packages/storage/src/node/*`, `node.ts` | Local file paths, migration runner (`schema_migrations`), connection opening and caching | Anything imported by the Worker |
| `packages/storage/src/opportunities/*` | Query building, row mapping, facets, repository functions | Auth, workspace state |
| `packages/storage/src/ops/*` | Source health, duplicate pressure, review queue and atomic decisions | Choosing who may decide |
| `packages/storage/src/workspace/*` | Watchlist and saved searches keyed by an already-authorised workspace key | Deriving the key from a request |
| `packages/storage/src/auth/*` | Password hashing, users, sessions, throttling | Cookies, HTTP |
| `packages/core` | Vocabularies, zod schemas, fee rule, logger | Database access |
| `apps/web/src/lib/auth.ts` | `requirePageUser/Admin`, `requireApiUser/Admin`, admin allow-list | SQL |
| `apps/web/src/lib/api/*` | Route logic as handler factories: CSRF, content type, zod validation, error envelope | Reading the database directly |
| `apps/web/src/app/api/**/route.ts` | Thin exports of those handlers | Logic |
| `scripts/export-d1-data.mjs` | Worker-owned tables to D1 as incremental upserts | User tables (never touched) |

## Main Flows

1. Request authentication: cookie (`__Host-arch_competition_ops_session` in production) -> SHA-256 hex -> `auth_sessions` -> user. A session renews to 30 days at most once a day; `middleware.ts` re-issues the cookie so the browser lifetime follows.
2. Login: same-origin + form check -> throttle (5 failed attempts per IP+email, 30 per IP, per 15 min) -> scrypt verify (unknown email still pays a dummy verification) -> legacy hash upgrade -> new session token (the presented one is retired) -> `303` to a sanitised, locale-prefixed return path.
3. Authorisation: anonymous API call `401`; signed-in non-administrator on `/api/ops/**` `403`; `/ops` page: anonymous -> login with `next`, non-administrator -> localized forbidden panel (HTTP 200; no ops data loaded). Administrators are the emails in `ARCH_OPS_ADMIN_EMAILS` (comma separated, case-insensitive).
4. Error contract: `{ error: { code, message } }` with codes from `packages/core/src/api-contract.ts`; unexpected failures are `500` with a generic message and a structured log line (`web.api` logger, credential-looking keys redacted).

## Decision Records

### 1. Single runtime, local migration runner

Reason: the audit found about 3000 duplicated lines with behavioural drift. Risk: the local runner splits statements on `;` after stripping `--` comments, so a migration may not contain `;` inside a string or a trigger body (a test enforces this). Remove when: D1 and local development can both use `wrangler`'s local D1 only.

### 2. Password format and cost

`$scrypt$ln=14,r=8,p=5$<salt b64url>$<hash b64url>`, 16-byte salt, 32-byte hash, constant-time comparison, parameters read back from the string. OWASP suggests N=2^14, r=8, p=5. **CPU cost on Cloudflare Workers has not been measured** (about 170 ms on a development machine). Measure `wrangler tail` CPU time before opening sign-ups; if too high, lower `p` in `SCRYPT_PARAMS` (old hashes keep verifying and upgrade on login) and regenerate `DUMMY_PASSWORD_HASH`.

### 3. Legacy password hashes (data migration path)

Production users registered with the Workers format `scrypt$16384$8$1$<b64url salt>$<b64url hash>`; the Node format used hex and the hex string itself as the salt. Both are accepted **read-only** by `verifyPassword`, and a successful login rewrites the hash in the current format (compare-and-set). Remove `parseLegacyFormats` when `SELECT COUNT(*) FROM auth_users WHERE password_hash LIKE 'scrypt$%'` is 0 in production (inactive users may need a reset instead).

### 4. Classification is read, not re-derived

The previous TypeScript heuristics (keyword lists in several languages) ran on every row and could not be pushed into SQL. Filters now use `json_each` on the stored columns and every row is mapped once. Risk: rows whose columns are `'[]'` have no facets, and the old heuristics also produced `sport_leisure`, `culture_heritage` and `transport_infrastructure`, which the worker's `infer_building_categories` does not. The worker must produce the same categories at ingestion (owner: worker; until then those three facets are only populated for records the GGZY collector classifies). `design_scopes` and `project_modes` are written by the worker but are not yet listed in `config/taxonomy.yml`.

### 5. Saved-search uniqueness

Migration 0005 removes duplicate groups (keeping the most recently updated row, ties by highest id) and adds a unique index on `(workspace_key, filters_json)`. SQLite cannot compute SHA-256 to backfill a hash column, so the canonical filters text is the key; the application always writes it in fixed key order with sorted arrays and without paging fields. Saving identical filters under a new name renames the existing search.

### 6. Session token encoding

Tokens are 32 random bytes (base64url); the database stores their SHA-256 as lowercase hex. Earlier releases stored base64url, so 0005 deletes all `auth_sessions` rows: every user signs in once after deploy.

### 7. Workspace ownership

The workspace key is `user:<id>`, derived in `workspaceKeyForUser` only. Rows written under the old shared key `local_practice` are unreachable (they were shared by all visitors and cannot be attributed to a user); delete them when convenient: `DELETE FROM workspace_watchlist_entries WHERE workspace_key = 'local_practice'` and the same for saved searches. `ARCH_WORKSPACE_KEY`, `ARCH_ENABLE_WORKSPACE_WRITES` and `ARCH_ENABLE_OPS_REVIEW` no longer exist.

### 8. CSRF policy

State-changing methods require `Origin` host equal to the request host (scheme ignored because TLS ends at the edge). Without `Origin`: `Sec-Fetch-Site` of `same-origin`/`none`, otherwise a matching `Referer`, otherwise `403`. JSON endpoints require `Content-Type: application/json` (`415` otherwise); the auth endpoints require form encodings. Logout is `POST` only; `scope=all` signs out every session of the user.

### 9. Throttling is best-effort

`auth_attempts` stores only SHA-256 hashes of IP and email. Concurrent requests can slip a few extra attempts through between check and record. The client IP comes from `CF-Connecting-IP`, falling back to `X-Forwarded-For`, which a non-Cloudflare deployment would have to sanitise. Browsers receive a redirect with `error=too_many_attempts`; clients that do not accept HTML receive `429` + `Retry-After`.

### 10. Account enumeration and email verification

Registration answers every "cannot register" case that could reveal an existing account with the single code `registration_failed`, hashes the password before touching the database (equal timing) and is limited to 5 attempts per IP per hour. **Email ownership is not verified** (needs an external mail service): anyone can register any address, which is acceptable only while accounts guard nothing beyond a private watchlist. Revisit before adding notifications.

### 11. Transitional English labels

`StoredOpportunityFeedItem` still carries English `*Label` fallbacks (status, procedure, fee, deadline...) because current components and the JSON API use them. Remove them when every consumer localises from the `*Key` fields.

### 12. Cloudflare D1 limits that SQLite does not enforce

D1 accepts at most 5 terms in a compound SELECT and 100 bound parameters per statement; plain SQLite accepts far more, so tests on the local adapter cannot find violations by themselves. The facet queries are therefore split in two statements (4 and 3 terms) and `opportunities-query.test.ts` pins both limits for the worst-case query. The full stack (OpenNext bundle, D1 binding, `json_each`, `batch`, scrypt through `node:crypto`, middleware) was smoke-tested on a local workerd with `wrangler dev`; that is where the compound-term limit was found. Repeat such a smoke test after changing SQL.

## Extension Points

- Add a driver for another SQLite-compatible service by implementing `D1DatabaseLike`.
- Add roles beyond the email allow-list by extending `requireApiAdmin`/`requirePageAdmin` only.
- Replace the throttling store with Cloudflare's rate-limiting binding without touching callers (`checkThrottle`/`recordAttempt`).

## Out Of Scope

- Email verification, password reset, MFA.
- Full-text search (FTS5) and per-language collation.
- Moving classification into a Python-side backfill job (tracked in Decision 4).

## Linked Plans

- `docs/plans/2026-04-19-07-saved-search-and-watchlists-plan.md`
- `docs/plans/2026-04-30-cloudflare-workers-d1-deployment-plan.md`
