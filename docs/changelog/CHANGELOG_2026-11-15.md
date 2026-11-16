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

## First cloud run and follow-up fixes

### Changed

- The first real cloud run (run 43751027681, 75 min) ingested 976 documents from 24 sources at an estimated 3.5 USD, synced 1044 rows to D1 (remote competitions 1046 to 1911) and pushed state. Two defects showed in its log and are fixed here.
- `TRIAGE_BATCH_SIZE` 100 to 50: a batch of 100 long candidates exceeded the 200 KB request cap, so triage was skipped for every large source and all candidates went to the paid detail assessment. A regression test builds 250 long multilingual candidates and checks every request stays under the cap.
- New workflow step "Polish titles" after the ingest: sources run in parallel and title polishing takes a non-blocking lock, so a source that finished while another polished kept rules-cleaned titles only. The step is best effort (`continue-on-error`).

### Validation

- `npm run lint:worker`, worker suite 793 tests, `npm run test:tools` 51 tests; the new triage test fails with batch size 100 and passes with 50.
- Run exit code 1 came from 24 skipped documents in 8 sources (connection failures, no source-grounded title, incomplete responses), not from failed sources; skipped documents are not in the ledger and are read again next run.

### Modified Files

- `apps/worker/src/arch_competition_ops/screening/triage.py`, `apps/worker/tests/test_ai_triage.py`, `.github/workflows/daily-ingest.yml`

## Opportunity detail as a side sheet

### Changed

- Opening an opportunity from the list now slides a wide side sheet in from the right instead of navigating to a new page. It opens at once from the list item already on screen (no server round trip, no list scroll), then fills in the AI overview from `GET /api/opportunities/[slug]`, a public cacheable read (one batched query, `max-age=60, s-maxage=300`); hovering or focusing a card starts that request. Esc, the close button, a click on the scrim and the browser Back button all close it and return to the same place in the list; the address becomes the opportunity's own page, so the link can be shared. A direct visit, a reload or a shared link opens the standalone page, which has a back link. An earlier intercepted-route version was dropped: every click waited for a server render and scrolled the list to the top and back.
- The detail content is reorganised for a reader: image, title, deadline (with days left), value, location and issuer, then the official-notice, documents, map and watch actions, the AI overview with reasons to look, the participation excerpts, conditions, what the notice does not state, and the project type. Source bookkeeping (notice number, source kind, procurement method, classification codes, language, location precision) is folded into one section.
- The AI summary, reasons and missing-information list were already stored with every screening result but never shown; they now reach the page through `aiAssessment`. The free-form missing-information entries are sorted into twelve plain topics and the model's processing remarks are dropped.
- Removed from the page: the qualification score (an internal completeness count, not a judgement), extraction confidence, the discovery trail, the regions and competition-tag lists, and the machine-written source note. Raw field dumps in excerpts (`"sluitingsDatum": "2026-12-02T12:00:00"`) now show only a readable date; stated amounts such as `3000000.0 NOK` get digit grouping.
- Section titles and labels in both languages avoid jargon in a formal register (for example "Costs and remuneration" for "Commercial", "后续委托方式" for "落地路径", "采购分类代码" for "CPV").

### Validation

- `npm run lint:web`, `npm run typecheck`, `npm run test:web` (103 tests, including the new detail-model tests; an amount pattern that read `300.000 EUR` as 300 was caught and fixed), `npm run test:storage` (93 tests).
- Checked in Edge: click opens the sheet and changes the address, Esc closes it and restores the list, no console errors, no horizontal overflow at 390 px, light and dark, zh and en.

### Modified Files

- `apps/web/src/app/api/opportunities/[slug]/route.ts`, `apps/web/src/lib/api/{http.ts,opportunities.ts}`, `apps/web/src/lib/opportunity-detail-client.ts`, `apps/web/src/components/{opportunity-detail-body.tsx,opportunity-drawer.tsx,opportunity-sheet.tsx,opportunity-detail-surface.tsx,opportunity-stream-item.tsx,discover-feed.tsx}`, `apps/web/src/lib/opportunity-detail-model*.ts`, `apps/web/src/app/styles/{detail,layout,surfaces,tiles}.css`, `apps/web/src/i18n/dictionaries/*/detail.ts`
- `packages/core/src/{ai-assessment.ts,index.ts}`, `packages/storage/src/opportunities/{repository.ts,types.ts}`, `packages/storage/src/{index.ts,ai-screening.test.ts}`
- `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`

