---
title: Expand Official Source Coverage Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 已完成
updated_at: 2026-04-19
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/ARCHITECTURE.md
  - docs/AI_CONSTRAINTS.md
---

# Expand Official Source Coverage Plan

> Expected Outcome: The worker can ingest a broader set of official procurement and authority sources without creating a parallel ingestion path. When this plan lands, country-pack source files and reusable collector families are ready to expand official coverage across target jurisdictions with honest enabled versus scaffold-only states. This round does not redesign ranking, UI, or submission intake.

## This Round

### In Scope

- add new official-source entries through the country-pack source files
- wire new sources into collector and extractor registries
- reuse existing collector/extractor patterns and `collector:` families for authority pages and procurement hubs
- keep provenance fields explicit in every new source definition
- keep blocked official sources as disabled scaffolds instead of pretending they are live

### Out Of Scope

- scoring changes
- discover UI changes
- manual curation workflow
- homeowner or private demand sources

## Success Criteria

- `config/sources.yml` stays a thin manifest while new target sources land in `config/source_packs/countries/*.yml`
- collector and extractor registries resolve each new source without fallback hacks
- shared collector families are reused through `collector:` before adding new source-id-specific registry entries
- country coverage can distinguish enabled, scaffold-only, and empty packs without guessing from chat context
- the worker can run against the expanded registry without breaking existing source handling
- all verification commands for worker health still pass

## Execution Order

## Task 1: Expand the country-pack source registry
**Goal**  
Define the next official procurement and authority sources in the country-pack layer, with enough metadata for stable collection and prioritization.

**Files**  
`config/sources.yml`  
`config/source_packs/countries/*.yml`  
`apps/worker/src/arch_competition_ops/country_packs.py`  
`apps/worker/src/arch_competition_ops/config_loader.py`  
`apps/worker/src/arch_competition_ops/models/source.py`

**Execute**  
Keep `config/sources.yml` as the thin include manifest and add the next batch of official procurement and authority sources to `config/source_packs/countries/{country}.yml`. Use enabled packs only when the official entry point is verified from the current environment. If the current source model lacks a stable field required by multiple official sources, extend `models/source.py` and `config_loader.py` once and reuse it.

**Pass Criteria**  
Country packs remain the truth owner for country-specific source definitions, and each new source can be loaded by the existing manifest plus include path.

**Verify**  
Run `uv run arch-competition-ops doctor`.

## Task 2: Register the collector path for the new sources
**Goal**  
Make each new source resolvable by the worker's collector registry without forking a separate workflow.

**Files**  
`apps/worker/src/arch_competition_ops/collectors/registry.py`  
`apps/worker/src/arch_competition_ops/collectors/common.py`  
`apps/worker/src/arch_competition_ops/collectors/municipal.py`  
`apps/worker/src/arch_competition_ops/country_packs.py`  
`apps/worker/src/arch_competition_ops/operations.py`

**Execute**  
Route new source types through the nearest existing collector implementation. Prefer `collector:` family reuse in the pack YAML before adding a new source-id-specific registration. Keep municipal and authority-page collection inside `municipal.py` unless a new collector is required by materially different fetch behavior. Update `collectors/registry.py` only when a genuinely new upstream shape appears.

**Pass Criteria**  
There is no new side path for collection. All new sources are reachable through the existing collector registry, and collector-family reuse stays the default.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 3: Register the extractor path for the new sources
**Goal**  
Ensure collected payloads from the new sources can be normalized into the canonical competition record shape.

**Files**  
`apps/worker/src/arch_competition_ops/extractors/registry.py`  
`apps/worker/src/arch_competition_ops/extractors/common.py`  
`apps/worker/src/arch_competition_ops/extractors/generic_listing.py`  
`apps/worker/src/arch_competition_ops/extractors/buyer_profile.py`

**Execute**  
Map each new source to the narrowest reusable extractor. Prefer `generic_listing.py` or `buyer_profile.py` before creating a new extractor. If a source needs source-specific handling, add one new extractor file and register it centrally rather than embedding branching logic across multiple extractors. Do not invent extractor branches just to force a weak or blocked official source into enabled status.

**Pass Criteria**  
Every new source has one explicit extraction owner and returns `CompetitionRecord`-compatible data without bypassing normalization.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 4: Validate that coverage expansion did not break the existing intake path
**Goal**  
Confirm that new source registration does not degrade the current worker flow or storage assumptions.

**Files**  
`apps/worker/src/arch_competition_ops/cli.py`  
`apps/worker/src/arch_competition_ops/operations.py`  
`apps/worker/src/arch_competition_ops/storage/database.py`

**Execute**  
Run the worker verification flow after registry expansion. Also check the country-pack coverage view so newly touched countries end in an honest state: enabled, scaffold-only, or empty. If a source introduces malformed or partial output, fix the collector/extractor path rather than patching storage to accept bad normalized data.

**Pass Criteria**  
Expanded coverage works inside the same worker lifecycle and does not weaken canonical storage expectations.

**Verify**  
Run `uv run arch-competition-ops doctor`, `uv run arch-competition-ops verify`, and `uv run arch-competition-ops show-country-coverage`.

## Risks And Rollback

- If a new source needs one-off fetch logic that does not generalize, pause that source instead of polluting shared collector code.
- If new sources reduce extraction quality, roll them back at the registry layer and preserve the cleaner source set.
- If config model changes risk breaking all existing sources, split the model extension into a backward-compatible addition.
- If an official source is real but not currently ingestible from this environment, keep it scaffold-only and document why instead of enabling a fake live path.

## Execution Notes

- Keep every new source official-source-first and procurement-first.
- Keep country source work inside `config/source_packs/countries/*.yml` unless the manifest layer itself changes.
- Preserve `official_url` and `source_url` through the whole path.
- Do not add aggregator-first discovery just to increase record count.
- 2026-04-19: enabled Spain through a bounded `pcsp_atom_feed` collector that uses the official Atom feed plus public detail pages for CPV and deadline extraction.
- 2026-04-19: added a formal `disabled_scaffold` collector family so blocked official sources keep explicit registry wiring without pretending they are live.
- 2026-04-19: worker coverage now reports 10 enabled country packs, 3 scaffold-only packs, and 40 empty packs.

## Verification Evidence

- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `uv run arch-competition-ops show-country-coverage`
- `uv run pytest apps/worker/tests/test_collectors.py -q`
- `uv run arch-competition-ops ingest-source --source-id pcsp_syndicated_notices --limit 2 --publication-date-from 2026-04-01`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`

