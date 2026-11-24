---
title: Storage, Auth And API Architecture
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: done
updated_at: 2026-11-24
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
   |  opportunities | ops | watchlist | savedSearches | auth | mcp | mcpBilling
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

Discover reads one exact aggregate for the total and seven option groups, and one ordered page. Both use the same database snapshot and UTC time. The default view uses the published daily aggregate when available. The deadline sort uses a partial index over notices that are neither archived nor discarded. The query still checks whether the current AI recommendation excludes each notice.

The public list API reads the exact count and requested page. A browser continuation carries the publication version, normalized filters and an expiry. A matching continuation reads the page and checks the version in one batch. A conflict reloads the first page and removes the restored depth from the URL. The reload path for an explicit `loaded` value reads that depth and its total and options in one snapshot.

The image fallback reads the fields used by the locator renderer in one primary-key query. Detail loads the record and its current AI assessment. The dashboard resolves watched IDs in groups of 90. List inputs keep their existing bounds. Short search terms escape LIKE wildcards. Longer patterns use literal substring matching under the same case rules.

Accounts are real: each user has a private workspace (`user:<id>`), the `/ops` surface and `/api/ops/**` are administrator-only, passwords use one self-describing scrypt format on every runtime, sessions are rotated and slide, and every state-changing request is same-origin checked.

## Public access for AI assistants

An architect's AI assistant can search the same records as the website through the Model Context Protocol (MCP). Both list tools include the official URL, publishing-source URL and evidence note in every result. The slug retrieves the full public record.

| Tool | Public data it reads |
| --- | --- |
| `search_competitions` | One deadline-ordered page from `opportunities.feed`. The shared discover filters cover text, jurisdiction, region tag, project type, inclusive deadline dates, fees and licensed-architect requirements. |
| `get_competition` | One `opportunities.getBySlug` record with its source links and evidence note. Unknown fields keep their stored null or empty value. |
| `list_closing_soon` | The same feed, bounded to 1–90 UTC calendar days including today (default 7). |
| `get_taxonomy` | The accepted region tags, project types and fee filter values from the core package. Its result comes from the core package. |

The Next.js route accepts anonymous and API-key Streamable HTTP POST requests at `/mcp`, outside locale and session-cookie middleware. Each request gets its own SDK server and JSON response. An initialized notification returns HTTP 202. GET returns 405. The four tool handlers use only the public feed, slug reader, and controlled values. Requests that call a tool pass through the quota check first. Each tool publishes its core Zod input and output schemas through `tools/list`; the SDK validates tool arguments and structured results against them.

Each POST accepts one message of up to 16 KiB. Lists return 10 rows by default, up to 25, and permit offsets up to 1000. The MCP list tools use one query and fetch at most one extra result to set `hasMore`. The website's discover query still calculates a total. Use `next_offset` to fetch the next page. If it is null and `hasMore` is true, narrow the filters to continue within the offset limit. The complete JSON response is capped at 128 KiB. Each list returns as many complete records as fit and advances by the number returned. When even the next record is too large, the tool returns an explicit error. These bounds apply per request. D1 may scan more rows than it returns.

The fee filter uses the two recorded amounts in euros. Two explicit zeros qualify as free. Either positive amount qualifies as paid. Other combinations, including one zero and one missing amount, have unknown fee status.

### API keys and tool quotas

Discovering the server with `initialize` and `tools/list` is public and costs no calls. A valid `tools/call` request costs one call when admitted, even if its arguments or the tool result produce an error. An invalid or revoked bearer key returns 401 on any request that presents it. The error links to the account dashboard so the user can create or select an active key.

The shared MCP access module defines per-minute and per-month quotas in `MCP_PLANS`. The free and paid keys have their own account quotas. The free plan shares Worker request capacity with the website. The daily budget caps anonymous calls admitted to tool execution and resets at UTC midnight. [Shared MCP access module](../../packages/core/src/mcp-access-contract.ts)

