---
title: Frame-less discover list and stored-coordinate satellite previews
status: done
updated_at: 2026-11-13
related_docs:
  - docs/structures/2026-10-21-preview-pipeline-architecture.md
  - docs/AI_CONSTRAINTS.md
---

# 2026-11-13

## Frame-less discover list

### Changed

- Each opportunity tile is a three-row subgrid (square image, title, caption) with no border, no card fill and no hairline; hierarchy comes from type weight and spacing.
- The caption carries four facts only: name, `City, CC`, value, deadline. The city is reduced from the stored locality, never invented: a Chinese address keeps its leading administrative city (柳州市鸡喇路1号 → 柳州市), a street address is skipped in favour of its city segment, and a locality that cannot be reduced falls back to the country name.
- A locality the locator already rejects as a street address (`230 Milson Line, Palmerston North`) still yields its city segment; the 28-character cap falls back to the country so an unsplittable sentence never becomes a caption.
- Filter controls are bare type: no pill, no border, no badge. The active facet is underlined and carries its count as `(n)`; the row wraps on wide screens and scrolls horizontally below 960px.
- The locale trigger, the search field and the top bar drop their borders on discover; the top bar stacks brand, navigation and search below 640px.

### Why

The list had grown a frame around every card and a badge on every filter, which competed with the records themselves. Licensed architects scan names, places and deadlines; everything else belongs on the detail page.

### Validation

- `npm run test:web` (97 tests), `npm run lint:web`, `npm run typecheck`, `npm run build:web`, `npm run check`
- Screenshots: `artifacts/design/discover-satellite-zh.png`, `-en.png`, `-dark.png`, `-mobile.png`

### Modified Files

- `apps/web/src/app/styles/tiles.css`, `discover-dock.css`, `discover-forms.css`, `layout.css`, `tokens.css`
- `apps/web/src/components/opportunity-stream-item.tsx`, `discover-dock.tsx`
- `apps/web/src/lib/opportunity-display.ts`, `opportunity-display.test.ts`

## Stored-coordinate satellite previews

### Changed

- The batch job now tries the record's own `geo_lat`/`geo_lng` before any address work. A stored point is used when `geo_source` is not a country centroid and confidence is at least 0.5; it renders tiles directly, so one record costs about 1.5 s instead of a second geocode plus a page crawl. Address candidates, page signals and PDFs remain the fallback when no usable point is stored.
- A country centroid (`nominatim:country`, confidence 0.25) is deliberately never rendered as imagery: the middle of a country is not the site, and the country outline placeholder is the honest answer.
- `isSafeImageFileName` accepts a leading underscore. A non-Latin slug sanitises to `___ggzy_...jpg`, and the previous rule dropped those manifest entries at parse time, so 8 Chinese records that had images always fell back to the placeholder.
- The locator placeholder keeps the paper edge to edge but insets the country outline by 40px inside the 616px panel: the inner frame, the country code, the country/city labels and the label-fitting code are gone. A coastline that stops on the frame read as a crop; the caption under the card already names the place.

### Why

The database already held worker-resolved coordinates for most records, but the generator ignored them and geocoded everything again, which made the job slow and left records with a valid point showing an empty map.

### Validation

- Full pass over 104 visible records: 76 images, 0 failed, about 5.5 minutes; the 76 precise-coordinate records alone took 41 s
- 28 records keep the outline: 43 have only a country centroid, 25 have none, and the fallback geocoder did not improve them
- `npm run test:previews` (184 tests), `npm run test:web` (97 tests), `npm run check`, `npm run build:web`
- Published 76 images to `apps/web/public/previews` for the production build

### Modified Files

- `packages/previews/src/pipeline/resolve-record.ts`, `db.ts`, `types.ts`, `prewarm.test.ts`, `cli.test.ts`, `pipeline/resolve-record.test.ts`
- `packages/previews/src/placeholder/render.ts`, `render.test.ts`
- `packages/previews/src/manifest/index.ts`, `index.test.ts`
- `packages/previews/scripts/build-country-outlines.mjs`, `data/country-outlines.json`
- `apps/web/src/lib/opportunity-image-response.test.ts`
- `docs/structures/2026-10-21-preview-pipeline-architecture.md`