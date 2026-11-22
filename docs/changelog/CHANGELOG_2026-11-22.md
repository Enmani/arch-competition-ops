---
title: Read-only competition search for AI assistants
status: done
updated_at: 2026-11-22
goal_doc: docs/goals/2026-04-19-future-direction.md
structure_doc: docs/structures/2026-10-21-storage-auth-api-architecture.md
---

# 2026-11-22

## Public competition search through MCP

### Changed

Added the four public tools described in the [API architecture](../structures/2026-10-21-storage-auth-api-architecture.md#public-access-for-ai-assistants). Region tags and participation fees now use the shared discover filters.

### Why

Architects can ask an assistant to find relevant opportunities and verify the source evidence for an individual result.

### Validation

- `npm run check`
- `npm run build:web` and `npm run build:web:cloudflare`
- Local OpenNext Worker with a local D1 fixture on port 3400. Anonymous curl requests to initialize the protocol, list the tools and call all four tools returned HTTP 200 with JSON. The fee and region search found the fixture and the detail call preserved both source links and the evidence note.

### Modified Files

- `apps/web/package.json`, `package-lock.json`
- `apps/web/src/app/mcp/route.ts`, `apps/web/src/middleware.ts`
- `apps/web/src/lib/mcp/http.ts`, `apps/web/src/lib/mcp/server.ts`, `apps/web/src/lib/mcp/http.test.ts`
- `apps/web/src/lib/discover.ts`, `apps/web/src/lib/discover.test.ts`
- `packages/core/src/mcp-contract.ts`, `packages/core/src/index.ts`, `packages/core/src/discover-filters.ts`, `packages/core/src/taxonomy.ts`, `packages/core/src/participation-fee.ts`
- `packages/storage/src/opportunities/query.ts`, `packages/storage/src/taxonomy-consistency.test.ts`, `packages/storage/src/workspace/filters.ts`, `packages/storage/src/workspace.test.ts`
- `docs/goals/2026-04-19-future-direction.md`, `docs/structures/2026-10-21-storage-auth-api-architecture.md`, `docs/changelog/CHANGELOG_2026-11-22.md`

## API keys, quotas and test subscriptions

### Changed

Added account-owned API keys, two concurrent call limits and test-mode Stripe Checkout and Customer Portal. Key management and billing use the existing web session. The [API architecture](../structures/2026-10-21-storage-auth-api-architecture.md#api-keys-and-tool-quotas) describes the request flow, subscription rules and the deferred OAuth design.

### Why

Architects can try all four tools anonymously, then raise the call limits through a free key or a subscription. The call allowance follows the account across key rotation and plan changes.

### Validation

- Local OpenNext Worker on port 3400 and local D1. Six concurrent anonymous calls returned five 200 responses and one 429 with a free-key link. A new key raised the limits. The next call after revocation returned 401.
- `npm run test:web` covers session-protected key routes, public MCP discovery, hosted billing requests, signature checking and subscription changes using fake Stripe responses. `npm run test:storage` covers the quota windows, parallel requests, key revocation and duplicate billing events.

- `npm run check`, `npm run build:web` and `npm run build:web:cloudflare` passed.
- The local Worker accepted a signed test webhook and rejected both a wrong signature and a live event. The fixture did not call Stripe.

### Modified Files

- `.env.example`, `apps/web/package.json`, `package-lock.json`
- `apps/web/migrations/0009_mcp_access.sql`, `apps/web/migrations/0010_mcp_stripe_billing.sql`, `apps/worker/src/arch_competition_ops/storage/schema.py`
- `packages/core/src/mcp-access-contract.ts`, `packages/core/src/api-contract.ts`, `packages/core/src/index.ts`
- `packages/storage/src/mcp/{keys,usage,billing}.ts`, `packages/storage/src/mcp/{access,billing}.test.ts`, `packages/storage/src/storage.ts`
- `apps/web/src/app/api/mcp/{keys,usage}/route.ts`, `apps/web/src/app/api/mcp/billing/{checkout,portal,webhook}/route.ts`
- `apps/web/src/lib/api/{http,mcp-keys,mcp-billing}.ts`, `apps/web/src/app/mcp/route.ts`
- `apps/web/src/lib/mcp/{http,access,server,stripe}.ts`, `apps/web/src/lib/mcp/{http,access,billing}.test.ts`
- `docs/goals/2026-04-19-future-direction.md`, `docs/structures/2026-10-21-storage-auth-api-architecture.md`

## Monthly and annual Pro billing

### Changed

Checkout accepts a monthly or annual interval and replaces an open session when the interval changes. Both configured Stripe prices grant paid access. Updated the shared quota values and added a shared display price for each interval. The [billing architecture](../structures/2026-10-21-storage-auth-api-architecture.md#stripe-test-billing) describes the request and required settings.

The worker's existing schema initializer reads the SQL mirror from a dedicated file.

### Why

Architects can choose how often to pay and change the interval in Stripe's portal while keeping access. The free quota gives individual architects room to evaluate the tools. The paid product focuses on functions such as deadline alerts.

### Validation

- `npm run check` includes storage and web tests for both Checkout prices, switching an open session, signed events with fake Stripe, and the minute and month quota boundaries with a fake clock.
- `npm run build:web` and `npm run build:web:cloudflare`.
- The local OpenNext Worker used a fresh D1 database. It returned the free allowance for a new account, rejected a Checkout request missing its interval, and accepted a signed test event for an unlinked customer.

### Modified Files

- `.env.example`, `packages/core/src/mcp-access-contract.ts`
- `apps/web/migrations/0010_mcp_stripe_billing.sql`, `apps/worker/src/arch_competition_ops/storage/{schema,schema_sql}.py`, `apps/worker/README.md`
- `apps/web/src/lib/api/mcp-billing.ts`, `apps/web/src/lib/mcp/stripe.ts`, `apps/web/src/lib/mcp/billing.test.ts`
- `packages/storage/src/mcp/billing.ts`, `packages/storage/src/mcp/billing.test.ts`, `packages/storage/src/mcp/access.test.ts`, `packages/storage/src/migrations.test.ts`
- `docs/goals/2026-04-19-future-direction.md`, `docs/structures/2026-10-21-storage-auth-api-architecture.md`, `docs/changelog/CHANGELOG_2026-11-22.md`

## Connect page, account keys and pricing

### Changed

Added the web pages for the MCP entry: a public connect page with per-client setup, an AI-access section at the top of the account page (keys, usage, plan and upgrade), and a public pricing page. The top bar links to the connect page and to pricing. The sign-in and sign-up pages keep the return path when switching between them. The [API architecture](../structures/2026-10-21-storage-auth-api-architecture.md#web-pages-for-the-mcp-entry) describes the pages, the client sources and the key handling.

### Why

An architect can copy the address and get a first answer without an account, create a key in place after signing up, and upgrade from the account page in two clicks before Stripe.

### Validation

- `npm run check` passed (includes the new `apps/web/src/lib/mcp-connect.test.ts` and `apps/web/src/lib/mcp-account.test.ts`).
- `npm run build:web` and `npm run build:web:cloudflare` passed.
- `npx playwright test tests/visual/mcp-flow.spec.ts --project desktop --project mobile --workers 2` against `next dev` on port 3400 with a copy of the local database: 8 passed. The flow signs up from the connect page, creates a key, finds it in the commands, calls `/mcp` with it on the free plan, sees the call counted, and sends a checkout request to a locally fulfilled Stripe stand-in. Screenshots for light and dark go to `artifacts/visual/mcp`.

### Modified Files

- `apps/web/src/app/[locale]/connect/page.tsx`, `apps/web/src/app/[locale]/pricing/page.tsx`, `apps/web/src/app/[locale]/dashboard/page.tsx`, `apps/web/src/app/[locale]/login/page.tsx`, `apps/web/src/app/[locale]/register/page.tsx`
- `apps/web/src/components/{connect-surface,connect-clients,connect-key-strip,mcp-snippet,mcp-error-notice,mcp-key-dialog,mcp-keys-panel,mcp-usage-meters,mcp-plan-block,mcp-account-panel,site-shell}.tsx`
- `apps/web/src/lib/{mcp-connect,mcp-account,mcp-requests,legal-links,use-is-client}.ts`, `apps/web/src/lib/{mcp-connect,mcp-account}.test.ts`
- `apps/web/src/i18n/slices.ts`, `apps/web/src/i18n/dictionaries/{zh,en}/{mcp,index,shell,meta,dashboard}.ts`
- `apps/web/src/app/globals.css`, `apps/web/src/app/styles/{tokens,mcp,mcp-account,pricing}.css`
- `tests/visual/mcp-flow.spec.ts`
- `docs/goals/2026-04-19-future-direction.md`, `docs/structures/2026-10-21-storage-auth-api-architecture.md`, `docs/changelog/CHANGELOG_2026-11-22.md`

## About page, legal pages and footer

### Changed

Added `/[locale]/about`, `/[locale]/terms`, `/[locale]/privacy` and `/[locale]/refund` in Chinese and English, a one-line footer on every page except discover and opportunity pages, an About link in the top bar, and a consent line on sign-up. The [API architecture](../structures/2026-10-21-storage-auth-api-architecture.md#about-legal-pages-and-footer) describes where each stated fact comes from. On narrow screens the top-bar links use less side padding, and the brand keeps the width of its longest word, so the extra link does not overlap the wordmark.

### Why

A paid plan needs public terms, a refund policy and a privacy notice. The discover list stays unchanged so scanning projects stays fast.

### Validation

- `npx tsx --test apps/web/src/lib/legal-content.test.ts`: legal links resolve to pages, en and zh sections match, placeholders fill, plan rows come from `MCP_PLANS` and `MCP_PRICING`, and the cookie table matches the code.
- `npx playwright test tests/visual/legal-pages.spec.ts --project desktop` against `next dev` on port 3400 with a copy of the local database: 30 passed, 2 skipped (zh discover has no recorded baseline). `/en/discover` matched the layout signature recorded before the change at 1280 and 390 px. Screenshots go to `artifacts/visual/legal`.
- `npm run check`, `npm run build:web` and `npm run build:web:cloudflare`.

### Modified Files

- `apps/web/src/app/[locale]/{about,terms,privacy,refund}/page.tsx`, `apps/web/src/app/[locale]/{layout,pricing/page,register/page}.tsx`
- `apps/web/src/components/{legal-document,legal-extras,about-cookies,preferences-reset,consent-line,site-footer,support-link-list}.tsx`, `apps/web/src/components/{site-shell,support-surface,auth-dialog,theme-toggle}.tsx`
- `apps/web/src/lib/{operator,legal-content,site-storage}.ts`, `apps/web/src/lib/legal-content.test.ts`, `apps/web/src/lib/{legal-links,session-cookie,theme}.ts`, `apps/web/src/i18n/config.ts`, `apps/web/src/middleware.ts`
- `apps/web/src/i18n/dictionaries/legal-section.ts`, `apps/web/src/i18n/dictionaries/{zh,en}/{about,legal,legal-terms,legal-privacy,legal-refund,index,shell,mcp}.ts`
- `apps/web/src/app/globals.css`, `apps/web/src/app/styles/{legal,layout}.css`
- `tests/visual/legal-pages.spec.ts`
- `docs/goals/2026-04-19-future-direction.md`, `docs/structures/2026-10-21-storage-auth-api-architecture.md`, `docs/changelog/CHANGELOG_2026-11-22.md`

## Shared anonymous MCP budget and hourly key timestamps

### Changed

Added the shared UTC-day admission limit and linked expired anonymous usage to the daily D1 cleanup. The two list tools now expose `hasMore` with their existing next offset. A key's last-use timestamp updates at most once per hour. [API architecture](../structures/2026-10-21-storage-auth-api-architecture.md#api-keys-and-tool-quotas)

### Why

The website and MCP share the Worker request budget. The daily admission limit caps anonymous calls that reach tool execution, and hourly timestamps reduce key writes.

### Validation

- `npm run check`
- `npm run build:web`
- `npm run build:web:cloudflare`
- Local Workerd with a fixture D1 database exercised concurrent admission, the 429 response, UTC midnight, pagination, hourly key timestamps and retention.

### Modified Files

- `packages/core/src/mcp-access-contract.ts`, `packages/core/src/mcp-contract.ts`
- `packages/storage/src/mcp/usage.ts`, `packages/storage/src/mcp/access.test.ts`
- `apps/web/src/lib/mcp/access.ts`, `apps/web/src/lib/mcp/http.ts`, `apps/web/src/lib/mcp/server.ts`, `apps/web/src/lib/mcp/access.test.ts`, `apps/web/src/lib/mcp/http.test.ts`
- `scripts/lib/d1-sync/retention.mjs`, `scripts/export-d1-data.mjs`, `tests/d1-retention-apply.test.mjs`
- `CLOUDFLARE_DEPLOY_RUNBOOK.md`, `docs/structures/2026-10-21-storage-auth-api-architecture.md`, `docs/changelog/CHANGELOG_2026-11-22.md`
