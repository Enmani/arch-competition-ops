---
title: Deepen Canonical Normalization Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 已完成
updated_at: 2026-04-21
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-01-expand-official-source-coverage-plan.md
  - docs/AI_CONSTRAINTS.md
  - docs/ARCHITECTURE.md
---

# Deepen Canonical Normalization Plan

> Expected Outcome: The canonical opportunity model carries cleaner procedure, implementation-path, qualification, value, and deadline fields, and downstream web surfaces read those fields through storage without UI-side inference. This round does not introduce AI decisioning yet; it tightens the shared contract that later scoring and summaries depend on.

## This Round

### In Scope

- taxonomy and key normalization improvements
- stronger canonical competition record fields
- storage and core mapping updates for the normalized contract

### Out Of Scope

- qualification scoring UI
- watchlists and workflow state
- submission intake
- new monetization surfaces

## Success Criteria

- taxonomy keys for core procurement and qualification signals are stable and reusable
- worker output preserves unknown states instead of silently guessing
- storage reads expose normalized keys and labels with fewer fallbacks
- taxonomy values, storage fixtures, and UI label maps stay aligned for procedure and implementation fields
- web surfaces can render richer facts without ad hoc formatting logic inventing meaning

## Execution Order

## Task 1: Tighten canonical field ownership in the worker model
**Goal**  
Make the competition record a stronger truth owner for procurement and qualification fields.

**Files**  
`apps/worker/src/arch_competition_ops/models/competition.py`  
`apps/worker/src/arch_competition_ops/normalizers/keys.py`  
`apps/worker/src/arch_competition_ops/normalizers/competition.py`  
`apps/worker/src/arch_competition_ops/extractors/common.py`

**Execute**  
Introduce or refine normalization helpers for procedure type, implementation path, qualification signals, official notice identity, and deadline/value handling. If the current `CompetitionRecord` shape is missing a shared field needed by multiple sources, add it once in `models/competition.py` and normalize it centrally in a dedicated `normalizers/competition.py` owner file. Until that owner exists, keep `extractors/common.py` as a thin adapter rather than a second long-term truth owner.

**Pass Criteria**  
Canonical field logic is centralized and reusable instead of being duplicated inside source-specific extractors.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 2: Align taxonomy keys and extractor outputs
**Goal**  
Ensure extractor outputs converge on controlled vocabulary rather than raw source wording.

**Files**  
`config/taxonomy.yml`  
`apps/worker/src/arch_competition_ops/extractors/common.py`  
`apps/worker/src/arch_competition_ops/extractors/registry.py`  
`apps/worker/src/arch_competition_ops/extractors/anac.py`  
`apps/worker/src/arch_competition_ops/extractors/boamp.py`  
`apps/worker/src/arch_competition_ops/extractors/buyer_profile.py`  
`apps/worker/src/arch_competition_ops/extractors/ted.py`  
`apps/worker/src/arch_competition_ops/extractors/scp.py`  
`apps/worker/src/arch_competition_ops/extractors/simap.py`  
`apps/worker/src/arch_competition_ops/extractors/generic_listing.py`

**Execute**  
Map recurring procurement wording into the controlled vocabulary in `config/taxonomy.yml`. Apply the sweep across the extractor modules that are actually registered today, and if the same mapping appears in more than one live extractor, pull it back into shared helpers or registry wiring instead of fixing only one source branch.

**Pass Criteria**  
Source-specific wording no longer leaks into storage where a stable taxonomy key should exist.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 3: Update storage and shared contracts to consume the stronger normalized shape
**Goal**  
Make the storage and shared TypeScript contracts reflect the richer canonical model without a second mapping layer.

