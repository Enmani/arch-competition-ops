---
title: Preview Pipeline Architecture
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: done
updated_at: 2026-10-21
related_docs:
  - docs/AI_CONSTRAINTS.md
  - docs/structures/2026-10-21-storage-auth-api-architecture.md
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
  - reports/2026-10-21-code-audit.md
---

# Preview Pipeline Architecture

> 文件开头状态：done

This document is the architecture decision record for the preview part of the 2026-10-21 audit round (P6, F7, F8, F11, F12 and "Batch 4" of `reports/2026-10-21-code-audit.md`). It states where card images come from, what the request path may and may not do, how generation is made reproducible, and every non-obvious decision together with its risk and removal condition.

## Completed-State Architecture

Generation is offline. The request path only serves what generation produced.

```
SQLite (data/competitions.sqlite)            packages/previews  (Node CLI, tsx)
   |  read-only                                 bin/prewarm.mjs  -> src/cli.ts
   v                                                 |
apps/worker (after ingest, opt-in) ---------------->  pipeline/prewarm: per record
   argv fixed: node prewarm.mjs --db <db> --only-from-stdin                |
   stdin: {"competitionIds": [...]}                      official image (Stadt Zuerich) | satellite
                                                                           |
                                        address extraction -> geocoders (queue, cache) -> tiles -> sharp
                                                                           |
                                          artifacts/previews/{manifest.json, images/<slug>-<hash>.jpg, geocode-cache.json}
                                                                           |  npm run prewarm:previews -w @arch-competition/web (--publish)
                                                                           v
                                                   apps/web/public/previews/  -> next build -> Workers static assets (ASSETS)

GET /api/opportunities/[slug]/image?rev=<PREVIEW_ALGORITHM_VERSION>
   manifest hit with image  -> image/jpeg   (ASSETS binding on Workers, local directory under Node)
   otherwise                -> locator placeholder SVG (country outline, optional marker)
```

- The route imports no `sharp`, no `child_process`, no geocoder and no HTML/PDF fetching, and never fetches its own domain. A test asserts this on the source.
- Dev with no previews built shows placeholders only; nothing else is required to run the site.
- `packages/previews` splits into a Worker-safe surface (`/version`, `/location`, `/jurisdictions`, `/placeholder`, `/manifest`, `/serve`) and a Node-only surface (everything else, including `/serve/fs`).

## Capability Summary

- One CLI: `node packages/previews/bin/prewarm.mjs --db <sqlite> [--limit N] [--only ID]... [--only-from-stdin] [--out DIR] [--publish [DIR]] [--force] [--no-prune] [--retry-none-days N]`. stdout carries exactly one JSON line `{attempted, generated, skipped, failed}`; progress goes to stderr; exit codes: 0 ok, 1 failed, 2 usage, 75 another run holds the lock.
- Per record: skip when the manifest entry has the current algorithm version, the same source hash and its file; otherwise generate and write the image and the manifest entry (checkpointed every 20 records). Records with no usable preview are remembered (`kind: "none"` or `"locator"`) and retried after 7 days.
- A full run (no `--only`, no `--limit`) prunes manifest entries and images of records that are no longer visible (same visibility as the Web list).
- Manifest entry: `{file, kind, algorithmVersion, sourceHash, generatedAt, attribution, locator?}`. `kind` is `official-image`, `satellite`, `locator` (only coordinates known) or `none`.
- Placeholder: precomputed outlines for the covered countries (`data/country-outlines.json`, about 49 KB) instead of importing the 756 KB atlas; the marker uses plain spherical Mercator with the stored scale/translate (a test compares it with `d3.geoMercator`).

## Module Boundaries

