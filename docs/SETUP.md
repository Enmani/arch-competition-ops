# Setup

## Requirements

- Python 3.12+
- `uv`
- Node.js 20+
- `npm`

## Bootstrap

```bash
uv sync
npm install
uv run arch-competition-ops doctor
uv run arch-competition-ops init-db
uv run arch-competition-ops seed-demo
```

## Run the Website

```bash
npm run dev:web:up
```

The Next.js site runs on `http://localhost:3400` by default to avoid conflict with local stacks already using `3000` or `3001`.
If Windows blocks port `3400` because it sits inside an excluded TCP range, `npm run dev:web:up` will now fail fast with an explicit diagnostic instead of a generic unhealthy-server warning.

## Ingest Official TED Notices

```bash
uv run arch-competition-ops ingest-source --source-id ted_design_notices --limit 20
```

## Optional

Install browser support later if you add dynamic-site scanning:

```bash
uv sync --extra browser
uv run playwright install chromium
```
