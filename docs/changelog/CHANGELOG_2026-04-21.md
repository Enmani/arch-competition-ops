---
title: CHANGELOG 2026-04-21
status: 已完成
updated_at: 2026-04-21
related_docs:
  - docs/ai/doc-governance-standard.md
  - docs/AGENTS.md
  - docs/changelog/README.md
---

# CHANGELOG 2026-04-21

## Doc Governance Changelog Loop

### Changed

- Added `docs/changelog/**` to this repo's documentation-governance architecture as the dated closeout trace layer.
- Updated [docs/AGENTS.md](../AGENTS.md), [docs/ai/doc-governance-standard.md](../ai/doc-governance-standard.md), and [docs/skills/doc-governance-workflow.md](../skills/doc-governance-workflow.md) so changelog is now part of doc routing and same-round closeout rules.
- Extended `scripts/doc-governance.mjs` so `npm run check:doc-governance` scans `docs/changelog/**`.
- Added the subtree docs [docs/changelog/AGENTS.md](./AGENTS.md), [docs/changelog/README.md](./README.md), and [docs/changelog/_template.md](./_template.md).

### Why

- The repo already had canonical direction and execution layers, but it lacked a lightweight dated trace for meaningful delivery and governance rounds.
- Reusing the lighter `trinity-os` pattern adds closeout visibility without turning changelog into a second source of product, architecture, or queue truth.

### Validation

- `npm run check:doc-governance`
- `npm run check:doc-governance:file -- --file docs/ai/doc-governance-standard.md`
- `npm run check:doc-governance:file -- --file docs/AGENTS.md`
- `npm run check:doc-governance:file -- --file docs/skills/doc-governance-workflow.md`
- `npm run check:doc-governance:file -- --file docs/changelog/AGENTS.md`
- `npm run check:doc-governance:file -- --file docs/changelog/README.md`
- `npm run check:doc-governance:file -- --file docs/changelog/_template.md`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-21.md`
- `npm run check:encoding:all`

### Modified Files

- `AGENTS.md`
- `docs/AGENTS.md`
- `docs/ai/doc-governance-standard.md`
- `docs/skills/doc-governance-workflow.md`
- `scripts/doc-governance.mjs`
- `docs/changelog/AGENTS.md`
- `docs/changelog/README.md`
- `docs/changelog/_template.md`
- `docs/changelog/CHANGELOG_2026-04-21.md`

## Parser Reliability And Freshness Visibility

### Changed

- Added additive worker diagnostics tables in `apps/worker/src/arch_competition_ops/storage/database.py` for `source_runs` and `source_health`.
- Updated `apps/worker/src/arch_competition_ops/operations.py` so `ingest_source` records run history, parse failures, and source-local duplicate pressure without changing canonical `competitions` semantics.
- Added `getStoredSourceHealth()` and `getStoredDuplicatePressureSummary()` in `packages/storage/src/index.ts`, keeping `getStoredOpsSnapshot()` stable for existing callers.
- Added the new ops component `apps/web/src/components/ops-source-health-table.tsx` and rewired `apps/web/src/app/[locale]/ops/page.tsx` to show source freshness, parser health, and duplicate pressure.
- Extended `apps/web/src/i18n/dictionaries.ts` with `zh` and `en` product copy for the new ops diagnostics surface.
- Marked plan 02 complete and renamed it to `docs/plans/已完成-2026-04-19-02-parser-reliability-and-freshness-visibility-plan.md`.

### Why

- Operators needed a stable source-health view backed by worker/storage truth rather than ad hoc inference from opportunity cards.
- Duplicate pressure needed to be visible as an ops hint before the later review-queue plan lands.
- The implementation had to stay additive because `ensure_schema` is a high-blast-radius path and canonical competition storage could not be destabilized.

### Validation

- `uv run pytest apps/worker/tests/test_storage.py apps/worker/tests/test_collectors.py -k "source_diagnostics_tables or ingest_source"`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`

### Modified Files

- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/src/arch_competition_ops/storage/__init__.py`
- `apps/worker/src/arch_competition_ops/operations.py`
- `apps/worker/tests/test_storage.py`
- `apps/worker/tests/test_collectors.py`
- `packages/storage/src/index.ts`
- `packages/storage/src/index.test.ts`
- `apps/web/src/app/[locale]/ops/page.tsx`
- `apps/web/src/components/ops-source-health-table.tsx`
- `apps/web/src/i18n/dictionaries.ts`
- `apps/web/src/app/globals.css`
- `docs/plans/已完成-2026-04-19-02-parser-reliability-and-freshness-visibility-plan.md`
- `docs/changelog/CHANGELOG_2026-04-21.md`

## Deepen Canonical Normalization

### Changed

- Added `apps/worker/src/arch_competition_ops/normalizers/competition.py` as the shared canonical normalization owner for procedure keys, evidence levels, official notice IDs, and qualification inference.
- Kept `apps/worker/src/arch_competition_ops/models/competition.py` unchanged and narrowed `apps/worker/src/arch_competition_ops/extractors/common.py` to shared-adapter duties instead of letting extractor-side normalization keep growing.
- Tightened controlled vocabulary alignment in `config/taxonomy.yml`, `packages/storage/src/index.ts`, and `apps/web/src/i18n/dictionaries.ts` so normalized opportunity/procedure keys map cleanly across worker, storage, and UI.
- Updated `apps/web/src/components/opportunity-stream-item.tsx` and `apps/web/src/components/opportunity-detail-surface.tsx` to render normalized procurement metadata and use `unstated` for unknown booleans instead of ambiguous pending copy.
- Added regressions in `apps/worker/tests/test_extractors.py` and `packages/storage/src/index.test.ts`.
- Added a storage-side compatibility pass for legacy `procedure_type` values so already-stored rows no longer leak `secondary_discovery_listing`, `ANNOUNCEMENT_OF_COMPETITION`, or obvious markup/JSON garbage into discover/detail labels and filter options.
- Added the missing worker alias for `ANNOUNCEMENT_OF_COMPETITION` so future official procurement ingests normalize to `public_design_services_tender` instead of falling through to `design_contest`.
- Reorganized procedure handling into explicit canonical alias groups and suppressed-value groups, adding `selective`, `negotiated_procedure`, and `adapted_procedure` as stable taxonomy keys while keeping opaque values like `AD3` and `Altri avvisi` in the unknown path.
- Updated storage query filtering so canonical procedure filters expand back to legacy raw variants, keeping discover filters and API queries aligned with the labels shown for historical rows.
- Marked plan 03 complete and renamed it to `docs/plans/已完成-2026-04-19-03-deepen-canonical-normalization-plan.md`.

### Why

- The codebase had drift between extractor wording, taxonomy keys, storage labels, and UI copy, which made procurement facts look cleaner than the underlying truth actually was.
- `CompetitionRecord` had too much blast radius to expand casually, so the safer path was to centralize normalization behavior without changing the shared model shape.
- This round had to preserve unknown states and provenance while making later scoring and review-queue work depend on one reusable normalization path.
- Browser smoke showed that legacy rows already persisted in SQLite could still bypass the new worker-path normalization, so storage needed a backward-compatible read-time guardrail as well.
- Some raw procedure strings carried real legal meaning in source language, while others were merely opaque internal codes; the alias table had to separate those two cases instead of flattening both into raw UI output.

### Validation

- `uv run pytest apps/worker/tests/test_extractors.py apps/worker/tests/test_collectors.py apps/worker/tests/test_storage.py apps/worker/tests/test_automation.py`
- `uv run pytest apps/worker/tests/test_extractors.py -k announcement_of_competition`
- `uv run pytest apps/worker/tests/test_extractors.py -k "selective_procedure or opaque_procedure_code or french_procedure_variants or berlin_detail_html or frankfurt_detail_html"`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run test:storage -- --test-name-pattern "legacy procedure_type values"`
- `npm run test:storage -- --test-name-pattern "legacy procedure aliases through canonical keys"`
- `npm run lint:web`
- `npm run build:web`

### Modified Files

- `apps/worker/src/arch_competition_ops/normalizers/competition.py`
- `apps/worker/src/arch_competition_ops/extractors/common.py`
- `config/taxonomy.yml`
- `packages/storage/src/index.ts`
- `packages/storage/src/index.test.ts`
- `apps/web/src/i18n/dictionaries.ts`
- `apps/web/src/components/opportunity-stream-item.tsx`
- `apps/web/src/components/opportunity-detail-surface.tsx`
- `apps/worker/tests/test_extractors.py`
- `docs/plans/已完成-2026-04-19-03-deepen-canonical-normalization-plan.md`
- `docs/plans/README.md`
- `docs/changelog/CHANGELOG_2026-04-21.md`

## GitNexus Constraint Removal

### Changed

- Replaced the root [AGENTS.md](../../AGENTS.md) GitNexus section from mandatory workflow language to optional-tooling guidance.
- Removed repo-level requirements that forced `gitnexus_impact`, `gitnexus_detect_changes()`, and related GitNexus calls before every edit, refactor, or commit.
- Kept the lightweight note that GitNexus may still be used when graph-aware exploration is helpful, plus the pointer to `.claude/skills/gitnexus/**` as optional reference material.

### Why

- The previous root instruction layer over-constrained normal repo work and forced unnecessary GitNexus calls even for straightforward local edits.
- Making GitNexus optional keeps the tool available for harder tracing and refactor cases without turning it into repo-wide ceremony.

### Validation

