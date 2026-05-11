from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from arch_competition_ops.settings import Settings


@dataclass
class CardPreviewPrewarmResult:
    attempted: int
    generated: int
    skipped: int


def _build_prewarm_script(repo_root: Path, slugs: list[str]) -> str:
    payload = json.dumps(slugs, ensure_ascii=True)
    repo_root_literal = json.dumps(str(repo_root))

    return f"""
import {{ pathToFileURL }} from 'node:url';

const repoRoot = {repo_root_literal};
const slugs = {payload};
const repoRootUrl = pathToFileURL(repoRoot.endsWith('\\\\') || repoRoot.endsWith('/') ? repoRoot : `${{repoRoot}}/`);

const storageModule = await import(new URL('./packages/storage/src/index.ts', repoRootUrl));
const satelliteModuleRaw = await import(new URL('./apps/web/src/lib/opportunity-satellite-preview.ts', repoRootUrl));
const cardImageModuleRaw = await import(new URL('./apps/web/src/lib/opportunity-card-image.ts', repoRootUrl));

const satelliteModule = satelliteModuleRaw.default ?? satelliteModuleRaw['module.exports'] ?? satelliteModuleRaw;
const cardImageModule = cardImageModuleRaw.default ?? cardImageModuleRaw['module.exports'] ?? cardImageModuleRaw;

let generated = 0;
let skipped = 0;

for (const slug of slugs) {{
  const opportunity = storageModule.getStoredOpportunityFeedItemBySlug(slug);
  if (!opportunity) {{
    skipped += 1;
    continue;
  }}

  try {{
    if (satelliteModule.isStadtZurichOpportunitySource(opportunity)) {{
      const officialImage = await cardImageModule.resolveOpportunityCardImageUrl(opportunity);
      if (officialImage) {{
        generated += 1;
        continue;
      }}
    }}

    const satellitePreview = await satelliteModule.resolveOpportunitySatellitePreview(opportunity);
    if (satellitePreview) {{
      generated += 1;
      continue;
    }}

    skipped += 1;
  }} catch {{
    skipped += 1;
  }}
}}

console.log(JSON.stringify({{ attempted: slugs.length, generated, skipped }}));
""".strip()


def prewarm_opportunity_card_previews(
    settings: Settings,
    *,
    competition_ids: list[str],
) -> CardPreviewPrewarmResult:
    if not settings.card_preview_prewarm_enabled:
        return CardPreviewPrewarmResult(attempted=0, generated=0, skipped=0)

    unique_ids = [competition_id for competition_id in dict.fromkeys(competition_ids) if competition_id]
    if not unique_ids:
        return CardPreviewPrewarmResult(attempted=0, generated=0, skipped=0)

    if not (settings.root / "apps" / "web").exists():
        return CardPreviewPrewarmResult(attempted=0, generated=0, skipped=0)
    if not (settings.root / "packages" / "storage").exists():
        return CardPreviewPrewarmResult(attempted=0, generated=0, skipped=0)
    if not (settings.root / "node_modules" / "tsx").exists():
        return CardPreviewPrewarmResult(attempted=0, generated=0, skipped=0)

    script = _build_prewarm_script(settings.root, unique_ids)
    process = subprocess.run(
        ["node", "--import", "tsx", "-e", script],
        capture_output=True,
        cwd=settings.root,
        text=True,
        timeout=180,
        check=False,
    )

    if process.returncode != 0:
        return CardPreviewPrewarmResult(
            attempted=len(unique_ids),
            generated=0,
            skipped=len(unique_ids),
        )

    try:
        payload = json.loads(process.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        return CardPreviewPrewarmResult(
            attempted=len(unique_ids),
            generated=0,
            skipped=len(unique_ids),
        )

    attempted = int(payload.get("attempted", len(unique_ids)))
    generated = int(payload.get("generated", 0))
    skipped = int(payload.get("skipped", max(0, attempted - generated)))
    return CardPreviewPrewarmResult(
        attempted=attempted,
        generated=generated,
        skipped=skipped,
    )
