# Cloudflare Deploy Runbook

This file is the standard handoff for deploying Arch Competition Ops to Cloudflare.

Production targets:

- Worker: `arch-competition-ops`
- D1 database: `arch-competition-ops`
- Custom domains:
  - `https://arch-competition.com`
  - `https://www.arch-competition.com`
- Workers URL:
  - `https://arch-competition-ops.arch-competition-ops.workers.dev`

## Before You Start

Run from the repository root:

```powershell
cd C:\Users\fangx\arch-competition-ops
git status
```

If local changes should be included in production, commit and push them first.

If GitHub has newer commits, pull them first:

```powershell
git pull
```

## Cloudflare Authentication

Use a Cloudflare User API token for every deploy, migration, and D1 import command in this runbook.
Do not rely on `wrangler login` on this Windows host.

Create the token from `My Profile -> API Tokens` and scope it to the production account and zone.

Recommended permissions:

- `Account` -> `Workers Scripts` -> `Edit`
- `Account` -> `D1` -> `Edit`
- `Zone` -> `Workers Routes` -> `Edit`
- `Zone` -> `Zone` -> `Read`

Recommended resource scope:

- `Account Resources` -> `Include` -> `Specific account` -> `Fangxiaoyandi@gmail.com's Account`
- `Zone Resources` -> `Include` -> `Specific zone` -> `arch-competition.com`

Before running any Cloudflare command, inject the token into the current PowerShell session:

```powershell
$env:CLOUDFLARE_API_TOKEN="paste-token-here"
$env:CLOUDFLARE_ACCOUNT_ID="9b32ab0cdd1d91002ccfc9b45882b4db"
npm --workspace apps/web exec -- wrangler whoami
```

Expected:

- Wrangler reports `You are logged in with an User API Token`
- the account ID is `9b32ab0cdd1d91002ccfc9b45882b4db`

If the shell is closed, set both environment variables again before retrying deploy commands.

## Satellite Geocoder Secrets

The Worker no longer generates previews, so it needs no map-provider credentials: geocoding and tile fetching happen offline in `packages/previews`. Put the optional keys (`ARCH_SATELLITE_BAIDU_AK`, `ARCH_SATELLITE_BAIDU_SK`, `ARCH_SATELLITE_AMAP_KEY`) and `ARCH_PREVIEW_CONTACT` in the local `.env` of the machine that runs the generator, and remove any `ARCH_SATELLITE_*` Worker secrets left over from the old runtime pipeline. See "Preview images: prewarm + R2/ASSETS" at the end of this runbook.

## Operations Admin Access

The `/ops` pages and `/api/ops/**` are restricted to administrators. An administrator is a registered, signed-in user whose email appears (case-insensitively) in the `ARCH_OPS_ADMIN_EMAILS` Worker secret, a comma-separated list. Without it nobody can open the operations surface.

```powershell
npm --workspace apps/web exec -- wrangler secret put ARCH_OPS_ADMIN_EMAILS
```

Enter the addresses when prompted, for example `first@example.com,second@example.com`. Register those accounts on the site first. The old `ARCH_ENABLE_OPS_REVIEW`, `ARCH_ENABLE_WORKSPACE_WRITES` and `ARCH_WORKSPACE_KEY` variables are no longer read and can be deleted from the Worker settings.

Before the first deploy that contains migration `0005`, apply it with `npm run d1:migrate:remote` (Case 3). It signs every user out once (session token hashes changed encoding) and removes duplicate saved searches. Passwords are unaffected; old hashes are upgraded on each user's next login. Measure scrypt CPU time with `wrangler tail` after the first logins (see `docs/structures/2026-10-21-storage-auth-api-architecture.md`, decision 2).

## Case 1: Code Or UI Changed

Use this when pages, API routes, components, styles, config, or package dependencies changed.

```powershell
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build:web:cloudflare
npm run deploy:web:cloudflare
```

Verify:

```powershell
curl.exe -I https://arch-competition.com/zh/discover
curl.exe -I https://www.arch-competition.com/zh/discover
curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"
```

Expected:

- page checks return `HTTP/1.1 200 OK`
- headers include `server: cloudflare` and `x-opennext: 1`
- API returns JSON with `opportunities`

