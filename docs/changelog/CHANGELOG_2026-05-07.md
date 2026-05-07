---
title: Changelog 2026-05-07
status: 已完成
updated_at: 2026-05-07
related_docs:
  - CLOUDFLARE_DEPLOY_RUNBOOK.md
---

# Changelog 2026-05-07

## ANAC Source Trace Normalization

### Changed

- Added a dedicated `normalize-anac-source-traces` worker CLI command to rewrite legacy ANAC machine API links into public ANAC detail pages.
- Added a dedicated `normalize-anac-record-statuses` worker CLI command to mark archived ANAC result notices as archived records instead of active discoveries.
- Added storage helpers for listing legacy ANAC source-trace candidates and updating stored `source_url` values without changing canonical `official_url`.
- Added storage helpers for listing ANAC status candidates and updating stored canonical `status` values during historical backfills.
- Tightened ANAC backfill targeting so the normalization pass only touches records that still expose non-public or missing source trace links.
- Updated the ANAC extractor so `AD*` / `esiti` / `aggiudicazione` notices normalize to `archived` status on ingest.
- Updated the storage read model so `archived` records are hidden from the default opportunity feed while remaining queryable when `includeExpired=true`.
- Added regression tests covering collector output, CLI backfill behavior, and storage candidate filtering for both `/bandi/` and `/esiti/` ANAC routes.

### Why

- Users should land on human-readable ANAC notice pages instead of raw JSON endpoints when opening source trace links.
- Legacy ANAC records needed a safe bulk repair path that preserves provenance while preventing the same issue from reappearing in new ingests.
- Archived ANAC result notices should not remain visible as active procurement opportunities once the official source has already moved them into `Esiti`.

### Validation

- `uv run arch-competition-ops normalize-anac-source-traces --limit 1000`
- `uv run arch-competition-ops normalize-anac-record-statuses --limit 1000`
- `uv run pytest apps/worker/tests/test_collectors.py -k "anac or normalize_anac_source_traces" -q`
- `uv run pytest apps/worker/tests/test_storage.py -k anac -q`

### Modified Files

- `apps/worker/src/arch_competition_ops/cli.py`
- `apps/worker/src/arch_competition_ops/operations.py`
- `apps/worker/src/arch_competition_ops/storage/__init__.py`
- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/src/arch_competition_ops/extractors/anac.py`
- `apps/worker/src/arch_competition_ops/extractors/common.py`
- `apps/worker/tests/test_extractors.py`
- `apps/worker/tests/test_collectors.py`
- `apps/worker/tests/test_storage.py`
- `packages/storage/src/index.ts`
- `packages/storage/src/cloudflare.ts`
- `packages/storage/src/index.test.ts`
- `docs/changelog/CHANGELOG_2026-05-07.md`

## GETS Preannouncement Filtering

### Changed

- Updated the shared RSS collector to exclude official feed entries that are clearly preannouncement notices rather than live tenders.
- Added a dedicated `normalize-gets-preannouncement-statuses` worker CLI command to mark legacy GETS advance notices as `discarded`.
- Added storage helpers for listing active GETS records that still need preannouncement review.
- Added regression tests covering both collector-time exclusion and historical backfill behavior for GETS advance notices.

### Why

- The audit did not find another non-ANAC source that was clearly surfacing completed or archived notices as active opportunities.
- It did find a neighboring issue in GETS: some `Advance Notice` / `Notice of Information` entries were being shown like live opportunities even when the official text explicitly said the tender had not started yet.
- Those entries should not remain in the default active feed because they are not yet actionable bid opportunities.

### Validation

- `uv run pytest apps/worker/tests/test_collectors.py -k "generic_rss_documents_excludes_preannouncement_notices or normalize_gets_preannouncement_statuses" -q`
- `uv run pytest apps/worker/tests/test_collectors.py -k "anac or generic_rss or normalize_gets_preannouncement_statuses" -q`
- `uv run arch-competition-ops normalize-gets-preannouncement-statuses --limit 1000`
- `uv run arch-competition-ops doctor`
- `uv run arch-competition-ops verify`

### Modified Files

- `apps/worker/src/arch_competition_ops/cli.py`
- `apps/worker/src/arch_competition_ops/collectors/generic_rss.py`
- `apps/worker/src/arch_competition_ops/operations.py`
- `apps/worker/src/arch_competition_ops/storage/__init__.py`
- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/tests/test_collectors.py`
- `docs/changelog/CHANGELOG_2026-05-07.md`
