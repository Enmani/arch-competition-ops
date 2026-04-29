from arch_competition_ops.normalizers import build_competition_key


def test_build_competition_key_is_stable() -> None:
    key = build_competition_key(
        "Adaptive Reuse Waterfront Pavilion",
        "TerraViva Competitions",
        "2026-06-30",
    )

    assert key == "adaptive-reuse-waterfront-pavilion__terraviva-competitions__2026-06-30"