| Module / Area | Responsibility | Must Not Own |
| --- | --- | --- |
| `packages/previews/src/version.ts` | `PREVIEW_ALGORITHM_VERSION`, bumped by hand | Anything derived from source files |
| `src/address/*`, `src/text/*` | Pure address extraction and cleaning from titles, pages, PDF text, JSON-LD | Network, files |
| `src/geocode/*` | Query building, result acceptance, rate-limited client, cache, providers | Document fetching |
| `src/documents/*` | Page/PDF fetching through the SSRF-guarded fetcher, PDF link ranking, signals | Geocoding |
| `src/net/*` | SSRF rules, bounded fetch, request budget | Business rules |
| `src/render/*` | Projection, tiles, ring and attribution overlays, quality check, composition | Geocoding |
| `src/official-image/*` | Picking and downloading the official page image (Stadt Zuerich) | Satellite logic |
| `src/pipeline/*` | SQLite reader, manifest/file store, lock, publish, orchestration | Rendering details |
| `src/manifest`, `src/serve` | Manifest schema and request-path lookup | Node APIs |
| `src/placeholder/*`, `src/location.ts`, `src/jurisdictions.ts` | Locator SVG, display locality/country code, the jurisdiction registry | Network |
| `data/*.json` | Word lists, jurisdiction registry, outlines | Logic |
| `apps/web/src/lib/opportunity-image-response.ts`, `.../image/route.ts` | Response logic and runtime wiring of the image route | Generation |
| `apps/worker/.../card_previews.py` | Fixed-argv call of the CLI after ingest | Rendering, reading TypeScript |

## Main Flows

1. Ingest: the worker stores records, then (when `ARCH_PREVIEW_PREWARM=1`) runs the CLI for the new ids and reports `card previews ok|skipped|failed`; failure never affects ingested data.
2. Publish: `npm run prewarm:previews -w @arch-competition/web` runs the CLI over all visible records and mirrors manifest plus referenced images into `apps/web/public/previews/`; the next build ships them as static assets.
3. Request: manifest (cached 60 s per isolate) -> `images/<file>` -> response. A request with `rev` equal to `PREVIEW_ALGORITHM_VERSION` for an image made by that version is `public, max-age=31536000, immutable`; any other asset hit is `max-age=3600`; the placeholder is `max-age=300` (404 placeholder 60); `next dev` sends `no-store`.
4. Per record generation: Stadt Zuerich official image if the record links to that site; otherwise title candidates, display locality, page signals (3 pages) and PDFs (3) in that order, geocode the first candidates, fetch 9 to 16 Esri tiles, compose, draw the precision ring and the credit line, JPEG.

## Decision Records

### 1. Generation moves out of the request path

Reason: the old route geocoded, fetched three pages and PDFs, called `pdftotext`, fetched tiles and ran `sharp` per request, none of which works on workerd and all of which amplified one browser request into many calls to third-party sites. Risk: a new record shows the placeholder until the next prewarm and deploy. Remove when: previews are written to R2 by the worker (Decision 9) and no deploy is needed.

### 2. `PREVIEW_ALGORITHM_VERSION` is a manual constant

Reason: hashing source files gave different values on different machines (CRLF vs LF) and changed on unrelated edits; the value was written into a tracked file by `predev/prebuild/prestart`, which dirtied the tree on every build. `.gitattributes` still pins LF so no remaining hash depends on line endings (`sourceHash` hashes record fields, not files). Risk: someone changes extraction without bumping, leaving stale images; the runbook and the comment on the constant say when to bump. Remove when: never; a mismatch only costs freshness.

### 3. The manifest, not file-name guessing, is the contract

The old route probed about nine candidate file names over HTTP against its own domain. Now one manifest read answers everything, and file names carry a content hash (`<slug>-<hash10>.jpg`), so replaced images get new names, old ones are deleted, and a stale name can never be served. Manifest file names are validated (`^[A-Za-z0-9][A-Za-z0-9._-]*\.jpg$`) at parse time, so a hostile manifest cannot escape the images directory.

### 4. Immutable only for matching revisions

`immutable` is sent only when the URL's `rev` equals the current version and the manifest entry was produced by it. Risk: regenerating an image for the same version and the same URL (source hash changed) is visible only after the one-hour asset cache or a version bump. Accepted: the generator only regenerates when inputs change, which is rare for an already-imaged record.

### 5. Geocoder hygiene

Nominatim and Photon requests go through one serialized queue per provider with a minimum interval (1.1 s and 0.7 s), honour `Retry-After` (one retry, at most 30 s, otherwise fail fast and keep the provider blocked), cap response size, and carry the User-Agent `arch-competition-ops-previews/0.1 (+contact: $ARCH_PREVIEW_CONTACT)`. Only definitive answers are cached (a coordinate, or "provider has nothing acceptable" with a 14-day TTL); timeouts, network errors, 429 and 5xx are never persisted, which was the old failure that turned one rate limit into permanent placeholders. Identical queries in flight share one request; cache writes are debounced and atomic (temp file plus rename). Each record has a budget of 120 s and 100 outgoing requests. Risk: with no contact configured the CLI warns and sends `contact-unset`, which the public instances may block; set it before running. `GEOCODE_CACHE_VERSION` must be bumped when acceptance rules change in a way that invalidates stored answers.

