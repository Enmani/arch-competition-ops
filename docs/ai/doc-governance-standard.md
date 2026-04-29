---
title: Doc Governance Standard
status: 已完成
updated_at: 2026-04-21
related_docs:
  - AGENTS.md
  - docs/AGENTS.md
  - docs/changelog/README.md
  - docs/changelog/AGENTS.md
  - docs/roadmaps/README.md
  - docs/plans/README.md
  - docs/skills/doc-governance-workflow.md
---

# Doc Governance Standard

This is the canonical documentation governance standard for this repo.

Keep it light. The goal is not paperwork. The goal is:

- one truth owner per layer
- fast recovery of context
- clean handoff from research to direction to execution
- dated closeout trace without turning plans into diaries
- simple automation for write, normalize, and scan

## Hard Rules

1. Keep one truth owner per layer.
   - `vision.md`: stable product intent
   - `docs/roadmaps/**`: capability-track summary
   - `docs/goals/**`: stable capability intent
   - `docs/structures/**`: canonical architecture and boundaries
   - `docs/plans/**`: detailed execution truth
   - `docs/research/**`: evidence and option analysis sidecar
2. Use the lightest document that fits the job.
3. Do not put roadmaps in `docs/plans/**`.
4. Do not put execution checklists and task slicing in `docs/roadmaps/**` or `docs/goals/**`.
5. Research is a sidecar. If it changes product direction, absorb the result into `vision`, `roadmap`, `goal`, `structure`, or `plan`.
6. Prefer editing the current canonical doc over creating a sibling doc.
7. For governed doc moves, rewrites, or metadata cleanup, use `scripts/doc-governance.mjs`.
8. Keep the workflow bilingual-safe, but do not force machine-translated source facts into canonical records.
9. Use `docs/changelog/**` as the dated closeout trace for meaningful code, doc-governance, or plan-status rounds. It must not become a second source of roadmap, goal, structure, or plan truth.
10. Never let changelog get ahead of canonical docs. If a round changes meaning, ownership, or plan status, update the owning doc in the same round before or alongside the changelog entry.

## Governance Chain

The default chain is:

1. `vision.md`
2. `docs/roadmaps/**`
3. `docs/goals/**`
4. `docs/structures/**`
5. `docs/plans/**`

Supporting sidecars:

- `docs/research/**`
- `docs/changelog/**`

## Folder Roles

| Folder | Owns | Must Not Own |
| --- | --- | --- |
| `docs/roadmaps/**` | product tracks, stage ordering, anchor completeness | detailed tasks, queue truth |
| `docs/goals/**` | who the capability serves, must-haves, non-goals | implementation sequence |
| `docs/structures/**` | module boundaries, shared models, architecture truth | execution slicing |
| `docs/plans/**` | detailed implementation steps, verification, risk/rollback | product thesis, long-term architecture truth |
| `docs/research/**` | evidence, tradeoffs, competitive analysis | canonical direction after adoption |
| `docs/changelog/**` | dated closeout trace, validation notes, modified-file trail | canonical direction, architecture truth, queue truth |

## Minimum Metadata

Touched docs in these governed folders should carry frontmatter:

- `docs/roadmaps/**`
- `docs/goals/**`
- `docs/structures/**`
- `docs/plans/**`
- `docs/research/**`
- `docs/changelog/**`

Minimum fields:

```md
---
title: Example Title
status: 未实施
updated_at: 2026-04-19
---
```

Additional fields only when useful:

- `vision_doc`
- `goal_doc`
- `structure_doc`
- `related_docs`

Opening status convention:

- `未实施`
- `施工中`
- `已完成`

Use these three values as the visible file-opening status for governed docs going forward.

For `docs/plans/**`, the filename should also start with the same status prefix:

- `未实施-...`
- `施工中-...`
- `已完成-...`

The governance script still tolerates legacy English statuses during migration, but new or touched docs should use the Chinese convention above.

## Daily Changelog

Use `docs/changelog/CHANGELOG_YYYY-MM-DD.md` when a round leaves durable trace that future work should recover quickly.

Default cases:

- a meaningful code or product closeout
- a plan status transition that matters to future execution
- a repo-level doc-governance or workflow rule change

Expected section shape:

- round title
- `Changed`
- `Why`
- `Validation`
- `Modified Files`

Rules:

- keep file paths repo-relative
- keep validation commands exact and copy-pastable
- one daily file can contain multiple round sections
- tiny typo-only or metadata-only fixes may skip changelog when no durable trace is helpful

## Closeout Loop

When a doc round finishes:

1. normalize the touched doc if needed
2. update the nearest canonical doc instead of leaving truth only in chat
3. if the round changed durable truth, execution status, or governance behavior, append or update the same-day file in `docs/changelog/`
4. run doc scan on the touched governed docs, including changelog when touched
5. run encoding scan

If the meaning changed, sync the nearest upstream or downstream doc in the same round.

Examples:

- research changed product direction -> update roadmap or goal
- roadmap changed implementation priority -> update plan or create one
- goal changed architectural boundary -> update structure
- executable plan status changed -> update plan first, then changelog
- doc-governance rule changed -> update the standard plus the same-day changelog

## Automation

Use these commands:

```bash
npm run check:doc-governance
npm run check:doc-governance:file -- --file docs/roadmaps/2026-04-19-near-term-product-roadmap.md
npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-21.md
npm run check:encoding:all
npm run doc:normalize -- --file docs/research/example.md
npm run doc:normalize -- --file docs/changelog/CHANGELOG_2026-04-21.md
npm run doc:set-status -- --file docs/plans/未实施-example.md --status 施工中
node scripts/doc-governance.mjs rename --file docs/plans/未实施-example.md --to docs/plans/施工中-example.md
```

## Anti-Bloat Defaults

- do not create a new roadmap for a small fix
- do not create a new plan for a one-line doc correction
- do not add large metadata blocks unless the automation needs them
- do not restate the same truth in roadmap, goal, and plan
- do not treat changelog as a substitute for the owning roadmap, goal, structure, plan, or research doc
- do not write changelog ahead of the canonical doc it describes
- do not let `docs/plans/**` become a dumping ground for roadmaps and notes
