# Scan Mode

Goal: discover candidate professional design opportunities from enabled sources.

Workflow:

1. read `config/sources.yml`
2. skip disabled sources
3. collect candidate notice URLs and lightweight metadata
4. retain raw fetches under `artifacts/`
5. send normalized records to the storage layer with status `discovered`

Prefer official procurement portals and authority pages. Do not summarize full dossiers in this mode.
