---
title: Incremental full-window screening and wider official coverage
status: done
updated_at: 2026-11-15
related_docs:
  - docs/ARCHITECTURE.md
  - docs/DATA_CONTRACT.md
  - docs/SETUP.md
---

# 2026-11-15

## Screen every in-scope notice once

### Changed

- New `ai_notice_ledger` table (migration `0008`): a notice is keyed by source, a hash of its visible listed evidence and a hash of the screening criteria. Unchanged notices are not triaged, fetched or assessed again; a corrigendum or a criteria change is. Triage exclusions and finished assessments are recorded only after they are durably known.
- Collection reads the whole publication window (`ai_candidate_cap`, default 2000) instead of five times the extraction limit capped at 100; triage runs in batches of 100 instead of cutting the list. `automation.yml` raises `limit_per_source` to 100.
- Today's date is sent with each AI request but is no longer part of the cache identity, so a later day reuses an assessment of identical evidence.
- One design scope for every official collector in `collectors/design_scope.py`: open-participation notices with CPV 71*/7993*, design contests, notices without CPV, and design-and-build works notices named as such (conception-réalisation, appalto integrato, totalentreprise, Totalunternehmer, bouwteam, design and build, …).
- TED: open notice types only, full-window iteration paging (page-number paging under a date sort repeated same-day notices), plus a full-text design-and-build pass. BOAMP, ANAC, Doffin, TenderNed, simap and PCSP page through their window with bounded requests and apply the scope, server-side where the API allows it.
- New sources: `de_oeffentlichevergabe_notices` (German national notice data, EU-directive notices skipped as TED duplicates), `uk_find_a_tender_notices`, `world_bank_procurement_notices`. Contracts Finder now links each notice page and reads every page.
- Screening fixes: an exclusion keeps its decision when one of several quotes fails the exact-substring check; PCSP detail pages that show another tender are rejected; BOAMP and CanadaBuys records link their own notice page; notice text precedes links in the model input; the skill names target and non-target commissions explicitly.

### Why

Fixed per-run caps silently sampled the newest notices (TED: 100 of about 1,200 open notices a week, half of the raw stream being awards), and a daily date in the cache key re-paid every still-listed notice. The goal is to read every in-scope notice once.

### Validation

- `npm run check`; worker suite 655 tests; negative controls for the ledger, the cache date, PCSP identity, BOAMP/CanadaBuys URLs and input ordering.
- Live 7-day AI-mode volumes per source and TED pagination completeness (1,188 of 1,188 unique) were measured on 2026-11-15; no paid screening run was made.

### Modified Files

- `apps/web/migrations/0008_ai_notice_ledger.sql`, `apps/worker/src/arch_competition_ops/storage/{schema.py,notice_ledger.py}`
- `apps/worker/src/arch_competition_ops/{ingest.py,settings.py}`, `screening/{fingerprints.py,triage.py,inputs.py,models.py}`
- `apps/worker/src/arch_competition_ops/collectors/*` (new: `design_scope.py`, `oeffentlichevergabe.py`, `find_a_tender.py`, `uk_ocds.py`, `world_bank.py`, `anac_cpv_labels.py`)
- `config/automation.yml`, `config/source_packs/**`, `config/skills/screen-architecture-opportunities/SKILL.md`, `.env.example`
- `docs/ARCHITECTURE.md`, `docs/DATA_CONTRACT.md`, `docs/SETUP.md`