All keys under an account share its counters. An anonymous caller is represented by a salted SHA-256 digest of the Cloudflare client IP. Requests without a valid edge IP share one limit. Configure the stable `ARCH_MCP_ANONYMOUS_SALT` secret in Workers before serving anonymous calls. Changing it starts new anonymous counters. The application log records the caller category, tool name, outcome and duration.

One database statement checks every applicable quota and advances the counters together when it admits a call. For keyed calls, it also checks that the key is still active and reads the current plan. D1 runs the write and the resulting counter read in one transaction. The counter for a new minute, month or day starts on its first admitted call.

The shared daily count uses one reserved row in `mcp_usage`. The first admitted anonymous call on a new day overwrites the previous day's count. The daily D1 sync removes up to 25,000 older anonymous per-IP rows whose month has ended. The cleanup runs outside the request path and leaves account counters in place.

A 429 includes `Retry-After` in seconds. If the shared budget is full, it gives the time to UTC midnight and links to the dashboard for a free API key. That refusal uses neither the per-IP quota nor the daily budget. The response uses `X-RateLimit-{Limit,Remaining,Reset}` for the minute and `X-Quota-{Limit,Remaining,Reset}` for the month. Reset headers use Unix seconds.

The account dashboard uses existing signed-in sessions. `GET /api/mcp/keys` lists up to 50 key records, placing all active keys first. `POST /api/mcp/keys` creates one key and returns its secret once. `DELETE /api/mcp/keys` revokes the specified key and returns its resulting record. An account can have five active keys at once. The last-use timestamp updates at most once per hour per key. The stored digest uses the same SHA-256 encoding as session tokens. Key verification compares the digests in constant time. `GET /api/mcp/usage` returns the account's tier, counters, limits and next resets. The write routes validate the request's origin and the body.

### Stripe test billing

A signed-in user sends `{ locale, interval }` to `POST /api/mcp/billing/checkout` for a hosted Stripe checkout URL. The locale is `en` or `zh`, and the interval is `month` or `year`. `POST /api/mcp/billing/portal` takes `{ locale }`. Both respond with `{ url }`. The return page uses the same locale and sets the `billing` query parameter to `success`, `cancel`, or `portal`. The dashboard reads the usage endpoint after the return. A Checkout success return can arrive before the subscription update.

One account maps to one Stripe customer. Concurrent Checkout requests for the same interval share an attempt and its Stripe request key. A repeated request reuses an open session for that interval. Changing the interval expires the open session before creating a replacement. A user with an existing subscription manages it in the portal, which can offer both Pro intervals. Checkout and Portal handle payment input on Stripe's site.

`POST /api/mcp/billing/webhook` verifies the signed raw request with the Stripe library. For a linked customer, a relevant event causes a fresh read of the current subscription and invoice from Stripe. This handles reordered deliveries. The event ID and the updated access expiry are written together. If another event changed the account during that read, Stripe receives a retry response and the stale evaluation is discarded.

A trial grants access until the trial ends. An active subscription grants access through the current paid period, or an earlier scheduled cancellation date. Accounts with past-due, unpaid, paused, incomplete, or cancelled subscriptions use the free tier. Full refunds of the current invoice also return the account to the free tier. A partial refund preserves access for that period. Keys and current usage remain on the account when a plan changes. [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks)

