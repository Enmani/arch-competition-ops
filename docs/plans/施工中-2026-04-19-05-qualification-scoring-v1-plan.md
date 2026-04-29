---
title: Qualification Scoring V1 Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 施工中
updated_at: 2026-04-22
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-03-deepen-canonical-normalization-plan.md
  - docs/research/2026-04-19-ai-era-disruption-and-strategy.md
---

# Qualification Scoring V1 Plan

> Expected Outcome: Every opportunity surfaces a clearer professional-value score plus explainable score reasons derived from normalized facts. The repo already has a worker-owned numeric score and basic detail-page rendering; this round finishes the explainability and storage contract work without introducing a second score owner or jumping straight to bid/no-bid automation.

## Current Baseline

- The worker already computes and persists a numeric `qualification_score` through `apps/worker/src/arch_competition_ops/normalizers/competition.py`.
- `apps/worker/src/arch_competition_ops/extractors/common.py` is already a thin adapter that delegates back into the normalizer-owned scoring path.
- `packages/storage/src/index.ts` already exposes `qualificationScore` in the current feed/detail contract, and the detail page already renders the raw numeric value.
- The missing work is reason-code generation, explicit low-evidence handling, storage exposure for score rationale, and compact browse/detail presentation that does not ask the UI to reverse-engineer score logic.

## This Round

### In Scope

- refine score factors around explicit normalized unknown states
- compute and persist score reason codes next to the existing numeric score
- expose score rationale through storage-owned feed/detail fields
- render compact score context in feed and detail surfaces

### Out Of Scope

- external LLM calls
- automated bid/no-bid recommendation
- user-specific weighting
- workflow state changes
- replacing the current worker-owned score path with component-local logic

## Success Criteria

- score inputs remain explicit and stable inside one worker-owned implementation
- every visible score can be traced to persisted reason codes or explicit fallback states
- low-information records do not receive falsely precise high scores
- feed and detail surfaces can render score context consistently without recomputing rationale in TypeScript

## Execution Order

## Task 1: Extend the current worker-side scoring owner
**Goal**  
Keep one reusable worker-side score owner while adding reason-code output and stronger uncertainty handling.

**Files**  
`apps/worker/src/arch_competition_ops/normalizers/competition.py`  
`apps/worker/src/arch_competition_ops/extractors/common.py`  
`apps/worker/src/arch_competition_ops/models/competition.py`  
`apps/worker/src/arch_competition_ops/storage/database.py`

**Execute**  
Keep `apps/worker/src/arch_competition_ops/normalizers/competition.py` as the default score owner and extend it with deterministic reason-code generation plus stronger low-evidence clamping. Treat explicit normalized unknown states such as missing `procedure_type`, missing `implementation_path`, or `opportunity_type = unknown` as negative or uncertainty-bearing inputs rather than silent positives. Only extract into a separate `ranking/qualification.py` module if that new module becomes the sole long-term owner.

**Pass Criteria**  
Scoring still has one owner, and later consumers do not need to reimplement score logic or infer missing reasons from raw fields.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 2: Persist canonical score reasons next to the existing score
**Goal**  
Ensure the score is tied to procurement-first signals rather than vague heuristics, and that reason codes have one persisted truth owner.

**Files**  
`apps/worker/src/arch_competition_ops/models/competition.py`  
`apps/worker/src/arch_competition_ops/storage/database.py`  
`apps/worker/src/arch_competition_ops/operations.py`

**Execute**  
Persist short score reason codes through an additive `qualification_reason_codes` JSON text column on `competitions` so storage can surface them without recomputing score rationale in TypeScript. Keep both positive and negative signals explicit, and update seed/demo or other worker-owned write paths so newly written rows stay consistent.

**Pass Criteria**  
The score and its reason codes are explainable, persisted, and do not require reading source code to understand why a record scored well or poorly.

**Verify**  
Run `uv run arch-competition-ops verify`.

## Task 3: Expose score and reasons through storage
**Goal**  
Make score context available to the web layer through storage-owned mappings.

**Files**  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`  
`apps/web/src/app/[locale]/opportunities/[slug]/page.tsx`

**Execute**  
Extend the existing storage feed/detail mapping so score and persisted reason-code data are available to UI callers through the current storage-owned paths, including `queryStoredOpportunityFeed()` and `getStoredOpportunityFeedItemBySlug()`. Keep the current contract backward-compatible where possible, and do not ask UI components to derive score rationale from raw source fields. Only expand `packages/core` if a second non-storage caller actually needs the shared type.

**Pass Criteria**  
Storage returns score context as a first-class part of the current opportunity feed/detail item.

**Verify**  
Run `npm run test:storage`.

## Task 4: Render score context in feed and detail views
**Goal**  
Make score useful to users instead of a floating number with no meaning.

**Files**  
`apps/web/src/components/opportunity-stream-item.tsx`  
`apps/web/src/components/opportunity-detail-surface.tsx`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Keep the current detail-page score rendering, then add compact reason rendering to both feed and detail surfaces. The feed should carry only a short cue or strongest-signal summary; the detail page can show fuller positives, cautions, or uncertainty. Keep the presentation severe and information-dense, and avoid turning score into decorative SaaS metrics.

**Pass Criteria**  
Users can see the score and understand the strongest positive or negative signals behind it.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Risks And Rollback

- If score factors are still too noisy, expose only grouped reasons first and reduce score prominence.
- If reason codes become source-specific, push that complexity back into normalization.
- If the score creates false confidence, clamp low-evidence cases harder and surface uncertainty instead of adding more heuristics.

## Execution Notes

- The score is a professional viability signal, not a beauty score.
- Keep it evidence-first and procurement-first.
- Build on the existing score owner and current feed/detail contract; do not restart the implementation from zero.
- Design for later bid/no-bid reasoning, but do not jump there in this plan.

## Verification Evidence

- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
