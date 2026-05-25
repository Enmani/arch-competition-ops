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

If runtime image generation or geocoded SVG fallbacks should stay available on Cloudflare, set the map-provider credentials as Worker secrets before deploying.

Recommended secrets for the current China-enhanced pipeline:

- `ARCH_SATELLITE_BAIDU_AK`
- `ARCH_SATELLITE_BAIDU_SK`
- `ARCH_SATELLITE_AMAP_KEY` (optional fallback)

Set them from the repository root:

```powershell
npm --workspace apps/web exec -- wrangler secret put ARCH_SATELLITE_BAIDU_AK
npm --workspace apps/web exec -- wrangler secret put ARCH_SATELLITE_BAIDU_SK
npm --workspace apps/web exec -- wrangler secret put ARCH_SATELLITE_AMAP_KEY
```

Notes:

- These should be Worker secrets, not committed `.env` values.
- The current deploy pipeline already syncs generated static satellite previews into `apps/web/public/opportunity-card-satellite`, so production can serve existing previews even without runtime secrets.
- Secrets are still recommended because `/api/opportunities/[slug]/image` can fall back to runtime preview generation and geocoded SVG output when a static preview is missing for the current revision.

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

```powershell
npm run d1:export-data
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-data.sql
```

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
npm run d1:migrate:remote
npm run d1:export-data
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-data.sql
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

## Full Safe Deployment

When unsure, run the complete path:

```powershell
npm run test:storage
npm run lint:web
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build:web
npm run d1:migrate:remote
npm run d1:export-data
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-data.sql
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

`scripts/export-d1-data.mjs` must not emit `BEGIN TRANSACTION`, `COMMIT`, or `SAVEPOINT`.
Remote D1 imports reject explicit transaction statements.

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

If deployment-related config or scripts changed, commit and push:

```powershell
git add .
git commit -m "chore: update cloudflare deployment"
git push
```