**Files**  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`  
`packages/core/src/competition.ts`  
`packages/core/src/index.ts`

**Execute**  
Update row-to-contract mapping to use the new normalized fields and reason about unknown states explicitly. Extend shared UI-facing types only where the web app needs stable access to normalized keys or labels.

**Pass Criteria**  
Storage remains the only read-layer owner for canonical opportunity mapping, and downstream callers have a cleaner contract.

**Verify**  
Run `npm run test:storage`.

## Task 4: Reconcile public and detail surfaces with the improved normalized fields
**Goal**  
Use the stronger normalized contract in UI surfaces without inventing facts there.

**Files**  
`apps/web/src/components/opportunity-stream-item.tsx`  
`apps/web/src/components/opportunity-detail-surface.tsx`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Replace fallback-heavy rendering with explicit normalized keys where available. Keep official-source text in source language when needed, but localize taxonomy and UI copy through `dictionaries.ts`.

**Pass Criteria**  
Feed and detail surfaces expose cleaner procurement facts and fewer ambiguous placeholders.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Risks And Rollback

- If taxonomy changes become too source-specific, move those cases back to extractor-level mapping and keep the taxonomy tighter.
- If canonical schema growth starts to mirror raw source data, stop and keep only reusable normalized fields.
- If UI rendering depends on missing historical data, keep graceful unknown states instead of backfilling guesses.

## Execution Notes

- Unknown stays unknown.
- Official-source wording may stay untranslated when it is evidence text.
- Do not let web code become the normalization layer.
- Reconcile current drift between taxonomy values, storage fixtures, and dictionary labels in the same round instead of relying on title-case fallbacks to hide unsupported keys.
- 2026-04-21: Kept `CompetitionRecord` unchanged after impact review showed the model was a high-blast-radius truth owner; introduced `apps/worker/src/arch_competition_ops/normalizers/competition.py` as the canonical normalization owner instead.
- 2026-04-21: Reduced `apps/worker/src/arch_competition_ops/extractors/common.py` to a thin adapter and moved reusable procedure, evidence, official-notice, and qualification inference into the shared normalizer path.
- 2026-04-21: Tightened taxonomy convergence so official notice variants normalize to `public_design_services_tender`, framework-like values normalize consistently, and `secondary_discovery_listing` does not leak through as a canonical opportunity type.
- 2026-04-21: Added explicit storage label maps and web dictionary coverage for canonical opportunity and procedure keys, while leaving `packages/core` unchanged because the existing shared contract already covered the UI needs for this round.
- 2026-04-21: Updated discover/detail rendering to show normalized opportunity-type and procedure metadata and to use `unstated` rather than ambiguous pending copy for missing eligibility, evidence, and qualification booleans.
- 2026-04-21: Added regression coverage in worker and storage tests for canonical normalization, label alignment, and fixture behavior.
- 2026-04-21: Browser smoke on `/en/discover` exposed historical `procedure_type` drift still leaking into UI from already-stored rows; storage now normalizes legacy procedure values on read and suppresses obvious markup/JSON garbage instead of title-casing it.
- 2026-04-21: Added the missing worker alias for `ANNOUNCEMENT_OF_COMPETITION` so future official procurement ingests normalize to `public_design_services_tender` instead of regressing to `design_contest`.
- 2026-04-21: Reorganized procedure normalization into explicit high-confidence alias groups shared by worker and storage, adding canonical keys for `selective`, `negotiated_procedure`, and `adapted_procedure` instead of leaving multilingual source wording to leak through.
- 2026-04-21: Kept opaque source codes such as `AD3` and bucket labels such as `Altri avvisi` in the unresolved path, so UI and filters show pending state rather than pretending to know a more specific legal procedure.
- 2026-04-21: Made discover/storage filtering expand canonical procedure keys back to their legacy raw variants, so filter options, API queries, and rendered labels stay consistent even before historical rows are re-ingested.
- 2026-04-21: Follow-up smoke check showed the remaining unmapped procedure values in SQLite are now only garbage fragments or genuinely missing values, not missed high-confidence aliases.

## Verification Evidence

- `uv run arch-competition-ops verify`
- `uv run pytest apps/worker/tests/test_extractors.py -k announcement_of_competition`
- `uv run pytest apps/worker/tests/test_extractors.py -k "selective_procedure or opaque_procedure_code or french_procedure_variants or berlin_detail_html or frankfurt_detail_html"`
- `npm run test:storage`
- `npm run test:storage -- --test-name-pattern "legacy procedure_type values"`
- `npm run test:storage -- --test-name-pattern "legacy procedure aliases through canonical keys"`
- `npm run lint:web`
- `npm run build:web`
