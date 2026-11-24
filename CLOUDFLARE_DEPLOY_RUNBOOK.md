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

Before deploying code that contains migration `0006`, apply it through Case 3 as well. Discovery queries use its `ai_screening_results` table. The worker's API key, full prompts and local spend ledger stay on the ingestion backend. D1 receives only published screening advice.

For the discover read-budget rollout, apply migrations `0011` and `0012` first. Deploy the Worker code second. Run the new D1 sync third to publish the first summary. The Worker reads exact live results until the summary is ready. Use the new exporter for every sync after rollout so imports invalidate the published summary before changing records.

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
Run the files in the printed order. `0000-syncing.sql` marks the import as in progress. The data files follow, then retention and pruning when requested. `0100-publish.sql` publishes the new version and computes the default total and options for today and tomorrow in UTC using the remote records.

```powershell
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-sync/<UTC-timestamp>/0001-competitions.sql
npm --workspace apps/web exec -- wrangler d1 execute arch-competition-ops --remote --file ../../artifacts/d1-sync/<UTC-timestamp>/0002-competitions.sql
```

How the sync behaves:

- The export is an incremental upsert (`INSERT ... ON CONFLICT DO UPDATE`). It syncs only the worker-owned tables: `competitions`, `source_runs`, `source_health`, `ai_screening_results`, and `ops_review_queue_items` rows with `origin = 'worker_diagnostic'`.
- It never touches user data: `workspace_*`, `ops_review_decisions` and `auth_*` are not read and not written. Review queue rows keep their human `status`, `first_detected_at` and `updated_at`; only the diagnostic fields are refreshed.
- It emits no `DELETE` unless you pass `--prune` (below).
- The local database is read from `ARCH_COMPETITION_OPS_DB` (relative paths resolve against the repository root; default `data/competitions.sqlite`).
- Before writing anything the exporter checks that the local database has exactly the columns defined by `apps/web/migrations/*.sql` for the synced tables. On any difference it prints the diff, exits with code 1 and writes no files. Fix the local database (run the Python worker migration or apply the missing migration) and retry.
- Each file is capped at about 500 statements and 1 MB, and each statement at 90 KB (D1 rejects statements over 100 KB).
- Upserts write only when a sync-owned value changes, including title and AI fields. Existing human review fields stay protected.
- If a file fails, fix the cause and rerun from `0000-syncing.sql`. Readers use live queries until a complete sync publishes successfully. If another export takes ownership, older data files are rejected. Run only one sync at a time.

Optional `--prune` (off by default):

```powershell
npm run d1:export-data -- --prune
```

`--prune` adds `0099-prune.sql` before publication. It deletes remote `competitions` rows whose `id` no longer exists in the local database. It uses a scratch table (`_sync_competition_ids`, dropped at the end) because the script never connects to the remote database. Competitions on any user's watchlist are never deleted, so they can remain on D1 even though they are gone locally. The exporter refuses `--prune` when the local `competitions` table is empty. Risk: a local database that is incomplete (for example a partial crawl or the wrong `ARCH_COMPETITION_OPS_DB`) will delete the missing public records from production. Check the row counts printed by the exporter before running `0099-prune.sql`, and run it only after all upsert files succeeded.

