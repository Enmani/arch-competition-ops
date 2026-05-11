from __future__ import annotations

from pathlib import Path

from arch_competition_ops.card_previews import prewarm_opportunity_card_previews
from arch_competition_ops.settings import Settings


def test_prewarm_opportunity_card_previews_skips_when_frontend_workspace_is_missing(tmp_path) -> None:
    settings = Settings(root=tmp_path)

    result = prewarm_opportunity_card_previews(
        settings,
        competition_ids=["missing-opportunity"],
    )

    assert result.attempted == 0
    assert result.generated == 0
    assert result.skipped == 0


def test_prewarm_opportunity_card_previews_respects_disable_flag(tmp_path) -> None:
    root = tmp_path
    (root / "apps" / "web").mkdir(parents=True)
    (root / "packages" / "storage").mkdir(parents=True)
    (root / "node_modules" / "tsx").mkdir(parents=True)
    settings = Settings(root=root, card_preview_prewarm_enabled=False)

    result = prewarm_opportunity_card_previews(
        settings,
        competition_ids=["disabled-opportunity"],
    )

    assert result.attempted == 0
    assert result.generated == 0
    assert result.skipped == 0
