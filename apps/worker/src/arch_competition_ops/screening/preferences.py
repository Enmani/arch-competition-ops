"""One versioned screening skill, available in checkouts and packaged backend deployments."""

from importlib import resources

from arch_competition_ops.settings import DEFAULT_AI_SKILL, Settings


def load_screening_instructions(settings: Settings) -> str:
    path = settings.resolve_path(settings.ai_preferences)
    if path.is_file():
        text = path.read_text(encoding="utf-8")
    elif settings.ai_preferences == DEFAULT_AI_SKILL:
        # Generated from the same repository skill by the wheel builder; never maintained twice.
        bundled = resources.files("arch_competition_ops").joinpath(
            "_bundled", "screen-architecture-opportunities", "SKILL.md"
        )
        if not bundled.is_file():
            raise FileNotFoundError(
                "Screening skill is missing from the checkout and backend package"
            )
        text = bundled.read_text(encoding="utf-8")
    else:
        raise FileNotFoundError(f"Configured screening instructions not found: {path}")
    if not text.strip():
        raise ValueError("Screening instructions must not be empty")
    return text