## Appearance toggle

### Changed

- A button next to the language switch cycles Match system, Light and Dark. The dark theme had followed the system setting only; there was never a manual switch. The choice is kept in `localStorage` and applied as `data-theme` on `<html>` by a small script in `<head>` before first paint (a cookie would make every page dynamic). `tokens.css` restates the dark values for the attribute (CSS cannot share one block between a media query and an attribute selector; a comment says to keep the two identical).

### Validation

- `npm run typecheck`, `lint:web`, `test:web`. Checked in Edge: cycling, persistence over a reload with the dark background present at DOM-ready, forcing dark on a light system and light on a dark system, no console errors.

### Modified Files

- `apps/web/src/components/{theme-toggle.tsx,site-shell.tsx}`, `apps/web/src/lib/theme.ts`, `apps/web/src/app/{layout.tsx,styles/tokens.css,styles/buttons.css}`, `apps/web/src/i18n/dictionaries/*/shell.ts`

## Sign-in sheet without page loads

### Changed

- The topbar shows one "Sign in" entry instead of two links. It opens a sheet over the current page (blurred page behind, frosted card, "还没有账号？注册" / "Already registered? Sign in" at the bottom of the card) with no navigation. The frosted glass is a requested exception to the flat look and is limited to this overlay; browsers without `backdrop-filter` get solid paper. The sign-in links on cards and the watch button open the same sheet.
- The sheet posts the same form with `Accept: application/json`. `POST /api/auth/login`, `register` and `logout` now answer such a request with `{ ok: true }` plus the cookie, or `{ ok: false, reason }` (401 invalid credentials, 429 throttled with `Retry-After`, 400 otherwise) using the reason codes the pages already show. Requests that accept HTML or send no `Accept` header behave as before (303 redirects). On success the server components are refreshed in place: the account appears, watch state loads, and the page keeps its scroll position and list. Sign-out works the same way.
- `/login` and `/register` stay as the no-JavaScript path and for direct links.
- The list remounts when the signed-in state changes, so already watched items show as watched without a reload.

### Why

Sign-in used a full-page POST, a 303 redirect and a full reload of the next page, which felt heavy.

### Validation

- `npm run typecheck`, `lint:web`, `test:web` (new JSON-mode handler test). Checked in Edge: the sheet opens in about 100 ms, a wrong password shows the message in place, switching to registration, a password mismatch, a successful registration closing the sheet with the account shown (the same document, scroll kept), sign-out in place, Esc, dark theme.

### Modified Files

- `apps/web/src/components/{auth-dialog.tsx,site-shell.tsx,watch-toggle-button.tsx,discover-surface.tsx}`, `apps/web/src/lib/{auth-dialog.tsx,api/auth-routes.ts,api-auth-routes.test.ts}`, `apps/web/src/app/{[locale]/layout.tsx,styles/auth.css}`, `apps/web/src/i18n/dictionaries/*/shell.ts`

## Blur strength and dark map cards

### Changed

- The sign-in sheet blurs the page behind it at 28 px (was 10 px).
- The locator placeholder (the drawn country outline shown when no satellite image exists) now has a dark palette inside the SVG: paper a step lighter than the dark page (`#24231e` on `#11110d`), light ink and a mint marker. An SVG shown through `<img>` follows the embedding page's `color-scheme` in Chromium, so the page's theme button (which sets `color-scheme`) switches it with no second URL, no client code and no refetch; satellite JPEGs are untouched. Firefox and Safari may follow only the system setting for SVG images, so there a manual theme choice that differs from the system leaves the placeholder in the system's palette.
- A stated amount such as `3000000.0 NOK` gets digit grouping on the list card as well as in the detail (one place, `getOpportunityDisplayMeta`).

### Validation

