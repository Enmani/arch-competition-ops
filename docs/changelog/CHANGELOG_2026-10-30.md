---
title: AI opportunity extraction and permissive screening
status: done
updated_at: 2026-10-30
related_docs:
  - docs/ARCHITECTURE.md
  - docs/DATA_CONTRACT.md
  - docs/SETUP.md
---

# 2026-10-30

## OpenAI extraction and screening

### Changed

- Added official OpenAI SDK integration, Luna/high extraction, bilingual recommendations, grounded field validation and existing-taxonomy classification.
- Added Luna Decisions API candidate triage with keep/exclude/uncertain choices, wider candidate retrieval, editable prose preferences, and configurable TED search scope.
- AI mode bypasses client-side relevance/negative-keyword gates. Missing optional fields remain valid candidates; unsupported claims are omitted or marked for review.
- Added local exact-input caching, conservative daily/monthly cost limits, sanitized failures, atomic source/result publication and D1 export of advice only.
- Current AI exclusions affect discover queries without overwriting canonical facts, human statuses or watchlist/detail access.

### Why

Reduce source-specific filtering and extraction changes while retaining uncertain professional opportunities and preserving source evidence.

### Validation

- Focused AI extraction, triage and ingestion checks passed.
- Real OpenAI calls: 15 public TED/BOAMP/CNAPPC notices; a final choice triage retained 9 and excluded 6. Detailed results and limits are in [comparison report](../../reports/2026-10-30-ai-screening-comparison.md).
- Local workerd/D1: all migrations applied; the running query returned one visible record after seeding one included and one AI-excluded record.
- Production web build passed in the shared workspace. An initial isolated build was blocked fetching Google Fonts; the actual shared-workspace build completed.
- Final `npm run check` passed in the shared workspace, including the worker, storage, web, preview, export, docs and Windows-script checks. One excluded-port test was skipped because the port is not excluded on this machine.
- The real ingestion CLI completed three public HTML pages in an isolated database with zero document failures; model judgment varied on the completed-work award, as recorded in the report.

### Modified Files

- `.env.example`, `pyproject.toml`, `uv.lock`, `config/ai-screening.md`
- `apps/worker/src/arch_competition_ops/screening/*`, `storage/screening.py`, `storage/schema.py`, `settings.py`, `models/source.py`, `ingest.py`, `cli.py`
- `apps/worker/src/arch_competition_ops/collectors/*`, including the generic notice-page collector
- `apps/web/migrations/0006_ai_screening.sql`, `packages/storage/src/opportunities/query.ts`
- `scripts/lib/d1-sync/table-specs.mjs`, worker/storage/export tests
- `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`, `docs/SETUP.md`, `apps/worker/README.md`

## Multi-country screening and portable judgment skill

### Changed

- Replaced the prose preference file with `config/skills/screen-architecture-opportunities/SKILL.md`, using three shared judgments: advertised deliverable, current participation and meaningful uncertainty.
- Both AI stages load the same skill. The Python wheel bundles its repository source for backend deployments; missing custom instructions fail visibly.
- Expanded European country/language priorities and vocabulary, with matching Chinese/English country names.
- TED inputs now put notice type, description, place of performance and separate tender/request deadlines before repeated multilingual metadata.
- Corrected setup wording: unsupported individual fields are omitted and unsupported decision quotations cause review, rather than failing the whole record.

### Why

Improve filtering through general decision criteria while preserving possible architecture opportunities and avoiding portal-specific semantic exceptions.

### Validation

- Compared four prompt conditions on 64 real TED notices from eight European places of performance. The selected skill retained all 18 clear targets and all eight borderline candidates; clear negative exclusions increased from 22/38 to 32/38 versus the prior AI preferences.
- On the 32-record validation group, the selected skill retained 12/12 clear targets and 2/2 borderline candidates, excluding 15/18 clear negatives versus 12/18 previously. Results matched the longer enumerated prompt on these metrics.
- Source-based self-adjudication was performed by the prompt maintainer, so this was not an independent blind test. One initial development label was corrected from the full source for every condition. Evidence, remaining false positives and all variants are in the [comparison report](../../reports/2026-10-30-multicountry-screening.md).
- Skill Creator format validation passed. The actual wheel loaded the evaluated skill from an empty deployment directory without repository configuration.
- `npm run check` and `npm run build:web` passed. The final prompt was additionally exercised through real API calls and the packaged-resource smoke test.