## Case 2: Local Opportunity Data Changed

Use this when scraping/ingestion updated `data/competitions.sqlite` and production D1 needs the new records.

First take a backup (see [D1 Backup Before Import](#d1-backup-before-import)), then export and import:

```powershell
npm run d1:export-data
```

The exporter prints the exact `wrangler d1 execute` commands and writes them to `manifest.json`.
Run them one by one, in the printed order (`0001-...sql`, `0002-...sql`, ..., and `0099-prune.sql` only when `--prune` was used):

```powershell
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-sync/<UTC-timestamp>/0001-competitions.sql
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-sync/<UTC-timestamp>/0002-competitions.sql
```

How the sync behaves:

- The export is an incremental upsert (`INSERT ... ON CONFLICT DO UPDATE`). It syncs only the worker-owned tables: `competitions`, `source_runs`, `source_health`, and `ops_review_queue_items` rows with `origin = 'worker_diagnostic'`.
- It never touches user data: `workspace_*`, `ops_review_decisions` and `auth_*` are not read and not written. Review queue rows keep their human `status`, `first_detected_at` and `updated_at`; only the diagnostic fields are refreshed.
- It emits no `DELETE` unless you pass `--prune` (below).
- The local database is read from `ARCH_COMPETITION_OPS_DB` (relative paths resolve against the repository root; default `data/competitions.sqlite`).
- Before writing anything the exporter checks that the local database has exactly the columns defined by `apps/web/migrations/*.sql` for the four synced tables. On any difference it prints the diff, exits with code 1 and writes no files. Fix the local database (run the Python worker migration or apply the missing migration) and retry.
- Each file is capped at about 500 statements and 1 MB, and each statement at 90 KB (D1 rejects statements over 100 KB).
- Every file is idempotent. If one file fails, fix the cause and re-run that file (or the whole list) from the same directory; do not regenerate in between unless the local data changed.

Optional `--prune` (off by default):

```powershell
npm run d1:export-data -- --prune
```

`--prune` adds a last file, `0099-prune.sql`, that deletes remote `competitions` rows whose `id` no longer exists in the local database. It uses a scratch table (`_sync_competition_ids`, dropped at the end) because the script never connects to the remote database. Competitions on any user's watchlist are never deleted, so they can remain on D1 even though they are gone locally. The exporter refuses `--prune` when the local `competitions` table is empty. Risk: a local database that is incomplete (for example a partial crawl or the wrong `ARCH_COMPETITION_OPS_DB`) will delete the missing public records from production. Check the row counts printed by the exporter before running `0099-prune.sql`, and run it only after all upsert files succeeded.

Verify D1 counts:

```powershell
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM competitions"
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM ops_review_queue_items"
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM source_health"
```

Then verify the live API:

```powershell
curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"
```

## Case 3: Database Schema Changed

Use this when files under `apps/web/migrations/` changed or storage table shape changed.

```powershell
# back up first, see "D1 Backup Before Import"
npm run d1:migrate:remote
npm run d1:export-data
# run every printed `wrangler d1 execute ... --remote --file ...` command in order (see Case 2)
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build:web:cloudflare
npm run deploy:web:cloudflare
```

Verify:

```powershell
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --command "SELECT COUNT(*) AS total FROM competitions"
curl.exe -I https://arch-competition.com/zh/discover
curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"
```

## D1 Backup Before Import

Do this before every remote import (Case 2, Case 3, Full Safe Deployment). The backup is the only way back if an import goes wrong.

1. Record the Time Travel bookmark and timestamp (write them down; this is your restore point):

```powershell
npm --workspace apps/web exec -- wrangler d1 time-travel info arch-competition-ops
```

2. Export the remote database to a file under `artifacts/backups/` (gitignored, never commit it; it contains user data):

```powershell
New-Item -ItemType Directory -Force artifacts/backups | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString("yyyyMMddTHHmmssZ")
npm --workspace apps/web exec -- wrangler d1 export arch-competition-ops --remote --output ../../artifacts/backups/arch-competition-ops-$stamp.sql
```

3. Confirm the file exists and is not empty before you continue.

## D1 Rollback

Use this only when an import damaged production data. Rolling back restores the whole database to the restore point, so every user write made after that point (saved searches, watchlists, review decisions, sign-ups, sessions) is lost. Before rolling back, confirm the impact: compare row counts of the user tables now and in the backup, and decide whether a targeted fix (re-running the idempotent upsert files, or restoring only specific rows from the backup file) is enough.

Option A, Time Travel (preferred, uses the bookmark or timestamp recorded in the backup step):

```powershell
npm --workspace apps/web exec -- wrangler d1 time-travel restore arch-competition-ops --timestamp=<recorded-timestamp>
# or: --bookmark=<recorded-bookmark>
```

Option B, from the backup file (needed when the restore point is outside the Time Travel window). A plain `wrangler d1 execute --file` of a full export fails on existing tables, so restore into a fresh database or drop the affected tables first, then run migrations and import:

```powershell
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/backups/<backup-file>.sql
```

After either option, run the verification queries from Case 2 and the live API check. Then fix the local data or the exporter before syncing again.

## Full Safe Deployment

When unsure, run the complete path:

```powershell
npm run test:storage
npm run lint:web
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build:web
npm --workspace apps/web exec -- wrangler d1 time-travel info arch-competition-ops
npm --workspace apps/web exec -- wrangler d1 export arch-competition-ops --remote --output ../../artifacts/backups/arch-competition-ops-<stamp>.sql
npm run d1:migrate:remote
npm run d1:export-data
# run every printed `wrangler d1 execute ... --remote --file ...` command in order (see Case 2)
npm run build:web:cloudflare
npm run deploy:web:cloudflare
curl.exe -I https://arch-competition.com/zh/discover
curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"
```

## Common Issues

### `npm exec` eats Wrangler flags

Always put `--` after `exec`:

```powershell
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --command "SELECT 1"
```

### `.open-next` Permission Denied On Windows

This usually means a local dev server or `workerd.exe` is locking the build output.

Stop the local dev server:

```powershell
npm run dev:web:stop
```

If needed, stop only project-related Node/workerd processes, then retry:

```powershell
$project = (Resolve-Path .).Path
Get-CimInstance Win32_Process | Where-Object {
  ($_.Name -in @("node.exe", "workerd.exe")) -and ($_.CommandLine -like "*$project*")
} | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force
}

$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build:web:cloudflare
```

### D1 Import Rejects Transactions

`scripts/export-d1-data.mjs` must not emit `BEGIN TRANSACTION`, `COMMIT`, `SAVEPOINT` or `ROLLBACK`.
Remote D1 imports reject explicit transaction statements, so the sync is split into many small idempotent upsert files instead of one transaction. A failed file can simply be re-run; `tests/export-d1-data.test.mjs` guards this rule.

### Multiple Cloudflare Accounts

`apps/web/wrangler.jsonc` includes:

```json
"account_id": "9b32ab0cdd1d91002ccfc9b45882b4db"
```

Keep it unless intentionally moving this Worker to another Cloudflare account.

### `wrangler login` callback fails on Windows

If `wrangler login` redirects to `http://localhost:8976` and the browser shows `ERR_CONNECTION_REFUSED` or the callback hangs, stop and switch to the API-token flow above.

This repository should treat the API-token route as the default authentication path on Windows.

## After Deployment

Check:

```powershell
git status
git log -3 --oneline
```

If you set a temporary API token in the shell, clear it after deployment:

```powershell
Remove-Item Env:CLOUDFLARE_API_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:CLOUDFLARE_ACCOUNT_ID -ErrorAction SilentlyContinue
```

If deployment-related config or scripts changed, commit and push. Run `git status` first and add only the files you actually changed by explicit path; never `git add .`, and never commit `.env*`, `.dev.vars`, or `artifacts/` (SQL exports and backups contain data and secrets-adjacent material):

```powershell
git status
git add CLOUDFLARE_DEPLOY_RUNBOOK.md scripts/export-d1-data.mjs   # example: list the real changed paths
git commit -m "chore: update cloudflare deployment"
git push
```

## Preview images: prewarm + R2/ASSETS

Card images are built offline and shipped as static assets. `/api/opportunities/[slug]/image` only looks the record up in `previews/manifest.json` (through the `ASSETS` binding on Workers, the local previews directory under `next dev` / `next start`) and otherwise draws the locator placeholder. Nothing in the request path geocodes, fetches a notice page, renders a map or calls this site's own domain. Architecture and decisions: `docs/structures/2026-10-21-preview-pipeline-architecture.md`.

### Build the previews (before every deploy that should show new imagery)

```powershell
# 1. Once per machine: identify yourself to Nominatim/Photon (their usage policies require it).
#    Put these in the repo-root .env (never commit it):
#      ARCH_PREVIEW_CONTACT=you@example.org
#      ARCH_SATELLITE_BAIDU_AK= / ARCH_SATELLITE_BAIDU_SK= / ARCH_SATELLITE_AMAP_KEY=   (optional)

# 2. Generate into artifacts/previews and copy into apps/web/public/previews.
#    Public Nominatim allows ~1 request/second, so a cold run takes a while; reruns only touch
#    new or changed records. Safe to interrupt and rerun (the manifest is checkpointed).
npm run prewarm:previews -w @arch-competition/web
#    Useful variants (arguments go after --):
#      npm run prewarm:previews -w @arch-competition/web -- --limit 20
#      npm run prewarm:previews -w @arch-competition/web -- --only <competition-id> --force

# 3. Build and deploy as usual. The Worker bundle ships public/previews with the other assets.
npm run build:web:cloudflare
npm run deploy:web:cloudflare
```

`apps/web/public/previews/` and `artifacts/previews/` are gitignored runtime output. A fresh checkout (or CI) has no previews until step 2 has run, and the site then shows placeholders everywhere, by design. The worker can also run the generator after each ingest for the new records (`ARCH_PREVIEW_PREWARM=1`); that writes `artifacts/previews` only, so step 2 is still what publishes.

### Verify

```powershell
curl.exe -I "https://arch-competition.com/api/opportunities/<id>/image?rev=v1"
```

- a real preview answers `content-type: image/jpeg`, `x-arch-image-source: asset` and, when `rev` equals the current `PREVIEW_ALGORITHM_VERSION`, `cache-control: public, max-age=31536000, immutable`
- no preview answers `image/svg+xml` with `x-arch-image-source: placeholder` and `max-age=300`

### Bump the algorithm version

Change `PREVIEW_ALGORITHM_VERSION` in `packages/previews/src/version.ts` by hand whenever extraction, geocoding acceptance, tile zoom, overlay, attribution or image encoding changes in a way that should regenerate images. The next `prewarm:previews` regenerates every record, and the new `?rev=` makes browsers and the CDN fetch the new images. It is not derived from source files, so unrelated edits never invalidate the cache.

### Limits of the ASSETS approach, and moving to R2

Static assets are capped at 20,000 files per Worker version (25 MiB each) and every preview change needs a new deploy. That is plenty for the current catalogue (a few hundred small JPEGs). When either limit starts to hurt, move the images to R2. These steps are NOT done and the repository deliberately has no R2 binding yet (a binding to a bucket that does not exist would break `wrangler deploy`):

1. Create the bucket: `npm --workspace apps/web exec -- wrangler r2 bucket create arch-competition-previews`.
2. Add to `apps/web/wrangler.jsonc`: `"r2_buckets": [{ "binding": "PREVIEWS", "bucket_name": "arch-competition-previews" }]`.
3. Upload `artifacts/previews/images/*` and `manifest.json` with `wrangler r2 object put --remote` (or the S3 API) after each prewarm.
4. Add an R2-backed `PreviewAssetSource` next to `createAssetsBindingSource` in `packages/previews/src/serve/index.ts` (`env.PREVIEWS.get(key)`) and select it in the image route when the binding exists. The manifest, file names and cache headers stay as they are; the images are already content-addressed, so they can be cached forever.

### Imagery terms

Satellite images use Esri World Imagery tiles. The credit line "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community" is drawn onto every image and recorded in the manifest; do not crop it away. The public `services.arcgisonline.com` endpoint is subject to Esri's terms of use; if traffic or commercial use grows, review them or switch `ARCH_SATELLITE_TILE_URL_TEMPLATE` (and `ARCH_PREVIEW_TILE_ATTRIBUTION`) to a licensed provider.
