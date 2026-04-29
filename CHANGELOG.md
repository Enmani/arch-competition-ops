# Changelog

## 2026-04-20

### Added

- Added scheduled batch ingestion support for Windows with two default batches:
  - `official_daytime` for enabled `official_procurement` sources
  - `secondary_nightly` for enabled `authority_portal` and `aggregator` sources
- Added batch automation config in `config/automation.yml`.
- Added Python batch runner in `apps/worker/src/arch_competition_ops/automation.py`.
- Added CLI-style batch entrypoint in `apps/worker/scripts/ingest_batch.py`.
- Added Windows task runner and scheduler scripts:
  - `scripts/run-ingest-batch.ps1`
  - `scripts/register-auto-ingest-tasks.ps1`
- Added npm shortcuts for manual batch runs and scheduled task install/remove/status.

### Changed

- Updated `README.md` with Windows auto-ingest commands, default schedules, and log location.
- Registered default scheduled tasks for the current Windows user:
  - `arch-competition-ops-official_daytime-0630`
  - `arch-competition-ops-official_daytime-1430`
  - `arch-competition-ops-secondary_nightly-0230`

### Fixed

- Tightened `simap` secondary verification so an authority page only replaces `official_url` when it adds material procurement evidence such as prize information or a PDF link.
- Prevented false authority-page upgrades like the Zurich `Schulanlage Leimbach` project page from overriding a valid live procurement entry.
- Re-ingested recent `simap` data so the affected `Leimbach` record now keeps the correct `konkurado/simap` entry path instead of the unrelated completed-project page.
