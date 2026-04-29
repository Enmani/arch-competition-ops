---
title: Verified Submission Intake Plan
vision_doc: vision.md
goal_doc: docs/goals/2026-04-19-future-direction.md
structure_doc: docs/structures/2026-04-22-workspace-follow-up-architecture.md
status: 未实施
updated_at: 2026-04-22
related_docs:
  - docs/roadmaps/2026-04-19-near-term-product-roadmap.md
  - docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md
  - docs/research/2026-04-19-posting-entry-and-product-boundary.md
  - docs/research/2026-04-19-monetization-models-and-government-distribution.md
---

# Verified Submission Intake Plan

> Expected Outcome: Authorities, organizers, or trusted external contributors can submit an official opportunity lead into the system through a controlled intake form that captures evidence and routes every submission into review. This round creates the intake contract, public entry route, and operator handoff. It does not publish submissions directly or open a free-form public posting board.

## Current Baseline

- The ops review queue already exists and already recognizes `origin = submission` plus `reason_code = submission_pending_review`.
- `/[locale]/ops` is already the unified operator review surface; this plan should extend that queue rather than create a second moderation system.
- No submission tables, submission access gate, public submit route, or submission API exist yet.
- Canonical opportunities and review queue state already live in separate tables and should stay separate.

## This Round

### In Scope

- submission intake record and review-state contract
- localized submission form for official opportunity leads
- worker or storage handoff into the ops review queue
- bilingual UI copy and explicit evidence requirements

### Out Of Scope

- direct public publishing
- user-generated opportunity editing in the public feed
- ad marketplace or paid placement
- homeowner or consumer posting flow

### V1 Operating Assumption

- this plan depends on the unified ops review queue from `docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md`
- submission intake stays dark unless `ARCH_ENABLE_VERIFIED_SUBMISSIONS` is enabled
- when enabled, the route is still controlled and invite-only or authority-first until stronger anti-abuse controls exist

## Success Criteria

- an external lead can be submitted with official URLs and supporting evidence
- submissions enter a pending review state instead of the public feed
- operators can trace each submission back to the submitted evidence and intake metadata
- the intake flow reinforces procurement-first boundaries and official-source preference
- when the feature flag is off, no public write path is exposed

## Real Entry Points

- public localized entry route: `apps/web/src/app/[locale]/submit/page.tsx`
- submission API: `apps/web/src/app/api/submissions/route.ts`
- operator review handoff: `apps/web/src/app/[locale]/ops/page.tsx`

## Execution Order

## Task 1: Define the submission record and review handoff contract
**Goal**  
Create one storage-owned submission model that can feed the ops review queue.

**Files**  
`packages/storage/src/submissions.ts`  
`packages/storage/src/index.ts`  
`packages/storage/src/index.test.ts`  
`apps/worker/src/arch_competition_ops/storage/database.py`

**Execute**  
Add a dedicated `submissions.ts` owner file for pending submissions, required official URLs, submitter metadata, and review state. Keep the contract strict about evidence fields so unsupported leads fail fast instead of entering the queue with missing provenance. Persist submissions into shared tables that later worker-side review handoff can read without rebuilding state from web requests, and keep canonical opportunities separate until review accepts them.

**Pass Criteria**  
Submission intake has one truth owner and a clear pending-review state before anything reaches canonical opportunity records.

**Verify**  
Run `npm run test:storage`.

## Task 2: Add the localized submission form and validation path
**Goal**  
Create a public but controlled route for official opportunity leads.

**Files**  
`apps/web/src/app/[locale]/submit/page.tsx`  
`apps/web/src/components/submission-intake-form.tsx`  
`apps/web/src/lib/submission-access.ts`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Build a narrow submission page that asks for official notice URL, source URL when different, organizer identity, geography, and evidence notes. Use `apps/web/src/lib/submission-access.ts` to enforce the env-flag plus a simple invite or access gate, keep the form severe and evidence-led, and reuse the existing site shell and locale routing instead of creating a marketing landing page.

**Pass Criteria**  
Users can open `/[locale]/submit`, understand the evidence bar, and submit a structured lead in either supported locale.

**Verify**  
Run `npm run lint:web` and `npm run build:web`.

## Task 3: Add the submission API and route every intake into review
**Goal**  
Ensure no submission bypasses review or canonical normalization.

**Files**  
`apps/web/src/app/api/submissions/route.ts`  
`apps/worker/src/arch_competition_ops/submissions/review.py`  
`apps/worker/src/arch_competition_ops/operations.py`  
`apps/web/src/lib/submission-access.ts`  
`apps/worker/src/arch_competition_ops/cli.py`

**Execute**  
Create a submission API route that validates required evidence fields, enforces the submission-access gate, and writes pending records through `packages/storage/src/submissions.ts`. Add a worker-side review handoff and explicit CLI or operations entry that reads those shared pending records and converts them into ops queue candidates with the existing `submission` origin and `submission_pending_review` reason code rather than publishing them directly. Do not bypass the ops review queue or rely on the worker calling TypeScript helpers directly.

**Pass Criteria**  
Every accepted form submission enters a visible pending-review path, and none can appear in discover without the later operator or worker approval path.

**Verify**  
Run `uv run arch-competition-ops verify` and `npm run build:web`.

## Rollout Controls

| Flag | Off behavior | On behavior |
| --- | --- | --- |
| `ARCH_ENABLE_VERIFIED_SUBMISSIONS` | `/[locale]/submit` stays unavailable and the submission API rejects writes. | The localized submission route becomes available, but every intake still goes to pending review and none can publish directly into discover. |

## Task 4: Expose submission review context on the ops surface
**Goal**  
Let operators review incoming submissions without building a separate moderation tool.

**Files**  
`apps/web/src/app/[locale]/ops/page.tsx`  
`apps/web/src/components/ops-review-queue.tsx`  
`packages/storage/src/ops-review.ts`  
`apps/web/src/i18n/dictionaries.ts`

**Execute**  
Extend the existing review queue from `docs/plans/已完成-2026-04-19-04-ops-review-queue-plan.md` so submission-origin items show submitter metadata, official-link completeness, and evidence quality. Keep the queue unified rather than splitting submissions into a disconnected admin page.

**Pass Criteria**  
Operators can review incoming submissions inside the existing ops queue and understand why a lead should be accepted, rejected, or sent back for follow-up.

**Verify**  
Run `npm run lint:web`, `npm run build:web`, and manual browser review on port `3400`.

## Risks And Rollback

- If submission quality is low, keep the route invite-only or authority-only behind a simple gate.
- If operators cannot review fast enough, throttle intake before weakening evidence requirements.
- If users misread the flow as instant publishing, sharpen copy and confirmation states before expanding access.

## Execution Notes

- This is a controlled intake path, not a marketplace posting flow.
- `packages/storage/src/submissions.ts` owns intake state; canonical opportunities stay separate until review is complete.
- Reuse the existing ops review queue instead of inventing a second moderation surface.
- All new copy must exist in both `zh` and `en`.

## Verification Evidence

- `uv run arch-competition-ops verify`
- `npm run test:storage`
- `npm run lint:web`
- `npm run build:web`
- `npm run check:doc-governance:file -- --file docs/plans/未实施-2026-04-19-10-verified-submission-intake-plan.md`
