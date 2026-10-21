# Worker App

Python worker for source ingestion, normalization, verification, and storage.

Run from the repository root (every command is a subcommand of `arch-competition-ops`; there are no
separate scripts):

```bash
uv run arch-competition-ops doctor
uv run arch-competition-ops verify
uv run arch-competition-ops show-sources
uv run arch-competition-ops show-country-coverage
uv run arch-competition-ops ingest-source --source-id ted_design_notices --limit 20
uv run arch-competition-ops ingest-batch --batch-id official_daytime     # or --list-batches
uv run arch-competition-ops ingest-lock-status
uv run arch-competition-ops cleanup-expired-competitions                 # at most once per day
uv run arch-competition-ops seed-demo                                    # empty database only
```

## Exit codes

| code | meaning |
|------|---------|
| 0 | success |
| 1 | the run failed or finished with failures (network error, skipped documents, failed checks) |
| 2 | usage or configuration error (unknown/disabled source, invalid config, demo seed refused) |
| 75 | another batch holds the ingest lock; retry later (`ingest-lock-status` returns it too) |

Errors are printed as `error: ...` without a traceback; add `-v` for progress logging on stderr.

## Environment

- `ARCH_COMPETITION_OPS_DB` - database path (the only variable for it).
- `ARCH_COMPETITION_TODAY` - `YYYY-MM-DD`; replays a run as if it happened on that day.
- `ARCH_PREVIEW_PREWARM` - `1` runs the offline preview generator
  (`packages/previews/bin/prewarm.mjs --db <db> --only-from-stdin`, no shell) after an ingest, with
  `{"competitionIds": [...]}` on stdin; off means "skipped", a failure only warns. `ARCH_PREVIEW_NODE`
  picks the Node executable and `ARCH_PREVIEWS_DIR` the output directory (default `artifacts/previews`).
- Other `ARCH_COMPETITION_OPS_*` variables map to `Settings` fields.

## Layout

- `collectors/` fetch source documents; one module per upstream shape, registered by family in
  `collectors/registry.py` (`collector:` in YAML). `collectors/ggzy/` keeps its keyword data in
  `markers.json`.
- `extractors/` turn a document into a `CompetitionRecord` using only evidence in the notice.
- `normalizers/` dates, money, text, identity keys, and the evidence-based confidence formula.
- `http/` the one HTTP client (retries for GET, per-host rate limit, size cap, SSRF guards,
  charset detection, optional raw-response archive under `artifacts/html`).
- `storage/` SQLite: `schema.py` (mirror of `apps/web/migrations`), `competitions.py` (field-level
  merge upsert), `runs.py`, `review.py`.
- `postprocess/` per-source maintenance tasks registered by `source_id` (ANAC, GETS).
- `ingest.py`, `maintenance.py`, `diagnostics.py`, `demo.py` the command implementations.
- `locking.py` cross-process lock for ingest batches.

Record ids are `{title slug}__{source_id}__{notice id or sha1(source_url)[:10]}`; the deadline is
not part of the id. `organizer` is the buyer (empty when unknown); the platform is `source_name`.