- `npm run test:previews` (185, with a new dark-palette test), `test:web`, typecheck, lint. Checked in Edge on a light system with dark forced, a dark system and a light system: placeholder palette follows the page; the sheet's blur.

### Modified Files

- `packages/previews/src/placeholder/{render.ts,render.test.ts}`, `apps/web/src/app/styles/auth.css`, `apps/web/src/lib/opportunity-display.ts`, `apps/web/src/components/opportunity-detail-body.tsx`

## Cards rest as the drawn locator; hover reveals the satellite

### Changed

- Every card now shows the drawn locator (country outline and marker) by default, including records that have a satellite image. Pointing at a card (mouse hover, or keyboard focus-visible) turns the locator into a coarse mosaic that sharpens into the satellite image, then the locator settles into the bottom-left corner as a small map with one dot at the project. Leaving plays it back. About 90 ms of hover intent avoids fetching while the pointer only passes over; the transition holds at the coarsest step until the image has arrived; a card without a satellite image does nothing; touch screens keep the locator (the detail sheet shows the satellite); with reduced motion the swap is immediate.
- The list no longer downloads satellite JPEGs: on load only the small locator SVGs are requested (12 SVGs and 0 JPEGs in the check), and a JPEG is fetched on the first hover of a card.
- `GET /api/opportunities/[slug]/image` gains `?kind=locator` (always the drawn locator, `x-arch-image-source: placeholder`) and `?kind=inset` (the corner map, 404 unless the record has a real position: a country centroid would claim a place the notice never gave). Both are cached for an hour in the browser and a day at the edge. Without `kind` the route is unchanged and its `x-arch-image-source` header tells the card whether a satellite exists.
- The mosaic is drawn on a canvas (`lib/mosaic.ts`), the decoded bitmap is created per hover and released, and only the small JPEG blob is kept per visit.

### Validation

- `npm run test:previews` (inset builder), `test:web` (handler kinds), typecheck, lint. Checked in Edge: frames at start, mosaic, turn, sharp and final show locator, coarse squares, coarse satellite, sharp satellite with the corner map; leaving restores the locator; a card without a satellite stays still; no console errors.

### Risks

- Every card now requests its locator SVG, and each such request reads the record and the preview manifest. Browsers cache it for an hour; Workers do not cache dynamic responses at the edge by themselves, so production load should be watched after deploy. A cheaper variant would carry the locator inputs in the URL.

### Modified Files

- `packages/previews/src/placeholder/{render.ts,render.test.ts}`, `apps/web/src/lib/{opportunity-image-response.ts,opportunity-image-response.test.ts,mosaic.ts,opportunity-satellite.ts}`, `apps/web/src/components/{opportunity-media.tsx,opportunity-stream-item.tsx}`, `apps/web/src/app/styles/tiles.css`

## Hover transition fixes: stretched satellite, backing, clean image

### Changed

- Fixed the satellite image looking stretched: the canvas was never given a pixel size, so it stayed at the browser default of 300 x 150 and was stretched to the square card (about 2.3 times taller). It is now sized to the card on every frame (up to 720 px, device pixel ratio capped at 2).
- The corner inset map has no backing: it is drawn in fixed light strokes with a soft shadow straight over the photograph. The card's own drawing keeps its paper square (a step lighter than the page in the dark palette), so the card stands apart from the page. (An earlier edit in this round removed the card backing by mistake and was reverted.)
- The satellite images are now plain imagery: no white ring, dashed ring, centre dot, "LOCALITY"-style label or credit bar is drawn into them (`render/overlay.ts` and `render/attribution.ts` removed, `PREVIEW_ALGORITHM_VERSION` v2 to v3 so every image is regenerated). The imagery credit, which the tile provider requires, stays in the manifest, travels in the `x-arch-image-attribution` response header and is printed as text in the bottom-right corner of the revealed card and of the detail image (`components/imagery-credit.tsx`).
- Regenerated locally with `prewarm:previews --publish`: 80 satellite images and 52 records without one, all v3. Production serves the old images until the next preview publish and deploy.

### Validation

- `npm run test:previews` (the prewarm test now asserts a clean picture: bottom strip and centre match the imagery), `test:web` (credit header), typecheck, lint. Checked in Edge, light and dark: rest, mosaic, sharp satellite and final frames; canvas 350 x 350 on a 350 px card.