### Modified Files

- `AGENTS.md`, `.env.example`, `pyproject.toml`, `config/filters.yml`, `config/taxonomy.yml`
- `config/skills/screen-architecture-opportunities/*`; removed `config/ai-screening.md`
- Worker settings, TED collector, shared screening instruction loader and its two consumers
- Worker skill/collector tests and test configuration support
- Chinese/English taxonomy dictionaries
- `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`, `docs/SETUP.md`

## Main integration and current frontend

### Changed

- Integrated the latest light, flat UI with AI screening, the collapsible discovery filters, compact opportunity cards and grouped detail facts.
- Updated the design context to follow the current interface, including omission of unknown optional card values while preserving detail evidence.
- Kept the 3400 development launcher hidden and managed by the existing port script.
- Advanced the preview algorithm version to v2 for the new locator appearance, invalidating old card-image URLs.
- Added the screening-table migration prerequisite and published-advice table to the Cloudflare deployment instructions.
- Included the referenced audit and screening reports in version control so documentation links also work after checkout.

### Why

Ship the current interface and screening behavior together on main, using the latest changes as the integration standard.

### Validation

- The integrated changes passed `npm run check` and `npm run build:web` before the main merge.
- Port restart and browser verification use the existing managed 3400 server.

### Modified Files

- Current web styles, discovery/detail components, display helpers, dictionaries and preview placeholders
- `.impeccable.md`, `docs/AI_CONSTRAINTS.md`, `dev-port.ps1`, `CLOUDFLARE_DEPLOY_RUNBOOK.md`
- `reports/2026-10-21-code-audit.md`, `reports/2026-10-30-ai-screening-comparison.md`, `reports/2026-10-30-multicountry-screening.md`

## All-source AI entry and participation excerpts

### Changed

- Removed remaining source-specific semantic rejection gates in AI mode, including China listing types/keywords and Dutch, Spanish, Swiss and municipal candidate checks.
- Consolidated matching criteria into the shared skill; legacy keyword bonuses now apply only in rule mode.
- Added the registry-driven `all_enabled` batch and explicit collected, excluded and deferred counts; budget deferrals do not masquerade as content rejection.
- Extracted original participation clauses in the same request and exposed validated, current-revision excerpts on localized detail pages. Added source-backed country, notice id and language extraction.
- Raised output headroom to 12,288 tokens; normal limits remain USD 1 per UTC day and USD 31 per month.
- Initialized the procedure registry at the ingestion boundary and bounded concurrent AI source work to three, retaining transactional shared-budget checks.
- Preserved Chinese place names and long addresses; added source-backed place components, coarser geocoding fallbacks and a map link with precision labels.
- Removed adapter-generated design classifications from model evidence after a real supply notice was retained because its injected label contradicted the source scope; collection URLs no longer qualify as project websites.
- Preserved raw API records/notice HTML, handled the current Italian `templates` envelope and capped Dutch page sizes at the API's observed maximum of 100.
- Added context-matched map lookups and v2 cache keys after an actual homonym mapped to another city. Geocode refreshes preserve current advice without reviving stale advice.

### Why

Let the model read unfamiliar notices before making a topical judgment, while preserving source evidence and the user's current interface.

### Validation

- Focused worker tests cover broad China/Dutch intake, source-backed clauses and existing screening/batch behavior.
- Storage tests verify excerpt validation and stale-revision suppression.
- Worker tests verify concurrent reservations cannot exceed the daily ceiling, sources overlap under one batch lock, and Chinese/city fallback geocoding preserves the source address.
- Live all-source execution and complete repository checks are recorded at closeout.

### Modified Files

- Worker collectors, ingestion, automation, screening and settings; focused worker tests
- `config/automation.yml`, China source pack and the shared screening skill
- Core excerpt schema, storage detail read model/tests and localized detail component/copy
- `.env.example`, `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`
