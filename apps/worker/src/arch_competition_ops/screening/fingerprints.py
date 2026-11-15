"""Stable identities for "this notice content" and "these screening criteria".

Together they key the notice ledger: an unchanged notice under unchanged criteria is screened
once, while a corrigendum or any change to the skill, preferences, labels or model is screened
again.
"""

from __future__ import annotations

import hashlib
import re
from typing import Any

from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.models import INSTRUCTIONS, canonical_json
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.screening.source_evidence import notice_evidence
from arch_competition_ops.settings import Settings

# Bump when code-held screening wording changes outside INSTRUCTIONS (the triage question text
# in triage.py), so notices decided under the old wording are screened again.
SCREENING_CODE_VERSION = 1


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def notice_content_hash(payload: str) -> str:
    # Hash the evidence the model reads, as visible text: markup noise such as session tokens
    # or element ids in a portal page must not make an unchanged notice look new.
    text = strip_html(notice_evidence(payload)) or ""
    return _digest(re.sub(r"\s+", " ", text).strip())


def screening_criteria_hash(settings: Settings, preferences: dict[str, Any]) -> str:
    taxonomy = settings.resolve_path(settings.taxonomy_config)
    return _digest(
        canonical_json(
            {
                "code_version": SCREENING_CODE_VERSION,
                "instructions": INSTRUCTIONS,
                "skill": load_screening_instructions(settings),
                "preferences": preferences,
                "taxonomy": taxonomy.read_text(encoding="utf-8") if taxonomy.exists() else "",
                "model": settings.ai_model,
                "reasoning": settings.ai_reasoning_effort,
                "max_output_tokens": settings.ai_max_output_tokens,
                "max_input_chars": settings.ai_max_input_chars,
                "triage_enabled": settings.ai_triage_enabled,
                "triage_exclude_threshold": settings.ai_triage_exclude_threshold,
                "fetch_details": settings.ai_fetch_details,
            }
        )
    )
