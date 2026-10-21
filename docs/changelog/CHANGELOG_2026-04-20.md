---
title: Changelog 2026-04-20
status: done
updated_at: 2026-10-21
related_docs:
  - docs/changelog/README.md
  - docs/changelog/CHANGELOG_2026-04-21.md
---

# Changelog 2026-04-20

Moved here on 2026-10-21 from the root `CHANGELOG.md`, which was removed so dated trace lives in one place.

## Scheduled Batch Ingestion And Simap Verification

### Changed

- Added scheduled batch ingestion for Windows with two default batches: `official_daytime` (enabled `official_procurement` sources) and `secondary_nightly` (enabled `authority_portal` and `aggregator` sources). Batches are defined in `config/automation.yml` and run by `apps/worker/src/arch_competition_ops/automation.py`.
- Added the Windows runner and scheduler scripts `scripts/run-ingest-batch.ps1` and `scripts/register-auto-ingest-tasks.ps1`, plus the npm shortcuts `ops:auto-fetch:*`. The original `apps/worker/scripts/ingest_batch.py` wrapper no longer exists; use `uv run arch-competition-ops ingest-batch`.
- Registered the default scheduled tasks for the current Windows user: `arch-competition-ops-official_daytime-0630`, `arch-competition-ops-official_daytime-1430`, `arch-competition-ops-secondary_nightly-0230`.
- Tightened `simap` secondary verification: an authority page replaces `official_url` only when it adds material procurement evidence such as prize information or a PDF link. This stopped the Zurich `Schulanlage Leimbach` record from being replaced by an unrelated completed-project page; recent `simap` data was re-ingested.

### Why

- Ingestion had to run unattended on a schedule, and a weak authority page must not override a valid live procurement entry.

### Validation

- Recorded retroactively; no commands were captured for this round.

### Modified Files

- `config/automation.yml`
- `apps/worker/src/arch_competition_ops/automation.py`
- `scripts/run-ingest-batch.ps1`, `scripts/register-auto-ingest-tasks.ps1`
- `README.md`
