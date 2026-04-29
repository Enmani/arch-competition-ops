---
title: Doc Governance Workflow
status: done
updated_at: 2026-04-21
related_docs:
  - docs/ai/doc-governance-standard.md
  - docs/AGENTS.md
  - docs/changelog/README.md
  - docs/roadmaps/README.md
  - docs/plans/README.md
---

# Doc Governance Workflow

## Purpose

Keep doc work closed-loop, low-friction, and automation-friendly.

## Use When

- touching `docs/roadmaps/**`
- touching `docs/goals/**`
- touching `docs/structures/**`
- touching `docs/plans/**`
- touching `docs/research/**`
- touching `docs/changelog/**`
- moving or renaming governed docs
- normalizing frontmatter on touched docs

## Workflow

1. Read `docs/ai/doc-governance-standard.md`
2. Route the work to the right folder
3. Prefer editing the current canonical doc
4. Normalize the touched doc if needed
5. If the round leaves durable trace, sync `docs/changelog/CHANGELOG_YYYY-MM-DD.md`
6. Run doc scan
7. Run encoding scan
8. If meaning changed, sync the nearest upstream or downstream doc in the same round

## Commands

```bash
npm run check:doc-governance
npm run check:doc-governance:file -- --file docs/goals/example.md
npm run check:doc-governance:file -- --file docs/changelog/CHANGELOG_2026-04-21.md
npm run check:encoding:all
npm run doc:normalize -- --file docs/research/example.md
```

## Routing Reminder

- roadmap = high-level track view
- goal = stable product intent for a capability
- structure = canonical architecture truth
- plan = detailed execution
- research = evidence sidecar
- changelog = dated closeout trace, never the source of canonical truth
