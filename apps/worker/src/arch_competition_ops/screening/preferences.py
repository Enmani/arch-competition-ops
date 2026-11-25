"""One versioned screening skill, available in checkouts and packaged backend deployments."""

from importlib import resources

from arch_competition_ops.config_loader import load_taxonomy
from arch_competition_ops.screening.field_contract import render_contract
from arch_competition_ops.screening.models import ScreeningAnswer
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
    if text.startswith("---\n"):
        text = text.split("\n---\n", 1)[1].strip()
    if not text.strip():
        raise ValueError("Screening instructions must not be empty")
    return text


def answer_format(settings: Settings) -> tuple[str, dict]:
    contract = render_contract(load_taxonomy(settings))
    schema = ScreeningAnswer.model_json_schema()
    schema["properties"]["extracted_fields"]["description"] = contract
    return f"{load_screening_instructions(settings)}\n\n{contract}", schema
