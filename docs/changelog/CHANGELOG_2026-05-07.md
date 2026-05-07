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
- Added storage helpers for listing legacy ANAC source-trace candidates and updating stored `source_url` values without changing canonical `official_url`.
- Tightened ANAC backfill targeting so the normalization pass only touches records that still expose non-public or missing source trace links.
- Added regression tests covering collector output, CLI backfill behavior, and storage candidate filtering for both `/bandi/` and `/esiti/` ANAC routes.

### Why

- Users should land on human-readable ANAC notice pages instead of raw JSON endpoints when opening source trace links.
- Legacy ANAC records needed a safe bulk repair path that preserves provenance while preventing the same issue from reappearing in new ingests.

### Validation

- `uv run arch-competition-ops normalize-anac-source-traces --limit 1000`
- `uv run pytest apps/worker/tests/test_collectors.py -k "anac or normalize_anac_source_traces" -q`
- `uv run pytest apps/worker/tests/test_storage.py -k anac -q`

### Modified Files

- `apps/worker/src/arch_competition_ops/cli.py`
- `apps/worker/src/arch_competition_ops/operations.py`
- `apps/worker/src/arch_competition_ops/storage/__init__.py`
- `apps/worker/src/arch_competition_ops/storage/database.py`
- `apps/worker/tests/test_collectors.py`
- `apps/worker/tests/test_storage.py`
- `docs/changelog/CHANGELOG_2026-05-07.md`
