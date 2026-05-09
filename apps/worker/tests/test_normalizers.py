from arch_competition_ops.normalizers import build_competition_key


def test_build_competition_key_is_stable() -> None:
    key = build_competition_key(
        "Adaptive Reuse Waterfront Pavilion",
        "TerraViva Competitions",
        "2026-06-30",
    )

    assert key == "adaptive-reuse-waterfront-pavilion__terraviva-competitions__2026-06-30"


def test_build_competition_key_preserves_chinese_text() -> None:
    key = build_competition_key(
        "遂川县恒福庄园片区2026年老旧小区改造项目设计服务",
        "National Public Resources Trading Platform",
        "2026-05-21",
    )

    assert (
        key
        == "遂川县恒福庄园片区2026年老旧小区改造项目设计服务__national-public-resources-trading-platform__2026-05-21"
    )
