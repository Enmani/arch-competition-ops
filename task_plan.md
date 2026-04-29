# Task Plan

## Goal
Add an official secondary verification mechanism that can enrich canonical records from authoritative follow-up pages when the primary procurement source lacks accurate official links or prize details.

## Phases
- [completed] Inspect current worker ingestion, normalization, and storage flow for the best insertion point.
- [completed] Write failing tests for the expected secondary-verification behavior.
- [completed] Implement the verification/enrichment stage with minimal schema-safe changes.
- [completed] Re-run targeted ingestion for the affected source and verify stored output.
- [completed] Run repository verification commands relevant to the touched surfaces.

## Constraints
- Preserve both `official_url` and `source_url`.
- Prefer official follow-up pages over aggregator-style landing pages when evidence is explicit.
- Keep missing fields empty when verification cannot prove them.
- Reuse existing worker/storage flow instead of adding a parallel pipeline.

## Errors Encountered
- `urllib` TLS verification failed against `stadt-zuerich.ch` robots/sitemap endpoints during live verification.
  Resolution: switch verifier HTTP fetching to `requests` and declare it in `pyproject.toml`.
- Sitemap discovery regex initially missed indented `Sitemap:` lines in `robots.txt`.
  Resolution: allow leading whitespace in the sitemap-line matcher.
- Early page scoring over-weighted description tokens and matched a broader Schwamendingen page instead of the Herbstweg procurement page.
  Resolution: restrict primary matching to title-derived keywords.
