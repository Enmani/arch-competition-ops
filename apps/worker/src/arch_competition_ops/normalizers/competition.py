from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from importlib import resources
from pathlib import Path

from arch_competition_ops.models import CompetitionRecord
from arch_competition_ops.normalizers.text import (
    compile_markers,
    contains_any_phrase,
    normalize_text,
)

REGISTRY_RELATIVE_PATH = Path("config") / "procedure-type-registry.json"
# Copy of the registry shipped inside the wheel (pyproject force-include), used when the process
# is not running from a checkout that has config/procedure-type-registry.json.
BUNDLED_REGISTRY_PACKAGE = "arch_competition_ops"
BUNDLED_REGISTRY_RESOURCE = ("_bundled", "procedure-type-registry.json")

_registry_root: Path | None = None


def _compact_text(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = re.sub(r"\s+", " ", value).strip()
    return collapsed or None


def _normalize_lookup_key(value: str | None) -> str | None:
    compacted = _compact_text(value)
    if compacted is None:
        return None
    ascii_only = unicodedata.normalize("NFKD", compacted).encode("ascii", "ignore").decode("ascii")
    lowered = ascii_only.lower()
    normalized = re.sub(r"[^a-z0-9]+", "_", lowered).strip("_")
    return normalized or None


OPPORTUNITY_TYPE_ALIASES: dict[str, str] = {
    "public_design_contest": "public_design_contest",
    "design_contest": "public_design_contest",
    "competition": "public_design_contest",
    "project_competition": "public_design_contest",
    "planning_competition": "public_design_contest",
    "public_design_services_procurement": "public_design_services_procurement",
    "public_design_services_tender": "public_design_services_procurement",
    "framework_design_services": "framework_design_services",
    "framework_agreement": "framework_design_services",
    "negotiated_follow_on_services": "negotiated_follow_on_services",
}

UNKNOWN_OPPORTUNITY_TYPE = "unknown"


def configure_procedure_registry(root: Path | None) -> None:
    """Point registry lookup at ``<root>/config/procedure-type-registry.json``.

    Called once by the CLI entry point with ``Settings.root`` (and by the test suite). The Web app
    reads the same file, so the checkout copy stays the single source; the bundled wheel copy is
    only a fallback for installs that run outside a checkout.
    """
    global _registry_root
    _registry_root = root
    _load_registry.cache_clear()


def _read_registry_payload() -> dict:
    if _registry_root is not None:
        candidate = _registry_root / REGISTRY_RELATIVE_PATH
        if candidate.is_file():
            return json.loads(candidate.read_text(encoding="utf-8-sig"))

    bundled = resources.files(BUNDLED_REGISTRY_PACKAGE).joinpath(*BUNDLED_REGISTRY_RESOURCE)
    if bundled.is_file():
        return json.loads(bundled.read_text(encoding="utf-8-sig"))

    raise FileNotFoundError(
        f"{REGISTRY_RELATIVE_PATH} not found under {_registry_root} and no bundled copy is "
        "installed; call configure_procedure_registry(root) with the repository root."
    )


@lru_cache(maxsize=1)
def _load_registry() -> dict[str, str | None]:
    payload = _read_registry_payload()

    raw_alias_groups = payload.get("aliasGroups")
    if not isinstance(raw_alias_groups, dict):
        raise ValueError("procedure-type-registry.json must define aliasGroups as an object")

    aliases: dict[str, str | None] = {}
    for canonical_key, group_aliases in raw_alias_groups.items():
        if not isinstance(canonical_key, str) or not isinstance(group_aliases, list):
            raise ValueError("procedure-type-registry.json contains an invalid aliasGroups entry")
        for alias in group_aliases:
            lookup_key = _normalize_lookup_key(alias) if isinstance(alias, str) else None
            if lookup_key is not None:
                aliases[lookup_key] = canonical_key

    raw_suppressed_aliases = payload.get("suppressedAliases", [])
    if not isinstance(raw_suppressed_aliases, list):
        raise ValueError("procedure-type-registry.json must define suppressedAliases as a list")
    for alias in raw_suppressed_aliases:
        lookup_key = _normalize_lookup_key(alias) if isinstance(alias, str) else None
        if lookup_key is not None:
            aliases[lookup_key] = None

    return aliases


IMPLEMENTATION_PATH_ALIASES: dict[str, str | None] = {
    "winner_or_winners_progress_to_negotiated_service_award": (
        "winner_or_winners_progress_to_negotiated_service_award"
    ),
    "service_contract_award_after_competitive_selection": (
        "service_contract_award_after_competitive_selection"
    ),
    "framework_selection_for_repeated_design_commissions": (
        "framework_selection_for_repeated_design_commissions"
    ),
    "unknown": None,
}

EVIDENCE_LEVEL_ALIASES: dict[str, str] = {
    "official_notice": "official_notice",
    "official_listing": "official_listing",
    "authority_page": "authority_page",
    "secondary": "secondary",
    "tertiary": "tertiary",
}


def normalize_opportunity_type(value: str | None) -> str | None:
    lookup_key = _normalize_lookup_key(value)
    if lookup_key is None:
        return None
    if lookup_key == UNKNOWN_OPPORTUNITY_TYPE:
        return UNKNOWN_OPPORTUNITY_TYPE
    mapped = OPPORTUNITY_TYPE_ALIASES.get(lookup_key)
    if mapped is not None:
        return mapped
    if "contest" in lookup_key or "competition" in lookup_key:
        return "public_design_contest"
    if "framework" in lookup_key:
        return "framework_design_services"
    if any(keyword in lookup_key for keyword in ("service", "procurement", "tender", "proposal")):
        return "public_design_services_procurement"
    return None


def normalize_procedure_type(value: str | None) -> str | None:
    lookup_key = _normalize_lookup_key(value)
    if lookup_key is None:
        return None
    aliases = _load_registry()
    if lookup_key in aliases:
        return aliases[lookup_key]
    if "framework" in lookup_key:
        return "framework_agreement"
    if "contest" in lookup_key or "competition" in lookup_key:
        return "design_contest"
    if any(keyword in lookup_key for keyword in ("proposal", "tender", "procurement")):
        return "public_design_services_tender"
    return None


def normalize_implementation_path(value: str | None) -> str | None:
    """Map an *explicitly stated* implementation path; never derive one from the opportunity."""
    lookup_key = _normalize_lookup_key(value)
    if lookup_key is not None and lookup_key in IMPLEMENTATION_PATH_ALIASES:
        return IMPLEMENTATION_PATH_ALIASES[lookup_key]
    return None


def normalize_official_notice_id(value: str | None) -> str | None:
    compacted = _compact_text(value)
    if compacted is None:
        return None
    return compacted


def normalize_evidence_level(value: str | None, *, source_tier: str) -> str:
    lookup_key = _normalize_lookup_key(value)
    if lookup_key and lookup_key in EVIDENCE_LEVEL_ALIASES:
        return EVIDENCE_LEVEL_ALIASES[lookup_key]
    return "official_notice" if source_tier == "primary" else "secondary"


# Matched only inside *eligibility clause* text (see infer_licensed_architect_required), where
# naming the profession is a requirement. The same words in a title or description are not.
_LICENSED_ARCHITECT_MARKERS = compile_markers(
    (
        "architect",
        "architects",
        "architecte",
        "architectes",
        "architekt",
        "architekten",
        "architetto",
        "architetti",
        "注册建筑师",
        "一级注册建筑师",
        "二级注册建筑师",
        "建筑行业（建筑工程）",
        "建筑装饰工程设计专项",
        "工程设计综合甲级",
        "设计资质",
    )
)
_LOCAL_PARTNER_MARKERS = compile_markers(
    (
        "local partner",
        "local engineering partner",
        "local permitting partner",
        "local teaming",
        "partenaire local",
        "lokaler partner",
        "本地合作",
    )
)


def infer_licensed_architect_required(eligibility_clause: str | None) -> bool | None:
    """True only when the *eligibility clause itself* names a licence/registration requirement.

    Callers must pass clause text taken from a qualification section. Descriptions, titles, or
    page bodies are not evidence of a requirement and must not be passed here (AGENTS.md rule 4).
    """
    if not eligibility_clause:
        return None
    return (
        True
        if contains_any_phrase(normalize_text(eligibility_clause), _LICENSED_ARCHITECT_MARKERS)
        else None
    )


def infer_local_partner_required(eligibility_clause: str | None) -> bool | None:
    """True only when the eligibility clause explicitly demands a local partner."""
    if not eligibility_clause:
        return None
    return (
        True
        if contains_any_phrase(normalize_text(eligibility_clause), _LOCAL_PARTNER_MARKERS)
        else None
    )


def _has_value(record: CompetitionRecord) -> bool:
    return record.estimated_contract_value_eur is not None or bool(
        record.estimated_contract_value_text
    )


# One entry per piece of evidence an extraction can actually find in a notice. Titles and
# constants are not evidence, so they are not listed.
EXTRACTION_EVIDENCE_PROBES = (
    lambda record: bool(record.official_notice_id),
    lambda record: record.deadline_at is not None,
    lambda record: bool(record.authority_name),
    lambda record: bool(record.procedure_type),
    lambda record: bool(record.cpv_codes),
    _has_value,
    lambda record: bool(record.official_url),
    lambda record: bool(record.location_label),
    lambda record: bool(record.brief_pdf_url or record.documents_portal_url),
)
CONFIDENCE_FLOOR = 0.2


def compute_extraction_confidence(record: CompetitionRecord) -> float:
    """Evidence-based confidence in [0.2, 1.0].

    ``confidence = 0.2 + 0.8 * (evidence fields present / 9)``, rounded to two decimals. The nine
    fields are notice id, deadline, authority, procedure type, CPV codes, contract value, official
    URL, location, and brief/portal link. A bare title-only listing scores 0.20; a record with
    four fields scores 0.56. ``review_queue.LOW_CONFIDENCE_THRESHOLD`` (0.5) therefore flags
    records that carry three or fewer pieces of evidence, instead of every record as the former
    constant 0.78 did.
    """
    present = sum(1 for probe in EXTRACTION_EVIDENCE_PROBES if probe(record))
    return round(
        CONFIDENCE_FLOOR + (1 - CONFIDENCE_FLOOR) * present / len(EXTRACTION_EVIDENCE_PROBES), 2
    )


def compute_qualification_score(record: CompetitionRecord) -> float:
    score = 0.15

    if record.evidence_level in {"official_notice", "official_listing"}:
        score += 0.2
    if record.official_notice_id:
        score += 0.15
    if record.implementation_path:
        score += 0.15
    if record.licensed_architect_required:
        score += 0.15
    if record.local_partner_required:
        score += 0.05
    if _has_value(record):
        score += 0.1
    # Only an explicit zero is a "no fee" signal; unknown (None) earns nothing.
    if record.registration_fee_eur == 0.0 and record.submission_fee_eur == 0.0:
        score += 0.1
    if record.authority_name:
        score += 0.1

    return min(score, 1.0)
