---
title: Isolated notice assessment and collection queue
status: done
updated_at: 2026-11-24
---

## Changed

The worker saves discovered notices before reading them. Each paid request uses one notice and the owner's screening requirement. Anthropic Messages (the default), OpenAI Responses and compatible Chat Completions services use the same local decision schema.

The review added content-based deduplication, bounded retries and discovery, pre-payment expiry, bilingual titles, link sanitization and queue retention. Repeated exports preserve the catalogue version and avoid writing unchanged records. The [data contract](../DATA_CONTRACT.md) describes queue states and the [runbook](../../CLOUDFLARE_DEPLOY_RUNBOOK.md) gives a D1 cost estimate.

Worker review fixes cover mixed thinking/text responses, restoration of public notice links, transient retry delays, terminal text retention and safe run logs. Reading now groups by source and finishes the original queue row. Broken or repeated pages are reported and restarted.

Screening answer version 6 generates its field instructions, schema descriptions and permitted labels from the same table used in extraction. Structured notices retain source field order, short scalars and clipped text. Readability is assessed on the rendered body. Ten source-shape fixtures cover both archived and live inputs. A required title quote is resolved independently of optional facts. New exclusions complete without building a record. Verbatim fields request only the quote and take their value from its matched source characters. Empty notice bodies are refetched before payment and reported separately. BOAMP resolves missing links from the public notice ID. Citations are attributed in code. Original listing titles survive missing model claims, and a quoted local deadline can include a time. Stored decisions keep their public format. HTML fingerprints follow visible document structure. Providers share bounded retries and classify billing errors by status or error type.

## Why

Country, language, value and fee preferences previously affected design judgments. Unread listings could leave the discovery window during outages.

## Validation

Run npm run check and npm run build:web. Provider, pagination, queue recovery and export tests use local fixtures.

### Notice body size, offline comparison

These ten fixtures reconstruct shapes found in the archived requests. Characters count the body alone. Tokens use a local Llama 3 tokenizer on the same body, without the schema or system prompt. The JSON column uses the original source field order with unescaped Unicode. A zero in v5 means the readability check prevented a request.

| Source fixture | JSON chars | v5 chars | v6 chars | JSON tokens | v5 tokens | v6 tokens |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| CanadaBuys | 261 | 39 | 210 | 79 | 6 | 59 |
| Frankfurt | 353 | 33 | 239 | 122 | 9 | 79 |
| BOAMP | 301 | 0 | 320 | 108 | 0 | 103 |
| ANAC | 240 | 30 | 201 | 84 | 8 | 68 |
| ggzy | 256 | 35 | 144 | 97 | 16 | 60 |
| World Bank | 233 | 0 | 186 | 76 | 0 | 58 |
| PCSP | 261 | 25 | 220 | 89 | 6 | 78 |
| SIMAP | 262 | 0 | 250 | 92 | 0 | 73 |
| TED | 236 | 0 | 197 | 76 | 0 | 60 |
| Doffin | 273 | 25 | 222 | 100 | 8 | 82 |
| Total | 2676 | 187 | 2189 | 923 | 53 | 720 |

Including title, URL, links and field headings, these ten user messages totaled 238 proxy tokens with v5 and 1049 with v6. Restoring the missing material increases the request size relative to v5. Actual Haiku billing and extraction quality require a model replay.

Separately, 299 archived inputs were checked through the request builder without calling a provider. Of 191 reference deadlines that appeared verbatim in the saved text, 34 reached the v5 body and all 191 reached v6. The 23,652-character Frankfurt record contained 17,339 characters of detail HTML plus appended detail. Its rendered body grew from 93 to 21,657 characters. The 501-character CanadaBuys record grew from 39 to 285.

## Modified Files

The worker screening, collection and storage modules, daily ingestion workflow, owner requirement, architecture, data contract, setup instructions and Cloudflare runbook describe this change.
