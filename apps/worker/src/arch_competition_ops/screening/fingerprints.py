"""Identity of one notice version and its assessment contract."""

import hashlib

from arch_competition_ops.screening.models import ScreeningDecision, canonical_json
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.screening.source_evidence import notice_evidence
from arch_competition_ops.settings import Settings


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def notice_content_hash(payload: str, url: str) -> str:
    return digest(canonical_json([url, notice_evidence(payload)]))


def screening_criteria_hash(settings: Settings) -> str:
    return digest(
        canonical_json(
            [
                load_screening_instructions(settings),
                ScreeningDecision.model_json_schema(),
                "responses",
                settings.ai_model,
                settings.ai_reasoning_effort,
                settings.ai_max_input_chars,
            ]
        )
    )