Two more flags exist for the unattended cloud run (see [Cloud daily run](#cloud-daily-run)):

- `--retention` adds a last data file, `0090-retention.sql` (before `0099-prune.sql`): it deletes remote `competitions` whose `deadline_at` is more than 7 days before the sync's UTC date, and those whose current AI assessment is `exclude` (assessed on the record's current revision, more than 7 days ago) unless the record is `shortlisted` or `verified`. Records on a watchlist are kept. An AI assessment is deleted with its competition. The file also runs [anonymous MCP usage cleanup](docs/structures/2026-10-21-storage-auth-api-architecture.md#api-keys-and-tool-quotas).
- `--apply` (implies `--retention`) runs every file with wrangler, in order, and stops at the first failure; `npm run d1:sync` is the short form. It needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment and prints counts only.

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

### OpenNext Refuses The Pinned Next.js Version

OpenNext refuses to build a Next.js release that is older than the two-year support window, and
the plugin in `apps/web` pins Next 15.5.x, so `opennextjs-cloudflare build` exits with
`Next.js version 15.5.15 is not supported` and the deploy stops.

The workspace script already passes the override:

```json
"build:cloudflare": "opennextjs-cloudflare build --dangerouslyUseUnsupportedNextVersion"
```

The flag only waives the version gate; the build itself, the deploy and the live checks are
unchanged. The real fix is the Next.js 16 upgrade (dependabot branches exist for it). Remove the
flag when `next` and `eslint-config-next` are upgraded, and re-check the OpenNext `compatibility_date`
in `apps/web/wrangler.jsonc`.

### D1 Import Rejects Transactions

`scripts/export-d1-data.mjs` must not emit `BEGIN TRANSACTION`, `COMMIT`, `SAVEPOINT` or `ROLLBACK`.
D1 imports apply each file separately. The syncing marker keeps readers on the live path until the final file publishes two days of summaries together. An interrupted import leaves the marker in place. The export tests cover retries, file ownership and publication after pruning.

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

## Cloud daily run

`.github/workflows/daily-ingest.yml` runs the daily ingest on a GitHub Actions runner (free for a public repository, 6 hour job limit), so the site updates even when the owner's PC is off. It replaces the Windows scheduled task. Each run:

1. pulls the worker state from the private R2 bucket `arch-competition-state` (`scripts/cloud-state.mjs pull`): `data/competitions.sqlite` (notice ledger, paid-assessment cache, all records) and `data/geocoding-cache.json`;
2. `cleanup-expired-competitions`, then `ingest-batch --batch-id all_enabled` with AI on, 8 assessments at once, caps of 5 USD a day and 100 USD a month;
3. `node scripts/export-d1-data.mjs --apply`: upserts the worker-owned tables into production D1 and deletes expired and excluded records there (`0090-retention.sql`);
4. pushes the new state as a new generation (`scripts/cloud-state.mjs push`), keeping the newest 14.

The ingestion step defaults to Anthropic Messages, claude-haiku-5-5 and low effort. The owner has 100 USD in monthly credit, which expires at the end of each month. GitHub Actions repository variables AI_PROVIDER, AI_MODEL and AI_REASONING_EFFORT override those defaults. For OpenAI Responses, select openai, set an OpenAI model and add OPENAI_API_KEY. For openai-compatible also set AI_CHAT_BASE_URL, AI_CHAT_INPUT_USD_PER_MILLION and AI_CHAT_OUTPUT_USD_PER_MILLION, and supply the separate AI_CHAT_API_KEY secret. Only the ingest step receives model credentials.

The state is the expensive part. Losing it, or starting from an empty database, means paying for every assessment again, so `pull` fails when the bucket has no state (only `push --init` creates the first one), and `pull`/`push` refuse to replace a state with one that has fewer `ai_notice_ledger` rows unless `--force`. Steps 3 and 4 still run when the ingest exits non-zero (some sources failing is normal) and never run when the pull failed; the job is then marked failed so the red run is visible.

### One-time setup

1. Cloudflare API token for the cloud run. Create a separate token (`My Profile -> API Tokens`), account-scoped to the production account, with `Account -> Workers R2 Storage -> Edit` and `Account -> D1 -> Edit`. Nothing else is needed: the run does not deploy the Worker. R2 must be enabled for the account in the dashboard first.
2. Create the private bucket. R2 buckets are private unless you add a public bucket URL or a custom domain; do not add either.

   ```powershell
   $env:CLOUDFLARE_API_TOKEN="paste-token-here"
   $env:CLOUDFLARE_ACCOUNT_ID="9b32ab0cdd1d91002ccfc9b45882b4db"
   npm --workspace apps/web exec -- wrangler r2 bucket create arch-competition-state
   ```

3. Open the GitHub repository and choose Settings → Secrets and variables → Actions → New repository secret. Name it `ANTHROPIC_API_KEY` and paste the key into the value field. The current key lasts 30 days. Before expiry, create a replacement in the Anthropic account, select the existing GitHub secret and choose Update secret. After the next scheduled ingest succeeds with the replacement, revoke the previous key. Set the two Cloudflare secrets from the environment:

   ```powershell
   gh secret set CLOUDFLARE_API_TOKEN  --repo Enmani/arch-competition-ops --body $env:CLOUDFLARE_API_TOKEN
   gh secret set CLOUDFLARE_ACCOUNT_ID --repo Enmani/arch-competition-ops --body $env:CLOUDFLARE_ACCOUNT_ID
   ```

   Clear the variables afterwards (see After Deployment).
4. Make the local database the first generation. Do it right after the last local ingest, with the Windows task paused, so the ledger and the assessment cache of the cloud start from everything already paid for. The snapshot is taken with SQLite's backup API, so a running ingest does not corrupt it.

   ```powershell
   node scripts/cloud-state.mjs push --init
   ```

   The command prints the generation id and row counts.
5. First run, as a dry run: it pulls, cleans up, checks the D1 export and pushes a state, but does no paid ingest and no D1 apply.

   ```powershell
   gh workflow run daily-ingest.yml --repo Enmani/arch-competition-ops -f dry_run=true
   gh run watch --repo Enmani/arch-competition-ops
   ```

   Then a real run (`-f dry_run=false`), and check the site. Pass `-f publication_date_from=YYYY-MM-DD` to read further back than the batch window.
6. Only after a real run is green, remove the Windows scheduled task `arch-competition-ops-all_enabled-0330`, so local and cloud never write the ledger at the same time (two divergent ledgers mean paying twice):

   ```powershell
   powershell -ExecutionPolicy Bypass -File scripts/register-auto-ingest-tasks.ps1 -Action Remove
   ```

From then on the cloud state is the master copy. To ingest locally again, run `npm run cloud:state:pull` first (it refuses to overwrite a local database that has more ledger rows) and `npm run cloud:state:push` afterwards.

### Reading the results

- Actions tab, workflow "Daily ingest": the run summary shows counts only (batch line from the CLI, failed source ids, ledger/results/cost before and after, D1 rows upserted, remote competition count before and after, pushed generation). Nothing is uploaded as an artifact and no notice titles are logged, because logs of a public repository are world-readable.
- `gh run list --workflow daily-ingest.yml --repo Enmani/arch-competition-ops`, and `gh run view <id> --log` for the full log.
- A red run with a green "Sync to D1" and "Push state to R2" means only that some sources failed; the data and state were still saved. A red "Pull state from R2" means nothing was changed and nothing was spent: fix the bucket or token and run again. A red "Sync to D1" means the state was pushed but D1 is behind; re-run the workflow (the upserts are idempotent and the next ingest finds nothing new, so it costs nothing).
- Verify production with `curl.exe -s "https://arch-competition.com/api/opportunities?limit=1"` and load page two from discover after a sync.
- In the Cloudflare dashboard, compare two complete UTC days for D1 rows read and written and Worker requests. Inspect query statistics for the default page, page two, filtered searches and MCP. Confirm a successful publish returns default summaries and an interrupted sync uses live results. Check Worker CPU percentiles, CPU and quota errors, and image requests by path. Review anonymous MCP 429/503 alongside D1 writes.

### Restore an earlier state generation

The newest 14 generations are kept under `state/<UTC timestamp>/` and indexed in `latest.json`. Restore into a scratch database so the local `data/competitions.sqlite` is not replaced, check it, then make it the newest generation:

```powershell
npm --workspace apps/web exec -- wrangler r2 object get arch-competition-state/latest.json --remote --file ../../artifacts/latest.json
# read "generation" and "history[].generation" in artifacts/latest.json
$env:ARCH_COMPETITION_OPS_DB="artifacts/state-restore/competitions.sqlite"
node scripts/cloud-state.mjs pull --generation <id> --force
node scripts/cloud-state.mjs stats
node scripts/cloud-state.mjs push --force
Remove-Item Env:ARCH_COMPETITION_OPS_DB
```

`--force` is needed because an older generation has fewer ledger rows than the current one. The pull verifies the recorded sha256 and `PRAGMA integrity_check` before it replaces anything.

### Known limits

- Job limit: a job may run 6 hours. The workflow caps the ingest step at 290 minutes so the D1 sync and the state push still run if the ingest takes too long; work finished before that is kept (ledger and assessment cache) and the next run continues. With 8 parallel assessments a normal day takes about half an hour; a large backfill (`publication_date_from`) can exceed it and is simply continued by the next run.
- Schedules switch off: GitHub disables the schedule of a public repository after 60 days without repository activity. The last step of every run calls the workflow `enable` endpoint as a keepalive and never fails the run. If the schedule is ever off (Actions tab shows the workflow as disabled), enable it there or run `gh workflow enable daily-ingest.yml`.
- Satellite preview images are not produced by the cloud run. Records that are new since the last local `npm run prewarm:previews -w @arch-competition/web` plus deploy show the locator placeholder until previews are rebuilt locally and the Worker is redeployed (see Preview images below).
- The raw HTML evidence archive (`artifacts/html`) is not kept between runs; only the database and the geocode cache are stored.
- Stored state is one gzip file per generation; `wrangler r2 object put` accepts objects up to about 300 MB, which is far above the current 10 MB database.
- Pruning old generations is best effort: a failed delete only leaves an unreferenced object under `state/`, which can be removed by hand.
- Only people with write access to the repository can start `workflow_dispatch` runs; forks and pull requests cannot start this workflow or read its secrets.

## Preview images: prewarm + R2/ASSETS

Prewarming publishes the image, locator and corner map through the existing preview manifest. Cards and detail pages request those files directly when the stored record and renderer version match. Cloudflare can serve those URLs as static assets before the Worker runs. For a new or changed record, the image endpoint can draw a live locator after reading its location fields by primary key. See the [preview pipeline architecture](docs/structures/2026-10-21-preview-pipeline-architecture.md).

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

Satellite images use Esri World Imagery tiles. The site displays the credit line from the manifest next to the image. For Esri World Imagery it is "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community". The public `services.arcgisonline.com` endpoint is subject to Esri's terms of use; if traffic or commercial use grows, review them or switch `ARCH_SATELLITE_TILE_URL_TEMPLATE` (and `ARCH_PREVIEW_TILE_ATTRIBUTION`) to a licensed provider.

For a collection-only run, select **collect_only** in Daily ingest. It saves notices in the private worker database and pushes that state to R2. The next paid run starts with the oldest queued notice. The log reports new notices, text lengths, known unfinished pages and backlog age per source. Set **publication_date_from** to recover older notices that failed before the queue existed.
