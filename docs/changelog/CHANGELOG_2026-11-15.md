---
title: Incremental full-window screening and wider official coverage
status: done
updated_at: 2026-11-15
related_docs:
  - docs/ARCHITECTURE.md
  - docs/DATA_CONTRACT.md
  - docs/SETUP.md
---

# 2026-11-15

## Screen every in-scope notice once

### Changed

- New `ai_notice_ledger` table (migration `0008`): a notice is keyed by source, a hash of its visible listed evidence and a hash of the screening criteria. Unchanged notices are not triaged, fetched or assessed again; a corrigendum or a criteria change is. Triage exclusions and finished assessments are recorded only after they are durably known.
- Collection reads the whole publication window (`ai_candidate_cap`, default 2000) instead of five times the extraction limit capped at 100; triage runs in batches of 100 instead of cutting the list. `automation.yml` raises `limit_per_source` to 100.
- Today's date is sent with each AI request but is no longer part of the cache identity, so a later day reuses an assessment of identical evidence.
- One design scope for every official collector in `collectors/design_scope.py`: open-participation notices with CPV 71*/7993*, design contests, notices without CPV, and design-and-build works notices named as such (conception-réalisation, appalto integrato, totalentreprise, Totalunternehmer, bouwteam, design and build, …).
- TED: open notice types only, full-window iteration paging (page-number paging under a date sort repeated same-day notices), plus a full-text design-and-build pass. BOAMP, ANAC, Doffin, TenderNed, simap and PCSP page through their window with bounded requests and apply the scope, server-side where the API allows it.
- New sources: `de_oeffentlichevergabe_notices` (German national notice data, EU-directive notices skipped as TED duplicates), `uk_find_a_tender_notices`, `world_bank_procurement_notices`. Contracts Finder now links each notice page and reads every page.
- Screening fixes: an exclusion keeps its decision when one of several quotes fails the exact-substring check; PCSP detail pages that show another tender are rejected; BOAMP and CanadaBuys records link their own notice page; notice text precedes links in the model input; the skill names target and non-target commissions explicitly.

### Why

Fixed per-run caps silently sampled the newest notices (TED: 100 of about 1,200 open notices a week, half of the raw stream being awards), and a daily date in the cache key re-paid every still-listed notice. The goal is to read every in-scope notice once.

### Validation

- `npm run check`; worker suite 655 tests; negative controls for the ledger, the cache date, PCSP identity, BOAMP/CanadaBuys URLs and input ordering.
- Live 7-day AI-mode volumes per source and TED pagination completeness (1,188 of 1,188 unique) were measured on 2026-11-15; no paid screening run was made.

### Modified Files

- `apps/web/migrations/0008_ai_notice_ledger.sql`, `apps/worker/src/arch_competition_ops/storage/{schema.py,notice_ledger.py}`
- `apps/worker/src/arch_competition_ops/{ingest.py,settings.py}`, `screening/{fingerprints.py,triage.py,inputs.py,models.py}`
- `apps/worker/src/arch_competition_ops/collectors/*` (new: `design_scope.py`, `oeffentlichevergabe.py`, `find_a_tender.py`, `uk_ocds.py`, `world_bank.py`, `anac_cpv_labels.py`)
- `config/automation.yml`, `config/source_packs/**`, `config/skills/screen-architecture-opportunities/SKILL.md`, `.env.example`
- `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`, `docs/SETUP.md`

## Middle East coverage

### Changed

- New region `middle_east` and jurisdictions United Arab Emirates, Saudi Arabia, Qatar, Oman, Bahrain, Kuwait, Jordan, Türkiye and Egypt (taxonomy, targeting filters, zh/en labels, country codes, preview outlines); language labels `ar` and `tr`.
- Enabled: Abu Dhabi Government Procurement Gate and the UAE Ministry of Finance opportunities list; Qatar Monaqasat (own TLS context, verification on) and Ashghal; Bahrain Tender Board; Jordan JONEPS; the Islamic Development Bank tender list.
- Shipped disabled: Saudi Etimad (its visitor list answers an image CAPTCHA unless the client sends browser-style headers, which is a decision for the owner), UNGM (its terms bar storing notices without written permission), Oman, Kuwait, Türkiye and Egypt scaffolds with the reason in each source's notes.
- Not integrable under the repository rules: Dubai eSupply (`robots.txt` disallows `/esop`), Dubai Municipality, RTA, DEWA, ADNOC, EBRD ECEPP (terms ban automated reading), Kuwait CAPT and Türkiye EKAP (human-verification challenges).

### Why

Gulf national procurement is mostly behind registration; the sources above are the ones a script can read without a login, a CAPTCHA or a terms breach. Their notices run through the same triage, assessment and ledger as every other source.

### Validation

- `npm run check`; worker suite 762 tests; `npm run test:web`; live 7-day smoke per enabled collector (UAE 52, Qatar 72, Jordan 16, Bahrain 1, IsDB 35 documents).

### Modified Files

- `config/taxonomy.yml`, `config/filters.yml`, `config/source_packs/**`, `apps/web/src/i18n/dictionaries/*/taxonomy.ts`, `apps/worker/src/arch_competition_ops/location.py`, `packages/previews/data/*`
- `apps/worker/src/arch_competition_ops/collectors/{adgpg,uae_mof,monaqasat,ashghal,bahrain_tender_board,joneps,etimad,ungm,isdb,mideast_common}.py`

## Production deploy

- Backup `artifacts/backups/arch-competition-ops-20261115T170735Z.sql` (Time Travel bookmark `00005b4d-00000000-00005124-00d2fc1fee4162a7f79d416440d977f3`), remote migration `0008` (the ledger table stays empty on D1; the worker owns it), upsert of the 140 local records, 124 screening results, source runs and health without `--prune`, then the OpenNext build and Worker deploy (version `5debf327`).
- Production keeps its older corpus: 1046 competitions, of which the 140 local ones carry the new exclusions and zh/en display titles. The next daily ingest and a D1 sync extend that to new records.