Billing requires `STRIPE_MCP_SECRET_KEY`, `STRIPE_MCP_WEBHOOK_SECRET`, `STRIPE_MCP_PRICE_ID_MONTH`, and `STRIPE_MCP_PRICE_ID_YEAR`. If either price ID is missing, billing returns `billing_unavailable`. The implementation accepts Stripe test keys and signed test events. Both configured prices grant the same paid entitlement under the subscription rules above. The frontend displays amounts from `MCP_PRICING` in the shared MCP access module. Stripe determines the amount charged. Set `SITE_URL` to the trusted return origin if it differs from the default public site. Configure the webhook for Checkout completion and asynchronous payment outcomes, subscription creation/updates/deletion/pause/resume, paid/failed/voided/uncollectible invoices, and charge/refund status changes. The accepted events are listed in [the Stripe adapter](../../apps/web/src/lib/mcp/stripe.ts). [OpenNext Stripe adapter guidance](https://opennext.js.org/cloudflare/howtos/stripeAPI)

### Web pages for the MCP entry

Three localized pages lead people to the endpoint. None of them links to `/mcp` itself, which answers MCP clients only.

- `/[locale]/connect` is public. It shows the endpoint address with a copy button, the anonymous and free-key limits, one tab per client (Claude, Claude Code, Cursor, VS Code, other), and three example questions. A signed-in visitor can create a key on the page; anyone can paste a key they kept. That key is held in page memory for the visit and filled into the commands, hidden until shown. The address is `SITE_URL` + `/mcp`, the request host only in local development, and `https://arch-competition.com/mcp` otherwise.
- `/[locale]/dashboard` starts with the AI-access section: keys (create, list, revoke with confirmation), usage meters for the month and minute windows, and the plan with a monthly or yearly upgrade or the customer portal. Watchlist and saved searches follow.
- `/[locale]/pricing` is public. It lists the three tiers from `MCP_PLANS` and `MCP_PRICING`, with a sign-up link that returns to the connect page (free key) or to the plan section of the dashboard (Pro).

Each client tab follows that client's own documentation. Claude Code uses `claude mcp add --transport http` with an optional `--header`. Cursor uses an `mcpServers` entry with `url` and `headers`, and its `cursor://anysphere.cursor-deeplink/mcp/install` link carries the base64 entry. VS Code uses a `servers` entry of `type: "http"`, and its `vscode:mcp/install` link carries the URL-encoded entry with a `name`. On claude.ai a custom connector with "No sign in" uses the anonymous limits. Request headers for a key are in beta there and only some organizations see them. [Claude Code MCP](https://code.claude.com/docs/en/mcp) · [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [Claude request headers](https://claude.com/docs/connectors/custom/add-unlisted) · [Cursor MCP](https://cursor.com/docs/mcp) · [Cursor install links](https://cursor.com/docs/mcp/install-links) · [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration) · [VS Code install URL](https://code.visualstudio.com/api/extension-guides/ai/mcp)

A key's plaintext exists only in the create response, the one-time dialog, page memory and the clipboard. It is never stored in the browser, logged or placed in an http(s) URL. The install links are `cursor:` and `vscode:` URLs that hand the configuration to the local application; they are built when the button is clicked.

Every failed request maps to one next step, decided by `mcpNextStep` in `apps/web/src/lib/mcp-account.ts`. Examples: sign in for 401, reload for a rejected origin, revoke a key for a full key list, open the portal for an existing subscription, and retry after `Retry-After` for 503. After `?billing=success` the dashboard reads usage up to five times, three seconds apart. It then reports the Pro plan or says that confirmation is still pending. The `billing` parameter is removed from the address bar.

### About, legal pages and footer

The paid plan needs public terms, a refund policy and a privacy notice. They live at `/[locale]/terms`, `/[locale]/refund` and `/[locale]/privacy`; `/[locale]/about` describes the project, its sources, contact and the cookies the site sets. All four render one reading column (`components/legal-document.tsx`) from the `legal` and `about` dictionaries, with a "last updated" date on the three legal pages.

- One list, `apps/web/src/lib/legal-links.ts`, feeds the footer, the About page and the pricing page. Paths are locale-independent and rendered with the locale prefix.
- Facts the pages state come from code, not prose: plan limits and prices from `MCP_PLANS` and `MCP_PRICING`, the key limit from `MCP_MAX_ACTIVE_KEYS`, the session length from the cookie lifetime, and the operator (name, contact email from `SUPPORT_LINKS`, governing law, optional address, tax id and country) from `apps/web/src/lib/operator.ts`. An optional operator field that is null is not shown.
- The cookie table on the About page is built from `SITE_STORAGE` in `apps/web/src/lib/site-storage.ts`: the session cookie, the language cookie and the `theme` item in localStorage. The site sets nothing else, so there is no consent banner. A button clears the language cookie and the theme; the HttpOnly session cookie is kept. `apps/web/src/lib/legal-content.test.ts` checks the table against the code that sets each item.
- The footer is one line on every page except discover and opportunity pages, which keep their full-bleed list. Sign-up (page and dialog) carries one consent line linking the terms and the privacy notice; there is no checkbox.

### Connector sign-in feasibility

OAuth connector sign-in is deferred. The existing account login can identify the user on a consent page. The Cloudflare provider also needs a durable KV binding for clients, authorization grants and tokens. Its documented OpenNext integration uses a custom Worker entry point. The existing Worker uses the generated OpenNext entry and has no OAuth binding. [Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider) · [OpenNext custom Worker](https://opennext.js.org/cloudflare/howtos/custom-worker)

The installed MCP SDK's server authorization router uses Express and supplies the OAuth HTTP handlers. It requires the application to supply the registered-client store, consent, code exchange and token validation. Mounting it would require an Express adapter or standalone service and a second implementation of the authorization state. [MCP TypeScript SDK](https://github.com/modelcontextprotocol/typescript-sdk)

With explicit approval for those bindings, prototype the maintained Cloudflare provider locally. Authenticate consent with the existing account session and pass the signed-in account ID into the same quota check as API keys. Use an explicit protected connector resource so anonymous tools can continue at the public entry. Publish Protected Resource Metadata and issuer metadata. Require authorization codes with PKCE S256, which binds the browser approval to the application that requested it. Validate the target resource and exact callback URL. Prefer Client ID Metadata Documents and offer Dynamic Client Registration for clients that need it. Test the actual browser consent round trip in Claude and ChatGPT before enabling it. [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) · [Claude connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp) · [ChatGPT authentication](https://developers.openai.com/plugins/build/auth)

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
| `packages/storage/src/mcp/*` | API-key ownership, quota reservations and the local view of Stripe entitlement | HTTP, Stripe requests |
| `packages/core` | Vocabularies, zod schemas, fee rule, logger | Database access |
| `apps/web/src/lib/auth.ts` | `requirePageUser/Admin`, `requireApiUser/Admin`, admin allow-list | SQL |
| `apps/web/src/lib/api/*` | Route logic as handler factories: CSRF, content type, zod validation, error envelope | Reading the database directly |
| `apps/web/src/app/api/**/route.ts` | Thin exports of those handlers | Logic |
| `apps/web/src/lib/mcp-{connect,account,requests}.ts` | Client install snippets, account-page decisions (usage level, savings, key rules, billing return, next step after a failure), typed browser calls checked against core schemas | Prices or limits of its own, storage access |
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

Registration answers every "cannot register" case that could reveal an existing account with the single code `registration_failed`, hashes the password before touching the database (equal timing) and is limited to 5 attempts per IP per hour. **Email ownership is unverified.** Billing access follows the Stripe customer linked to the signed-in account ID. Verify email ownership before relying on the address for notifications, account recovery, or identity checks.

### 11. Transitional English labels

`StoredOpportunityFeedItem` still carries English `*Label` fallbacks (status, procedure, fee, deadline...) because current components and the JSON API use them. Remove them when every consumer localises from the `*Key` fields.

### 12. Cloudflare D1 query limits

The exact aggregate deduplicates stored option values during one scan. The read layer applies the shared taxonomy order and procedure aliases to those values. An aggregate above the D1 size limit falls back to the exact count and two grouped queries in a fresh batch with the page. These grouped queries use four and three compound SELECT terms, below D1's limit of five. Tests cover the statement parameter budget and the 50-byte LIKE pattern limit.

### 13. Publishing the default discover summary

A content signature covers the worker export. Another covers visible opportunities and their displayed fields. A matching export needs one indexed marker lookup. Time-dependent retention can still delete rows. Changed imports acquire the marker and publish only after all files finish. A diagnostics-only change preserves the public version. The summary remains valid until the next deadline changes the visible set, and a second payload covers that change day. A missing or incompatible summary and an interrupted import use the existing live read. The website reads the summary and page in the same batch. MCP keeps its existing list query. See the [deploy runbook](../../CLOUDFLARE_DEPLOY_RUNBOOK.md).

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

The collection queue and its interrupted search windows live only in worker SQLite. Web, MCP and D1 export continue to read published records. A missing or low qualification score is eligible for publication.
