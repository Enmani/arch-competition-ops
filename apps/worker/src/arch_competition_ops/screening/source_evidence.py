"""Keep adapter-generated judgments out of the notice evidence sent to the model."""

import json

# These are local classification/evidence annotations, not upstream notice clauses.
_DERIVED_KEYS = {
    "opportunityType",
    "competitionTypes",
    "projectTypes",
    "buildingCategories",
    "officialSectors",
    "builtAssetTypes",
    "designScopes",
    "projectModes",
    "evidenceLevel",
    "evidenceNote",
}


def notice_evidence(payload: str) -> str:
    stripped = payload.lstrip()
    if not stripped.startswith("{"):
        return payload
    try:
        value, end = json.JSONDecoder().raw_decode(stripped)
    except ValueError:
        return payload
    if not isinstance(value, dict):
        return payload
    return (
        json.dumps(
            {key: item for key, item in value.items() if key not in _DERIVED_KEYS},
            ensure_ascii=False,
        )
        + stripped[end:]
    )
