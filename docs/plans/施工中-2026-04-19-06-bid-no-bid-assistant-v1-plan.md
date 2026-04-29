---
title: Bid No Bid Assistant V1 Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
status: 施工中
updated_at: 2026-04-22
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/施工中-2026-04-19-05-qualification-scoring-v1-plan.md
  - docs/research/2026-04-19-ai-era-disruption-and-strategy.md
---

# Bid No Bid Assistant V1 Plan

> Expected Outcome: Opportunity detail pages present a structured decision brief that helps a team judge whether an opportunity deserves pursuit. The repo already has an evidence-first detail surface backed by the storage feed/detail path; this round adds a reusable decision brief contract and dedicated rendering on top of that existing baseline. It does not add external AI providers or user-specific recommendation tuning.

## Current Baseline

- Detail pages already consume `getStoredOpportunityFeedItemBySlug()` and render grouped procurement facts, commercial context, qualification context, and evidence trace.
- The current detail surface already answers part of the bid/no-bid question, but it does so as separate fact groups rather than as one reusable decision brief contract.
- Browse items remain scan-oriented and should stay lighter than the detail page.

## This Round

### In Scope

- create a deterministic decision-brief contract on the existing storage detail path
- expose bid/no-bid input facts and score reasons through storage-owned helpers
- render a concise dedicated decision brief on the opportunity detail surface
- add at most one compact browse cue if density allows

### Out Of Scope

- LLM integration
- automatic yes/no final decision
- personalized team strategy weighting
- dashboard workflow state

## Success Criteria

- detail pages answer relevance, qualification fit, evidence confidence, and implementation path in one section
- every statement in the brief can be traced to normalized facts
- uncertainty is visible when evidence is incomplete
- the feature works without introducing a second decision logic layer in the UI

## Execution Order

## Task 1: Define the decision brief contract
**Goal**  
Create one storage-facing contract that later UI and AI features can reuse.

**Files**  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`

**Execute**  
Add a structured bid/no-bid brief shape that includes strengths, cautions, evidence status, and implementation-path notes. Build on the current storage-owned detail path instead of inventing a second decision contract at the route or component layer, so the UI reads one object rather than assembling logic from many fields. Only push the type into `packages/core` if another shared non-storage consumer genuinely needs it.

**Pass Criteria**  
The decision brief exists as a reusable contract, not as component-local formatting logic.

**Verify**  
Run `npm run test:storage`.

## Task 2: Build a storage helper that assembles the brief from normalized facts
**Goal**  
Turn normalized fields and score reasons into a concise decision-ready summary.

**Files**  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`

**Execute**  
Create a helper that derives strengths, cautions, missing-evidence flags, and implementation-route notes from the current storage-owned opportunity detail/feed item. Reuse the score reasons from plan 05 when available, and fall back to fact-grouped statements tied to explicit fields such as evidence level, qualification score, eligibility summary, official notice identity, commercial signal, and current unknown states from normalization. Do not create a second scoring or inference layer in the page component.

**Pass Criteria**  
The brief is assembled in one place and avoids unsupported narrative claims.

**Verify**  
Run `npm run test:storage`.

## Task 3: Render the brief in the detail page with bilingual UI copy
**Goal**  
Make the decision brief visible and easy to scan in the opportunity detail surface.

**Files**  
`apps/web/src/components/opportunity-detail-surface.tsx`  
`apps/web/src/components/bid-no-bid-brief.tsx`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Add a dedicated detail-page component for the bid/no-bid brief while preserving the current fact sections underneath it. Keep the tone operational, not salesy. Route all new copy through `dictionaries.ts` and preserve the current severe information-forward surface style.

**Pass Criteria**  
The decision section is visible on detail pages and clearly separates positives, risks, and unresolved items.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Task 4: Keep feed surfaces aligned without duplicating the full brief
**Goal**  
Expose just enough decision context in browse views to guide triage without overcrowding the feed.

**Files**  
`apps/web/src/components/opportunity-stream-item.tsx`  
`apps/web/src/components/opportunity-detail-surface.tsx`

**Execute**  
Add at most one compact decision cue in the feed view that links naturally to the full detail brief. Do not copy the entire brief into the browse list, and keep the current image-led browse rhythm intact if the new cue proves too dense.

**Pass Criteria**  
Browse and detail surfaces feel connected, but only the detail page owns the full decision brief.

**Verify**  
Run `npm run lint:web` and manual browser review on port `3400`.

## Risks And Rollback

- If the brief reads as overconfident, reduce it to fact-grouped bullets and visible unknowns.
- If the feed becomes too dense, keep decision cues detail-only for v1.
- If deterministic logic feels too weak, keep the contract and postpone AI assistance until the facts layer is stronger.

## Execution Notes

- This is a decision-support surface, not a decision-automation system.
- Every sentence must be grounded by canonical fields.
- Unknown facts must remain explicit.
- Build on the current detail surface instead of treating the feature as a greenfield rewrite.

## Verification Evidence

- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
