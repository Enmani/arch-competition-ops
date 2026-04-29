# Source Packs

This directory exists to keep country onboarding parallel-safe.

Rules:

- keep `config/sources.yml` as a short manifest of root packs plus a glob for country packs
- put country-specific source definitions in `config/source_packs/countries/{country}.yml`
- let one AI or one person own one country pack per task
- if the source can reuse an existing collector family, declare it with `collector:` in the pack instead of adding another source-id branch
- keep long URL lists, buyer allowlists, and other bulky selectors in `config/source_lists/`
- do not paste large multi-city URL blocks back into `config/sources.yml`

Recommended workflow for adding a country:

1. Copy `_template.country.yml` to `config/source_packs/countries/{country}.yml`
2. Do not touch `config/sources.yml` unless the country-pack glob or root-pack set changes
3. Put long portal lists or authority lists in `config/source_lists/{country}_*.txt`
4. Point the source entry at those files with `url_list_path` or `buyer_allowlist_path`
5. Reuse an existing `collector:` family when possible; only add Python collector work when the upstream shape is genuinely new
6. Add or update config tests in `apps/worker/tests/test_source_catalog.py`
7. Run `uv run pytest apps/worker/tests -q`
8. Run repo verification before claiming completion

This split is intentionally coarse:

- one pack per country
- one list file per concern
- avoid cross-country edits in the same pack
- keep EU-level or global sources in root packs such as `core.yml`
