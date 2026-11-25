"""Read unambiguous source fields. Multiple lot-specific answers stay with the reader."""

import re
from collections import defaultdict
from datetime import datetime

from arch_competition_ops.screening.field_contract import FIELD_BY_PATH
from arch_competition_ops.screening.models import ExtractedField


def competing_dates(text, day):
    # A listing date can predate a correction in the body. Only explicitly typed publication
    # dates are harmless here; leave conflicting dates or prose milestones to the reader.
    other = re.sub(
        r"(?mi)^(?:publishedAt|publicationDate|publication-date|dateparution): [^\n]+$", "", text
    )
    if re.search(r"\d{4}年\d{1,2}月|\d{1,2}[/.]\d{1,2}[/.]\d{4}", other):
        return True
    return any(candidate != day for candidate in re.findall(r"(?<!\d)\d{4}-\d\d-\d\d", other))


def mapped_facts(leaves, text, taxonomy):
    candidates = defaultdict(set)
    for path, original in leaves:
        candidates[FIELD_BY_PATH[path]].add((original, f"{path}: {original}"))
    facts = {}
    for field, choices in candidates.items():
        if len({value for value, _ in choices}) != 1:
            continue
        original, quote = min(choices)
        if quote not in text:
            continue
        value = original.strip()
        if field == "deadline_at":
            try:
                value = datetime.fromisoformat(value).date().isoformat()
            except ValueError:
                continue
            if competing_dates(text, value):
                continue
        elif field == "procedure_type":
            value = value.lower().replace(" ", "_")
            if value not in taxonomy.procedure_types:
                continue
        elif field == "estimated_contract_value_eur" and not re.fullmatch(r"\d+(?:\.\d+)?", value):
            continue
        if field not in {"deadline_at", "estimated_contract_value_eur"}:
            quote = original
        facts[field] = ExtractedField(
            field=field, value=value, quote=quote, evidence_field="notice_text"
        )
    return facts