### Modified Files

- `packages/previews/src/{render/satellite.ts,render/projection.ts,version.ts,config.ts,placeholder/render.ts,placeholder/render.test.ts,pipeline/prewarm.test.ts}`, `apps/web/src/lib/{opportunity-image-response.ts,opportunity-image-response.test.ts,opportunity-satellite.ts}`, `apps/web/src/components/{opportunity-media.tsx,imagery-credit.tsx,opportunity-detail-body.tsx}`, `apps/web/src/app/styles/tiles.css`

## Cards without an outline or a satellite image: root cause and fix

### What was wrong

- On the local list (29 cards) 9 had no country outline and 11 no satellite image (screenshots of "Arua and Mbale" and "SAN PEDRO"). They were not two failures but a chain from one cause.
- **No country.** Records from multi-country sources carry `eu` (TED), `europe` or `global` (Islamic Development Bank) as their jurisdiction. 35 of 143 stored records (24 %) had one. Nothing in the pipeline turned that into a country, although the notices state it: TED's `placeOfPerformance` holds `["DEE06", "DEU"]`, the listing holds `"country": "Uganda"`, the text says "Place of performance Country : Côte d'Ivoire", the title opens "Austria – ...". The model can only choose among the 34 labels of the taxonomy, which lacks Uganda, Romania, Mauritania and others.
- **No coordinates, so no satellite.** `geocoding.py` returns at once when the jurisdiction has no entry in its 40-country label table (`if not country_label: return record`). Of the 29 listed cards, 8 had no coordinates at all, 6 of them for this reason; the preview generator then had nothing to crop.
- **No outline.** The outline needs a country key; `eu`/`global` have none. Separately, only 21 countries had an outline drawing, so Poland and the Netherlands (both in the taxonomy) had none either.
- **Wrong caption.** The country code on the card came from the jurisdiction: "GL" for global, "EU" for TED records, for projects in Uganda and Côte d'Ivoire.

### Changed

- Country registry for every country (`packages/previews/data/countries.json`, 258 countries: slug, ISO codes, names in 38 languages from CLDR, atlas name), built by `npm run build:countries`; the worker reads a copy inside its package (a test fails if the two differ). Country outlines now exist for 222 countries (the 21 existing drawings are byte for byte unchanged; mainland only, plus a short list of island states).
- `resolveOpportunityCountry` (TypeScript) and `countries.py` (Python) read the country from the notice and the record's text; ambiguous names ("Congo", "Georgia") and short names inside running text match nothing.
- Worker: `extract_record` resolves a generic jurisdiction from the notice; the label and code lookups for geocoding accept any registry country; new command `repair-jurisdictions` applies it to stored records (also run by the cloud workflow, best effort and idempotent). Assessments stay current (the same re-stamp that coordinates use).
- Card: the outline and the caption's country code and country name (Chinese or English) use the resolved country. With no country the card draws the place name as text instead of an empty grid with a crosshair that would claim a place nobody stated; with neither it stays a plain grid.

### Result on the local list

- Cards with an outline: 20 of 29 to 29 of 29. Cards with a satellite image: 18 of 29 to 20 of 29. Captions "Arua and Mbale, GL" and "Burg, EU" now read "UG" and "DE".
- 33 of the 35 generic records got a country; the two left name none. The 9 cards still without a satellite image: 4 name a place the geocoder cannot match ("Arua and Mbale", "à Nouakchott, en Mauritanie", a hospital name, a street without a city), 3 know only the country (a country centre is not a place and is refused), 2 state no place. These show the country outline.

### Known limit

