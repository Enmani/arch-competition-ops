"""Identity of one notice version and its assessment contract."""

import hashlib
import json

from arch_competition_ops.config_loader import load_taxonomy
from arch_competition_ops.screening.field_contract import FIELDS
from arch_competition_ops.screening.models import ScreeningAnswer, canonical_json
from arch_competition_ops.screening.notice_urls import URL, public_url
from arch_competition_ops.screening.preferences import load_screening_instructions
from arch_competition_ops.screening.providers import provider_identity
from arch_competition_ops.screening.readability import visible_text
from arch_competition_ops.screening.source_evidence import notice_evidence, notice_title
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


def notice_content_hash(payload: str, url: str, *, collected=True) -> str:
    material = notice_evidence(payload, collected=collected)
    # Structured APIs can change property order or page-generation metadata on every poll.
    if material.lstrip().startswith(("{", "[")):
        material = material.lstrip()
        try:
            data, end = json.JSONDecoder(object_pairs_hook=_stable_object).raw_decode(material)
        except ValueError:
            pass
        else:
            material = canonical_json(data) + material[end:]
    text, links = visible_text(material, url)
    text = " ".join(URL.sub(lambda m: public_url(m[0]), text).split())
    targets = sorted({target for link in links if (target := public_url(link))})
    identity = [public_url(url) or url, text, targets]
    if title := notice_title(payload):
        identity.append(" ".join(URL.sub(lambda m: public_url(m[0]), title).split()))
    return digest(canonical_json(identity))


def screening_criteria_hash(settings: Settings) -> str:
    taxonomy = load_taxonomy(settings)
    labels = {
        spec.taxonomy: list(getattr(taxonomy, spec.taxonomy))
        for spec in FIELDS.values()
        if spec.taxonomy
    }
    return digest(
        canonical_json(
            [
                load_screening_instructions(settings),
                labels,
                ScreeningAnswer.schema_version,
                provider_identity(settings),
                settings.ai_model,
                settings.ai_reasoning_effort,
                settings.ai_max_input_chars,
            ]
        )
    )
