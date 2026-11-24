"""Identity of one notice version and its assessment contract."""

import hashlib
import json
import re

from arch_competition_ops.normalizers.text import strip_html
from arch_competition_ops.screening.models import ScreeningDecision, canonical_json
from arch_competition_ops.screening.notice_urls import URL, PageLinks, public_url
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.screening.providers import provider_identity
from arch_competition_ops.screening.source_evidence import notice_evidence
from arch_competition_ops.settings import Settings


def digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _stable_object(pairs):
    volatile = {
        "csrftoken",
        "requestverificationtoken",
        "viewstate",
        "sessiontoken",
        "requesttimestamp",
        "pagegeneratedat",
    }
    return {k: v for k, v in pairs if k.casefold().replace("_", "") not in volatile}


def notice_content_hash(payload: str, url: str) -> str:
    material = notice_evidence(payload)
    # Structured APIs can change property order or page-generation metadata on every poll.
    if material.lstrip().startswith(("{", "[")):
        material = material.lstrip()
        try:
            data, end = json.JSONDecoder(object_pairs_hook=_stable_object).raw_decode(material)
        except ValueError:
            pass
        else:
            material = canonical_json(data) + material[end:]
    visible = re.sub(r"<(script|style)\b[^>]*>.*?</\1>", " ", material, flags=re.I | re.S)
    links = PageLinks(url)
    links.feed(visible)
    text = URL.sub(lambda m: public_url(m[0]), strip_html(visible) or "")
    return digest(
        canonical_json(
            [public_url(url) or url, text, sorted(set(filter(None, map(public_url, links.links))))]
        )
    )


def screening_criteria_hash(settings: Settings) -> str:
    return digest(
        canonical_json(
            [
                load_screening_instructions(settings),
                ScreeningDecision.model_json_schema(),
                provider_identity(settings),
                settings.ai_model,
                settings.ai_reasoning_effort,
                settings.ai_max_input_chars,
            ]
        )
    )
