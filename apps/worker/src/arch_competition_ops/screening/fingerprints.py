"""Identity of one notice version and its assessment contract."""

import hashlib
import json

from arch_competition_ops.screening.models import ScreeningAnswer, canonical_json
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


class _VisibleNotice(PageLinks):
    """Collect text and links from the same visible portion of the document."""

    def __init__(self, url):
        super().__init__(url)
        self.text = []
        self.skipped = []
        self.content_depth = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag in {
            "area",
            "base",
            "br",
            "col",
            "embed",
            "hr",
            "img",
            "input",
            "link",
            "meta",
            "param",
            "source",
            "track",
            "wbr",
        }:
            return
        if self.skipped:
            self.skipped.append(tag)
            return
        if (
            tag in {"head", "script", "style", "nav", "template"}
            or (tag == "footer" and not self.content_depth)
            or "hidden" in attributes
            or attributes.get("aria-hidden") == "true"
            or attributes.get("role") == "navigation"
        ):
            self.skipped.append(tag)
            return
        if tag in {"article", "main"}:
            self.content_depth += 1
        super().handle_starttag(tag, attrs)

    def handle_endtag(self, tag):
        if self.skipped:
            if tag in self.skipped:
                while self.skipped.pop() != tag:
                    pass
        elif tag in {"article", "main"}:
            self.content_depth = max(0, self.content_depth - 1)

    def handle_data(self, data):
        if not self.skipped:
            self.text.append(data)


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
    page = _VisibleNotice(url)
    page.feed(material)
    page.close()
    text = URL.sub(lambda m: public_url(m[0]), " ".join(page.text))
    text = " ".join(text.split())
    targets = sorted({target for link in page.links if (target := public_url(link))})
    return digest(canonical_json([public_url(url) or url, text, targets]))


def screening_criteria_hash(settings: Settings) -> str:
    return digest(
        canonical_json(
            [
                load_screening_instructions(settings),
                ScreeningAnswer.schema_version,
                ScreeningAnswer.model_json_schema(),
                provider_identity(settings),
                settings.ai_model,
                settings.ai_reasoning_effort,
                settings.ai_max_input_chars,
            ]
        )
    )
