---
title: Isolated notice assessment and collection queue
status: done
updated_at: 2026-11-24
---

## Changed

The worker saves discovered notices before reading them. Each paid request uses one notice and the owner's screening requirement. Anthropic Messages (the default), OpenAI Responses and compatible Chat Completions services use the same local decision schema.

## Why

Country, language, value and fee preferences previously affected design judgments. Unread listings could leave the discovery window during outages.

## Validation

Run npm run check and npm run build:web. Provider, pagination, queue recovery and export tests use local fixtures.

## Modified Files

The worker screening, collection and storage modules, daily ingestion workflow, owner requirement, architecture, data contract, setup instructions and Cloudflare runbook describe this change.
