---
title: Introduce Crawlee Browser Fallback Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 已完成
updated_at: 2026-04-19
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-01-expand-official-source-coverage-plan.md
  - docs/AI_CONSTRAINTS.md
  - docs/ARCHITECTURE.md
---

# Introduce Crawlee Browser Fallback Plan

> Expected Outcome: The worker gains a browser-grade fallback for official-page verification without replacing the existing collector, extractor, verifier, and storage flow. When this plan lands, JS-dependent official pages can still resolve `official_url`, `prize_summary`, and PDF/program links through the same canonical record path. This round does not migrate the whole ingestion system to Crawlee or create a second storage workflow.

## This Round

### In Scope

- add a narrow Crawlee-powered browser runtime inside `apps/worker`
- use that runtime as a fallback for official-page verification when HTTP fetch is insufficient
- preserve canonical field ownership for `official_url`, `source_url`, `prize_summary`, and `brief_pdf_url`
- keep browser runtime outputs inside `artifacts/`
- add tests for browser fallback success and graceful degradation

### Out Of Scope

- replacing all collectors with Crawlee
- redesigning the worker CLI into an async-first framework
- introducing Crawlee datasets or request queues as canonical storage
- adding LLM extraction as a primary parsing path
- broad PDF content extraction beyond link discovery in this round

## Success Criteria

- the worker still runs through `collect -> parse -> verify -> upsert`
- browser fallback only activates for sources and cases that need rendered DOM access
- `source_url` continues to point at the original source payload while `official_url` can be upgraded by verified authority-page evidence
- when a source provides a separate competition-materials portal, that portal can be preserved without overwriting `official_url`
- browser artifacts stay under `artifacts/` and do not create an unmanaged parallel storage tree
- worker verification and focused tests pass with and without browser fallback enabled

## Execution Order

## Task 1: Add a bounded Crawlee runtime for worker-side rendering
**Goal**  
Introduce a reusable browser execution layer without changing the rest of the worker into a crawler framework.

**Files**  
`pyproject.toml`  
`apps/worker/src/arch_competition_ops/settings.py`  
`apps/worker/src/arch_competition_ops/browser/crawlee_runtime.py`

**Execute**  
Add `crawlee[playwright]` to the existing browser dependency path rather than replacing `playwright`. Introduce a dedicated browser runtime module that exposes narrow functions such as page render and PDF-link discovery. Keep the public interface synchronous so current CLI and operations code can call it safely. Configure Crawlee storage to resolve under `artifacts/crawlee` instead of the default local storage path.

**Pass Criteria**  
The worker has one explicit owner for browser rendering, and Crawlee can run without creating a second ingestion or storage workflow.

**Verify**  
Run `uv sync --extra browser` and `playwright install`.

## Task 2: Route official verification through browser fallback only when HTTP evidence is insufficient
**Goal**  
Use Crawlee where it materially improves verification instead of replacing the whole fetch layer.

**Files**  
`apps/worker/src/arch_competition_ops/verifiers/simap.py`  
`apps/worker/src/arch_competition_ops/verifiers/registry.py`

**Execute**  
Keep the current domain derivation, sitemap discovery, and HTML parsing path as the primary flow. Add a fallback branch that renders the shortlisted official candidate page when direct HTTP fetch cannot confirm the page, cannot expose the relevant DOM text, or cannot reveal program/PDF links. Limit this round to `simap_official_enricher` so the blast radius stays small and the runtime contract is proven before reuse by other verifiers.

**Pass Criteria**  
Verification quality improves for JS-dependent official pages without weakening the current official-source-first logic or expanding browser usage to every source.

**Verify**  
Run `uv run pytest apps/worker/tests/test_verifiers.py`.

## Task 3: Preserve canonical provenance and evidence-note behavior
**Goal**  
Ensure browser rendering changes evidence collection, not canonical truth ownership.