### 6. SSRF guard for scraped URLs

Page, PDF and image URLs come from scraped notices. `net/safe-fetch.ts` allows only http(s) on ports 80/443/8080/8443, no credentials, no private, loopback, link-local, CGNAT, metadata or reserved addresses (IPv4 and IPv6 including mapped and NAT64 forms), no single-label or internal host names. Because the check also runs in the connect-time DNS lookup, a host name that resolves to a private address is refused (DNS rebinding included); redirects are followed by hand, at most 5, each hop re-validated. Bodies are capped while streaming, compressed bodies under the same cap, and the whole call has a wall-clock limit. The geocoder and tile endpoints are fixed configuration and use plain `fetch`. Risk: a legitimate site on an unusual port is skipped; extend the allow-list in `net/ssrf.ts`.

### 7. Imagery attribution and terms

Every satellite image carries a bar with "Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community" and the same text is stored as the manifest `attribution` (override both with `ARCH_PREVIEW_TILE_ATTRIBUTION` when changing the tile URL). Tile requests no longer pretend to be Chrome. Risk: the public ArcGIS endpoint has terms of use that may require an account at higher volume; review them before commercial scale. Official images record `Image source: <host>`.

### 8. Dead code removed instead of kept compatible

`satellitePreviewTestUtils`, the runtime fallbacks, the Hamburg, attachment-only and "conservative placeholder" branches of the old card-image module (only `stadt-zuerich.ch` records ever reached it), the legacy-version file-name candidates, the "rename old images to the current revision" behaviour of the sync script, the three duplicated country maps (now `data/jurisdictions.json`) and the duplicate HTML helpers are gone. Tests were moved next to the modules they test.

### 9. Static assets now, R2 later

Previews ship as Workers static assets (`ASSETS`): no new binding, no new infrastructure, immutable caching by the platform. Limits: 20,000 files per version and one deploy per image change. R2 plus a `preview_key` column is the documented next step (`CLOUDFLARE_DEPLOY_RUNBOOK.md`); `wrangler.jsonc` deliberately has no R2 binding because a binding to a bucket that does not exist breaks deployment. The `PreviewAssetSource` interface is the seam. Remove ASSETS delivery when: R2 delivery is in place.

### 10. Direct SQLite read, not the storage package

The CLI opens the database read-only with a fixed column list. `packages/storage` applies migrations when it opens a database, which an offline job must never do to the canonical file. Risk: a renamed `competitions` column breaks the CLI; the Python-to-CLI integration test in `apps/worker/tests/test_card_previews.py` runs the real CLI against a freshly created schema and catches it.

### 11. Jurisdiction registry lives in the package

`packages/previews/data/jurisdictions.json` replaces three hand-kept maps (display code, outline source, comparison names, plus the Nominatim country code). `apps/web/src/lib/jurisdictions.ts` was written concurrently with the same content; whichever side survives, there must be one registry: the Web file should re-export from `@arch-competition/previews/jurisdictions` (exported for that purpose) instead of keeping its own copy.

## Extension Points

- A new covered country: add it to `data/jurisdictions.json` (and `atlasName`/`polygonCount` for an outline), then `npm run build:outlines -w @arch-competition/previews`.
- A new official image source: add host rules next to `src/official-image/scoring.ts` and widen `isStadtZurichOpportunitySource`; keep fetching on the `DocumentContext`.
- R2 delivery: implement `PreviewAssetSource` over `env.PREVIEWS` and select it in the route (see runbook).

## Out Of Scope

- A strict Content-Security-Policy (the headers added in `next.config.ts` deliberately omit it).
- Rate limiting of the image route itself: it now does a manifest lookup (and, for a miss, one database read), not external work.
- Pre-generating previews on Cloudflare; the generator needs Node, `sharp` and optionally poppler's `pdftotext`.
- Removing manifest entries when the worker deletes expired records (Python removes the image files; the next full generator run prunes the manifest).

## Linked Plans

- `docs/plans/2026-04-30-cloudflare-workers-d1-deployment-plan.md`
