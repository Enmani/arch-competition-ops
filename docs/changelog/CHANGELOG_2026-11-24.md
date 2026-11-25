---
title: Isolated notice assessment and collection queue
status: done
updated_at: 2026-11-24
---

## Changed

The worker saves discovered notices before reading them. Each paid request uses one notice and the owner's screening requirement. Anthropic Messages (the default), OpenAI Responses and compatible Chat Completions services use the same local decision schema.

The review added content-based deduplication, bounded retries and discovery, pre-payment expiry, bilingual titles, link sanitization and queue retention. Repeated exports preserve the catalogue version and avoid writing unchanged records. The [data contract](../DATA_CONTRACT.md) describes queue states and the [runbook](../../CLOUDFLARE_DEPLOY_RUNBOOK.md) gives a D1 cost estimate.

Worker review fixes cover mixed thinking/text responses, restoration of public notice links, transient retry delays, terminal text retention and safe run logs. Reading now groups by source and finishes the original queue row. Broken or repeated pages are reported and restarted.

Screening answer version 3 generates its field instructions, schema descriptions and permitted labels from the same table used in extraction. Citations are attributed in code. Original listing titles survive missing model claims, and a quoted local deadline can include a time. Stored decisions keep their public format. HTML fingerprints follow visible document structure. Providers share bounded retries and classify billing errors by status or error type.

## Why

Country, language, value and fee preferences previously affected design judgments. Unread listings could leave the discovery window during outages.

## Validation

Run npm run check and npm run build:web. Provider, pagination, queue recovery and export tests use local fixtures.

## Modified Files

The worker screening, collection and storage modules, daily ingestion workflow, owner requirement, architecture, data contract, setup instructions and Cloudflare runbook describe this change.
