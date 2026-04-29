# Findings

- Current `simap` collector originally used only `project-header`; this lost official follow-up links and prize information.
- `simap` `publication-details` improves the source URL and sometimes exposes an external platform URL, but for the Herbstweg case it still does not expose the Stadt Zürich page or the CHF 220'000 prize total.
- Canonical storage already supports `official_url`, `source_url`, `prize_summary`, and `evidence_note`, so the main gap is enrichment before upsert, not schema.
- The new verifier hook belongs between `parse_source_payload()` and `upsert_competition()`, so enrichment can use the parsed record plus raw payload context without changing the storage schema.
- For Zürich, sitemap-based discovery on `www.stadt-zuerich.ch` reliably exposes the official page URL `.../wohnsiedlung-herbstweg.html`.
- The provided official page currently exposes `Preisgeld CHF 167 000 exkl. MWST`; the live `simap` detail JSON does not expose that value.