- A bare place name can match a homonym: "Burg" (buyer in Sachsen-Anhalt) resolves to a village in Rhineland-Palatinate in the geocoder, and the preview generator already did the same before this change (it had cached a different wrong "Burg" under `eu`). Repair therefore sets the country only; geocoding stored places is opt-in. A better disambiguation (the buyer's region, the NUTS code) is a separate change.

### Validation

- Worker 802 tests (new: 9 in `test_countries.py`, including a repair that keeps assessments current and a geocode in a country outside the old table), previews 193, web 108, workflow test, lint. Checked on `localhost:3400` with the real list before and after; the four fallback drawings were rendered and viewed.

### Modified Files

- `packages/previews/{data/countries.json,data/country-outlines.json,scripts/build-country-registry.mjs,scripts/build-country-outlines.mjs,src/countries.ts,src/countries.test.ts,src/location.ts,src/placeholder/render.ts,src/placeholder/render.test.ts,package.json}`
- `apps/worker/src/arch_competition_ops/{countries.py,data/countries.json,location.py,maintenance.py,cli.py,screening/extraction.py,storage/competitions.py,storage/screening.py,storage/__init__.py}`, `apps/worker/tests/test_countries.py`
- `apps/web/src/lib/{opportunity-display.ts,opportunity-display.test.ts}`, `.github/workflows/daily-ingest.yml`, `tests/daily-ingest-workflow.test.mjs`
- `docs/DATA_CONTRACT.md`, `docs/ARCHITECTURE.md`, `docs/structures/2026-10-21-preview-pipeline-architecture.md`

## Corner map readable on pale satellite images

- The corner map's outline was a 1 px light stroke, which disappeared over pale imagery (a city square, bare ground). It now has a dark casing under a heavier light stroke (the halo style of map labels) and a slightly larger dot with a dark ring. It still has no backing; dark imagery looks as before.
- Checked by rendering the corner map over a pale and a dark backdrop at card size; previews 193 tests pass.
- Modified: `packages/previews/src/placeholder/{render.ts,render.test.ts}`

## Missing coordinates: places the geocoder could not find

- Of 143 stored records 39 had no coordinates, so no satellite image. The geocoder had asked for each place and cached "not found", for three reasons: it asked in the local language, so a hit named in Cyrillic or Bengali never contained the Latin words of the label; it searched the label as written ("à Nouakchott, en Mauritanie", "Municipiul Craiova"); and it took the first hit even when that was a whole region.
- Changed: lookups ask for English names (`accept-language=en`); prepositions, admin prefixes such as "Municipiul" and the country's own name are dropped from the query; hits that are a whole state, region or province are skipped (a region's centre is not the project); the cache key moved to `v3` so the wrong "not found" answers are asked again.
- Result on the local list: 4 records got a real place (Bad Ischl, Craiova, Sonagazi, Nouakchott); their satellite images were generated and checked by hovering the cards. Not accepted: Burg (resolves to a homonym village), the country centres of Côte d'Ivoire and Pakistan, and the region Niger State.
- The 35 still without coordinates, counted one by one: no place stated (9), a road, canal or corridor (7), a region (5), an institution or a street without a city (6), several places at once (4), a country only (3), Burg (1). Filling these needs the notice read again for a better place (for instance the San Pedro card: the notice says "à San Pedro", the stored label is only the country), not another lookup.
- Modified: `apps/worker/src/arch_competition_ops/geocoding.py`, `apps/worker/tests/test_geocoding.py`, `docs/DATA_CONTRACT.md`. Local data only (not committed): `data/competitions.sqlite` (backup `artifacts/backups/competitions-before-geocode-fill-20261116.sqlite`), `apps/web/public/previews/`.

## Hover: satellite fades in while the locator shrinks, no mosaic step

- The card hover first turned the locator into a mosaic, then showed the satellite, then moved the corner map; it read as slow. Now the satellite image fades in (420 ms) while the corner map shrinks from large into the corner (420 ms) at the same time, driven by one class (`is-shown`) in CSS, so leaving plays it backwards. The canvas, the per-frame drawing and `lib/mosaic.ts` are deleted.
- The satellite and the corner map are decoded before the fade starts; a card without a satellite image or without a known position simply skips the part it lacks. Reduced motion gets a plain 120 ms fade.
- Checked on `localhost:3400` with frames taken during the hover (locator, then satellite fading in with the large corner map shrinking, then settled) and after leaving.
- Modified: `apps/web/src/components/opportunity-media.tsx`, `apps/web/src/app/styles/tiles.css`; deleted `apps/web/src/lib/mosaic.ts`.
