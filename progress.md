# Progress

- 2026-04-19: Initialized plan files for official secondary verification work.
- 2026-04-19: Confirmed `simap` collector/extractor patch and targeted tests are already in place from the prior debugging step.
- 2026-04-19: Added verifier registry support to source definitions and worker ingestion.
- 2026-04-19: Implemented `simap_official_enricher` with authority-domain sitemap discovery and official-page prize extraction.
- 2026-04-19: Added regression tests for collector payload hints, verifier behavior, and ingest integration.
- 2026-04-19: Ran `uv run pytest apps/worker/tests/test_collectors.py apps/worker/tests/test_extractors.py apps/worker/tests/test_verifiers.py`, `uv run arch-competition-ops doctor`, `uv run arch-competition-ops verify`, `uv lock`, and `uv sync`.
- 2026-04-19: Re-ingested `simap_public_design_notices` and confirmed Herbstweg now resolves to the Stadt Zürich page with extracted prize summary.
