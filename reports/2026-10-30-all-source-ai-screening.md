# All-source screening and project locations

Date: 2026-10-30. Model: GPT-6 Luna, high reasoning; Decisions API for broad initial triage.

The current local discovery API exposes **48 candidates**, including **6 China records**, compared with 10 visible records before this collection run. This increase measures coverage, not independently established accuracy. The Chinese records include a notice and a document page for the same hospital project.

## Actual collection

All 14 enabled sources were attempted with a publication window beginning 2026-09-30. The first pass collected up to 60 candidates per source and assessed up to 12 in detail. Three repaired adapters were rerun with up to 30 candidates and six detailed assessments each. Two failed notices received one bounded retry through the existing ingestion pipeline.

| Source | First-pass collected | First-pass upserts | Repair-pass collected / upserts |
| --- | ---: | ---: | ---: |
| TED | 60 | 11 | One failed notice retried / 1 |
| Competitions.archi | Collection failed | 0 | Local DNS remains unavailable |
| CanadaBuys | 60 | 12 | — |
| China GGZY | 60 | 12 | — |
| BOAMP | 60 | 12 | — |
| Municipal buyer profiles | 60 | 12 | — |
| ANAC | 60 | 0 | 30 / 3 |
| SCP | 0 | 0 | — |
| TenderNed | Collection failed | 0 | 30 / 6 |
| NZ GETS | 60 | 12 | — |
| Doffin | 17 | 12 | — |
| Spain PCSP | 60 | 7 | One notice still lacks a supported title |
| SIMAP | Collection failed | 0 | 30 / 6 |
| UK Contracts Finder | 60 | 12 | — |

There were 649 collected-document observations including repair passes and retries, not 649 unique projects. The original pass deferred 252 candidates beyond its detail cap; the repair pass deferred nine. Deferred candidates were not rejected and are not a persisted automatic-resume queue. This was a bounded recent-notice run, not an exhaustive historical crawl.

Thirteen source endpoints were readable after repair. SCP returned no notices in this run. Competitions.archi remains inaccessible to the local collector because DNS lookup fails. A Spanish notice still failed supported-title extraction after its retry; it was not admitted with an invented title. Original failure receipts remain alongside the successful repair receipts.

## Content judgment and evidence

AI mode bypasses source-specific topical, notice-type and keyword rejection gates. Protocol requirements, valid URLs, deduplication, date handling and source-grounded fact validation remain. The shared deployed Skill owns three matching principles: actual deliverable, current participation opportunity, and whether uncertainty changes the judgment.

Original API records and notice HTML take precedence over adapter-generated classifications. A real refrigeration-equipment notice and a parking/watermain notice were excluded after removing misleading generated design labels. This is a demonstrated correction of two cases, not a new precision estimate.

Unsupported optional fields or participation excerpts are omitted without automatically downgrading a supported content judgment. Unsupported decision evidence still yields `needs_review`; missing supported titles and malformed responses still fail. The changed test expectation reflects this separation and continues to require invented excerpts, amounts, currencies, dates and URLs to be rejected.

One real Chinese hospital design procurement was reassessed after this validation change. It returned `recommend`, with source-backed design stages, qualification and a future response deadline; missing attachment and exact-site details stayed explicit. Other candidates were not all reassessed after this final postprocessing change. Current published assessments total 76 exclusions, 47 needing review and one recommendation; some retained records are expired and are hidden by the default discovery query.

## Same-call extraction and maps

The detail response also retains short source clauses covering schedule, costs/remuneration, eligibility/team, scope/deliverables and documents/submission. Both Chinese and English interfaces show the original-language evidence and source links.

AI supplies only quoted project-place components. The geocoder resolves coordinates and falls back to city, region or country when needed. Buyer contact addresses cannot substitute for project sites; original address text is preserved. Precision labels distinguish a coarse area from a site match.

The map refresh processed 40 records with no reported errors. All six Chinese retained records now have city/region-level map positions. A hospital-campus homonym previously resolved near Shenzhen; requiring the returned place to match the supplied city context corrected it to the Luzhou area. These coarse positions are not verified building entrances. Chinese and long address cache keys are preserved, and derived geocode updates keep only already-current assessments current.

## Cost and validation

Normal configuration remains USD 1 per UTC day and USD 31 per month. Today's test used a process-only USD 3 ceiling. The ledger totals approximately **USD 1.45** for today including earlier development use and retained uncertain/reserved calls, approximately **USD 0.61** additional for this run. This is local accounting, not a verified provider invoice.

- `npm run check` passed for the integrated implementation; the final validation run is retained in `artifacts/all-enabled-20261030/check-final.log`.
- `npm run build:web` validates the production frontend; its final receipt is retained in `artifacts/all-enabled-20261030/build-final.log`.
- Skill Creator format validation passed. Focused tests cover concurrent budgets, broad intake, raw evidence, rejected optional facts, Chinese/homonym geocoding and current/stale advice handling.
- Browser checks confirmed the China filter, Chinese/English participation excerpts, numeric map links and precision labels. The long-evidence detail page fits a 390px viewport after the wrapping fix.
- A local D1 migration/query smoke check exercised the advisory-result lookup; no remote D1 data or production deployment was changed.

Runtime receipts are local under `artifacts/all-enabled-20261030/`: `batch.json`, `repaired-sources.json`, `document-retry.json`, `label-review2.json`, `optional-gates.json` and `map-refresh.json`. Canonical implementation contracts remain in [architecture](../docs/ARCHITECTURE.md) and [data contract](../docs/DATA_CONTRACT.md).