## Concurrent assessments, rate-limit retry and record cleanup

### Changed

- `ARCH_COMPETITION_OPS_AI_CONCURRENCY` (1 to 16, default 1): one source's detailed assessments run on that many threads, in input order; parse, verify, geocode and store stay sequential. The per-source AI lock is taken once for the pass (`assess_document(source_lock=False)` inside it). The first budget error stops the pass and defers the rest; a finished assessment after the stop point is left to the next run, which reuses it from `ai_screening_runs` at no cost.
- HTTP 429 from the provider is retried up to 3 times with exponential backoff, jitter and `Retry-After` (capped at 60 s) under the same reservation, for assessments, candidate triage and title polishing. `insufficient_quota`, other 4xx, 5xx and connection errors are not retried.
- The daily cleanup also deletes opportunities whose current assessment is `exclude` and older than 7 days (not `shortlisted`, `verified` or watchlisted; previews included) and blanks `input_json` / `result_json` of `ai_screening_runs` rows older than 45 days (rows and costs kept). The command prints the new counts (`ai_excluded_*`, `ai_runs_shrunk`).

### Why

The daily run moves to a cloud job with a 6-hour limit while its paid assessment was serial (about a minute per notice). Excluded records and old prompts only accumulate; the notice ledger already prevents a re-screen of either.

### Validation

- Worker tests with a mock transport: input order under reversed completion, in-flight peak equal to the limit (barrier), budget stop with one reservation affordable, one failing notice, ledger entries only for finished work, 16 threads against a 5-reservation budget, the 429 matrix, cleanup cases (recent, shortlisted/verified/watchlisted, stale revision, non-exclude, payload shrink, daily guard).

### Modified Files

- `apps/worker/src/arch_competition_ops/{ingest.py,maintenance.py,cli.py,settings.py}`, `screening/{service.py,client.py,triage.py}`, `titles/rewrite.py`, `storage/screening.py`
- `apps/worker/tests/{test_ai_concurrency.py,test_maintenance_cleanup.py,test_cli_maintenance.py}`
- `.env.example`, `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`, `docs/SETUP.md`, `apps/worker/README.md`

## Daily ingest moves to GitHub Actions

### Changed

- New workflow `.github/workflows/daily-ingest.yml` (schedule 02:00 UTC plus `workflow_dispatch` with `batch_id`, `publication_date_from`, `dry_run`): pull state, cleanup, `ingest-batch`, D1 sync, push state. Public-repo rules: no artifacts, counts-only logs and summary, secrets only on the steps that need them, one run at a time, repository guard, keepalive for the 60-day schedule switch-off.
- New `scripts/cloud-state.mjs` (`pull`, `push`, `stats`): keeps `data/competitions.sqlite` and the geocode cache in the private R2 bucket `arch-competition-state` through wrangler, as `state/<UTC timestamp>/` generations plus `latest.json`, newest 14 kept. Snapshot by SQLite backup, `integrity_check` and sha256 on both sides; `pull` fails on an empty bucket, `push --init` seeds the first generation, fewer `ai_notice_ledger` rows is refused without `--force`.
- `scripts/export-d1-data.mjs` gains `--apply` (runs the generated files against remote D1 in order, stops at the first failure, prints counts) and `--retention` (`0090-retention.sql`: remote mirror of the local cleanup rules, deadline over 7 days past or current `exclude` assessment over 7 days old, never shortlisted/verified or watchlisted, never user tables). Default behaviour is unchanged; `MAX_DATA_FILES` is 89 to leave room for the retention file. Wrangler is started by `scripts/lib/wrangler.mjs` (overridable with `ARCH_WRANGLER_CMD` for tests).
- `package.json`: `cloud:state:pull`, `cloud:state:push`, `d1:sync`; the new tests are part of `test:tools`.
- `CLOUDFLARE_DEPLOY_RUNBOOK.md`: section "Cloud daily run" (setup, secrets and token permissions, reading results, restoring a generation, limits).

### Why

The Windows scheduled task only runs while the owner's PC is on. The ledger and the assessment cache are the paid part of the state, so they move with the run (R2) instead of being rebuilt on each fresh runner. Satellite previews are not produced in the cloud and still come from a local `prewarm:previews` plus deploy.

### Validation

- `tests/cloud-state.test.mjs` (fake wrangler over a temp directory: round trip, empty bucket, sha256 mismatch, corrupt database, fewer ledger rows, 14-generation retention, failed upload keeps the old pointer), `tests/d1-retention-apply.test.mjs` (retention SQL against a database built from the real migrations with foreign keys on, including watchlisted, shortlisted, verified, boundary-day and user-table cases; `--apply` order, first-failure stop, credential check), `tests/daily-ingest-workflow.test.mjs` (triggers, no artifacts, concurrency, guard, timeout, permissions, pinned actions, secret list).
- Not verified without real access: the Actions run itself, wrangler's R2 and D1 behaviour against Cloudflare, the `enable` keepalive call.

### Modified Files

- `.github/workflows/daily-ingest.yml`, `scripts/{cloud-state.mjs,export-d1-data.mjs}`, `scripts/lib/{wrangler.mjs,d1-sync/apply.mjs,d1-sync/retention.mjs,d1-sync/batching.mjs,d1-sync/table-specs.mjs}`
- `tests/{cloud-state,d1-retention-apply,daily-ingest-workflow}.test.mjs`, `tests/helpers/fake-wrangler.mjs`, `package.json`, `CLOUDFLARE_DEPLOY_RUNBOOK.md`