- `npm run check:doc-governance:file -- --file AGENTS.md`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-21.md`
- `npm run check:encoding:all`

### Modified Files

- `AGENTS.md`
- `docs/changelog/CHANGELOG_2026-04-21.md`

## Remaining Plan Drift Repair

### Changed

- Updated `docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md` so the ops-review rollout now preserves the current ops snapshot and source-health diagnostics instead of describing `/[locale]/ops` as a summary-only surface.
- Updated `docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md` to match the current score owner in `apps/worker/src/arch_competition_ops/normalizers/competition.py`, and to treat explicit unknown normalized states as first-class scoring inputs instead of pretending the score still starts inside parser helpers.
- Updated `docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md` so the decision brief builds on the current storage-owned detail/feed path rather than inventing a second component-local inference layer.
- Updated `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md` so discover follow-up work preserves the new `getStoredDiscoverSurfaceData()` path instead of regressing to split feed/filter queries, and corrected downstream related-doc links.
- Updated `docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md` to point alert-preference API work at the workspace resolver from plan 07 rather than the unrelated bid/no-bid plan.

### Why

- The latest normalization and discover-surface refactors changed the current code truth enough that several future plans would have sent implementation back through already-removed paths or wrong dependency anchors.
- Repairing the plans now keeps later execution aligned with the current worker/storage/web ownership boundaries instead of reintroducing duplicate logic.

### Validation

- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-21.md`
- `npm run check:encoding:all`

### Modified Files

- `docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`
- `docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md`
- `docs/plans/施工中-2026-04-19-06-bid-no-bid-assistant-v1-plan.md`
- `docs/plans/已完成-2026-04-19-07-saved-search-and-watchlists-plan.md`
- `docs/plans/未实施-2026-04-19-08-alerts-and-digests-plan.md`
- `docs/changelog/CHANGELOG_2026-04-21.md`

## Ops Review Queue Delivery

### Changed

- Added additive ops-review persistence in `apps/worker/src/arch_competition_ops/storage/database.py` with the new tables `ops_review_queue_items` and `ops_review_decisions`.
- Added `apps/worker/src/arch_competition_ops/review_queue.py` and wired queue refresh into `ingest_source`, `verify`, `seed_demo`, and the new `refresh-review-queue` CLI path.
- Added the storage owner `packages/storage/src/ops-review.ts`, then re-exported queue reads, summary reads, and decision writes from `packages/storage/src/index.ts`.
- Added localized ops review UI and API wiring through `apps/web/src/app/[locale]/ops/page.tsx`, `apps/web/src/components/ops-review-queue.tsx`, `apps/web/src/components/ops-review-toolbar.tsx`, `apps/web/src/app/api/ops/review/route.ts`, and `apps/web/src/app/api/ops/review/[queueId]/route.ts`.
- Extended `apps/web/src/i18n/dictionaries.ts` and `apps/web/src/app/globals.css` so the queue stays bilingual and table-driven instead of falling back to generic dashboard cards.
- Marked plan 04 complete and renamed it to `docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`.
- Fixed the older ops snapshot query in `packages/storage/src/index.ts` by replacing the SQLite alias `primary` with `primary_count`, which was causing `/[locale]/ops` to 500 at runtime against the real database.

### Why

- The repo already had source-health and duplicate-pressure diagnostics, but operators still had no first-class place to triage the records that actually needed human review.
- Review state needed to stay explicitly separate from canonical opportunity facts, with one storage/API contract and no direct SQL inside route handlers.
- Browser-adjacent smoke exposed that the existing ops snapshot query still had a reserved-word alias bug which tests had not surfaced against the live database, so fixing that runtime regression was necessary to ship the queue safely.

### Validation

- `uv run pytest apps/worker/tests/test_storage.py apps/worker/tests/test_review_queue.py`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-10-verified-submission-intake-plan.md`
- `npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-21.md`
- `npm run check:doc-governance:file -- --file docs/plans/README.md`
- `npm run check:encoding:all`
- `Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3400/en/ops'`
- `Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:3400/api/ops/review?status=pending&reasonCode=all'`

### Modified Files

- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/src/arch_competition_ops/storage/__init__.py`
- `apps/worker/src/arch_competition_ops/review_queue.py`
- `apps/worker/src/arch_competition_ops/operations.py`
- `apps/worker/src/arch_competition_ops/cli.py`
- `apps/worker/tests/test_review_queue.py`
- `packages/storage/src/ops-review.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/index.test.ts`
- `apps/web/src/app/[locale]/ops/page.tsx`
- `apps/web/src/components/ops-review-queue.tsx`
- `apps/web/src/components/ops-review-toolbar.tsx`
- `apps/web/src/app/api/ops/review/route.ts`
- `apps/web/src/app/api/ops/review/[queueId]/route.ts`
- `apps/web/src/lib/ops-review-access.ts`
- `apps/web/src/i18n/dictionaries.ts`
- `apps/web/src/app/globals.css`
- `docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`
- `docs/plans/未实施-2026-04-19-10-verified-submission-intake-plan.md`
- `docs/plans/README.md`
- `docs/changelog/CHANGELOG_2026-04-21.md`
