@AGENTS.md

## Claude Code notes

- The repository rules, sources of truth, ports, i18n contract and verification list are in `AGENTS.md` (imported above). Follow them; this file only adds Claude-specific points.
- Verify with `npm run check` (see Verification in `AGENTS.md`), plus `npm run build:web` after frontend changes.
- Do not commit generated or runtime output: `artifacts/`, `data/competitions.sqlite`, `reports/`, `apps/web/next-env.d.ts`, `apps/web/public/previews/`. If a build or script rewrites a tracked generated file, leave it out of the commit unless that change is the task (no build step rewrites `apps/web/src/lib/opportunity-preview-revision.ts` any more; its value comes from `PREVIEW_ALGORITHM_VERSION`, bumped by hand).
