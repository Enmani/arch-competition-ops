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


# Only explicitly labelled page metadata is volatile. An unlabelled date is evidence.
_PAGE_NOISE = re.compile(
    r"\b(?:(?:page\s+)?generated[\s_-]+(?:at|on)|(?:page|request|server)[\s_-]+timestamp)"
    r"\s*[:=]?\s*\d{4}[-/]\d{1,2}[-/]\d{1,2}"
    r"(?:[T ]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:\s*(?:UTC|GMT|Z|[+-]\d\d:?\d\d))?)?"
    r"|\b(?:page\s+views|visit(?:or)?\s+count|visits|hit\s+count)\s*[:=]\s*[\d,]+"
    r"|\b(?:csrf(?:[\s_-]*token)?|nonce|session[\s_-]*(?:id|token))\s*[:=]\s*[\w./+=-]+",
    re.I,
)


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
    text = " ".join(_PAGE_NOISE.sub(" ", text).split())
    targets = sorted({target for link in links.links if (target := public_url(link))})
    return digest(canonical_json([public_url(url) or url, text, targets]))


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