**Files**  
`apps/worker/src/arch_competition_ops/models/competition.py`  
`apps/worker/src/arch_competition_ops/storage/database.py`  
`apps/worker/src/arch_competition_ops/verifiers/simap.py`

**Execute**  
Confirm that browser fallback only enriches the existing canonical record fields. Keep `source_url` untouched, only upgrade `official_url` when the rendered page still passes authority-page matching, and append a precise `evidence_note` when rendered DOM evidence or browser-discovered PDF links were used. If a browser run fails or yields weak evidence, leave fields empty rather than inventing values.

**Pass Criteria**  
Canonical records remain evidence-first, provenance-safe, and compatible with the current storage schema and upsert path.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 4: Add regression tests for fallback success and fallback failure
**Goal**  
Prove that browser fallback improves difficult pages without becoming a hidden requirement for all verification.

**Files**  
`apps/worker/tests/test_verifiers.py`  
`apps/worker/tests/test_collectors.py`

**Execute**  
Add focused tests for these cases: HTTP-only path still works, browser fallback upgrades an official page and prize summary, browser-discovered PDF links can populate `brief_pdf_url` when explicit evidence exists, and browser runtime failure leaves the record safe rather than corrupting provenance fields. Mock the browser runtime instead of depending on live browsing in unit tests.

**Pass Criteria**  
The test suite covers both enrichment and degradation paths, and browser fallback remains optional rather than implicit.

**Verify**  
Run `uv run pytest apps/worker/tests/test_collectors.py apps/worker/tests/test_verifiers.py`.

## Task 5: Validate the end-to-end worker flow on a known live source
**Goal**  
Confirm that the new fallback works inside the existing production-like ingest path.

**Files**  
`apps/worker/src/arch_competition_ops/operations.py`  
`apps/worker/src/arch_competition_ops/cli.py`

**Execute**  
Run a narrow live ingest against `simap_public_design_notices` and inspect whether the known authority-page example still upgrades correctly, keeps `source_url` on the `simap` detail endpoint, and records browser-derived evidence only when actually used. If browser execution proves too slow or noisy, add a verifier-level opt-in or stricter trigger condition instead of broadening usage.

**Pass Criteria**  
The same CLI path continues to ingest records successfully, and the new browser fallback behaves like an enrichment layer rather than a replacement workflow.

**Verify**  
Run `uv run arch-competition-ops doctor`, `uv run arch-competition-ops verify`, and `uv run arch-competition-ops ingest-source --source-id simap_public_design_notices --limit 20`.

## Risks And Rollback

- If Crawlee introduces unstable local storage or cache side effects, force all runtime output under `artifacts/crawlee` or roll the dependency back before expanding usage.
- If browser rendering becomes a hidden dependency for routine sources, tighten trigger conditions and keep HTTP fetch as the default path.
- If verifier code starts carrying browser-specific logic everywhere, move the shared execution details back into the dedicated runtime module.
- If PDF-link discovery produces noisy links, leave `brief_pdf_url` empty and defer deeper PDF handling to a follow-up Docling round.

## Execution Notes

- Do not replace API-, RSS-, CSV-, or OCDS-based collectors with browser fetching in this round.
- Do not let Crawlee dataset or queue abstractions become a second source of truth.
- Unknown stays unknown when the browser does not produce explicit evidence.
- If a direct PDF is not public but an external documents portal exists, preserve the portal URL separately instead of forcing it into `official_url` or `brief_pdf_url`.
- This plan is intentionally a phase-one integration focused on official-page verification, not a framework migration.

## Verification Evidence

- `uv sync --extra browser`
- `playwright install`
- `uv run pytest apps/worker/tests/test_collectors.py apps/worker/tests/test_verifiers.py`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`
- `uv run arch-competition-ops ingest-source --source-id simap_public_design_notices --limit 20`
- `npm run check:doc-governance:file -- --file docs/plans/已完成-2026-04-19-11-introduce-crawlee-browser-fallback-plan.md`
