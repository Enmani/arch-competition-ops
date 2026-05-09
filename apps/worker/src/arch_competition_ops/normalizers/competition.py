from __future__ import annotations

import json
import re
import unicodedata
from functools import lru_cache
from pathlib import Path

from arch_competition_ops.models import CompetitionRecord


def _compact_text(value: str | None) -> str | None:
    if value is None:
        return None
    collapsed = re.sub(r"\s+", " ", value).strip()
    return collapsed or None


def _normalize_lookup_key(value: str | None) -> str | None:
    compacted = _compact_text(value)
    if compacted is None:
        return None
    ascii_only = (
        unicodedata.normalize("NFKD", compacted).encode("ascii", "ignore").decode("ascii")
    )
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


@lru_cache(maxsize=1)
def _load_procedure_type_registry() -> tuple[dict[str, tuple[str, ...]], set[str]]:
    registry_path = Path(__file__).resolve().parents[5] / "config" / "procedure-type-registry.json"
    payload = json.loads(registry_path.read_text(encoding="utf-8"))

    raw_alias_groups = payload.get("aliasGroups")
    if not isinstance(raw_alias_groups, dict):
        raise ValueError("procedure-type-registry.json must define aliasGroups as an object")

    alias_groups: dict[str, tuple[str, ...]] = {}
    for canonical_key, aliases in raw_alias_groups.items():
        if not isinstance(canonical_key, str) or not isinstance(aliases, list):
            raise ValueError("procedure-type-registry.json contains an invalid aliasGroups entry")
        alias_groups[canonical_key] = tuple(
            alias.strip()
            for alias in aliases
            if isinstance(alias, str) and alias.strip()
        )

    raw_suppressed_aliases = payload.get("suppressedAliases", [])
    if not isinstance(raw_suppressed_aliases, list):
        raise ValueError("procedure-type-registry.json must define suppressedAliases as a list")

    suppressed_aliases = {
        alias.strip()
        for alias in raw_suppressed_aliases
        if isinstance(alias, str) and alias.strip()
    }

    return alias_groups, suppressed_aliases


PROCEDURE_TYPE_GROUPS, SUPPRESSED_PROCEDURE_TYPE_ALIASES = _load_procedure_type_registry()

PROCEDURE_TYPE_ALIASES: dict[str, str | None] = {
    lookup_key: canonical_key
    for canonical_key, aliases in PROCEDURE_TYPE_GROUPS.items()
    for alias in aliases
    if (lookup_key := _normalize_lookup_key(alias)) is not None
}
PROCEDURE_TYPE_ALIASES.update(
    {
        lookup_key: None
        for alias in SUPPRESSED_PROCEDURE_TYPE_ALIASES
        if (lookup_key := _normalize_lookup_key(alias)) is not None
    }
)

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
    if lookup_key in PROCEDURE_TYPE_ALIASES:
        return PROCEDURE_TYPE_ALIASES[lookup_key]
    if "framework" in lookup_key:
        return "framework_agreement"
    if "contest" in lookup_key or "competition" in lookup_key:
        return "design_contest"
    if any(keyword in lookup_key for keyword in ("proposal", "tender", "procurement")):
        return "public_design_services_tender"
    return None


def normalize_implementation_path(
    value: str | None,
    *,
    opportunity_type: str | None = None,
) -> str | None:
    lookup_key = _normalize_lookup_key(value)
    if lookup_key is not None and lookup_key in IMPLEMENTATION_PATH_ALIASES:
        return IMPLEMENTATION_PATH_ALIASES[lookup_key]
    if opportunity_type == "framework_design_services":
        return "framework_selection_for_repeated_design_commissions"
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


def infer_licensed_architect_required(*chunks: str | None) -> bool | None:
    haystack = " ".join(chunk for chunk in chunks if chunk).lower()
    if not haystack:
        return None

    positive_signals = [
        "architect registration",
        "architecte",
        "architect",
        "architettura",
        "architetto",
        "licensed architect",
        "architectural and related services",
        "architectural, engineering and planning services",
        "servizi di architettura e ingegneria",
        "progettazione",
        "maitrise d'oeuvre",
        "maîtrise d'oeuvre",
        "iscritto",
        "qualification required",
        "general planners",
        "注册建筑师",
        "一级注册建筑师",
        "设计资质",
        "建筑行业",
        "建筑工程",
        "工程设计综合甲级",
        "建筑装饰工程设计专项甲级",
    ]
    if any(signal in haystack for signal in positive_signals):
        return True
    return None


def infer_local_partner_required(*chunks: str | None) -> bool | None:
    haystack = " ".join(chunk for chunk in chunks if chunk).lower()
    if not haystack:
        return None

    positive_signals = [
        "local partner",
        "local engineering",
        "local permitting partner",
        "local teaming",
        "teaming partner",
        "joint venture",
        "consortium",
    ]
    if any(signal in haystack for signal in positive_signals):
        return True
    return None


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
    if record.estimated_contract_value_eur is not None or record.estimated_contract_value_text:
        score += 0.1
    if (record.registration_fee_eur or 0.0) == 0.0 and (record.submission_fee_eur or 0.0) == 0.0:
        score += 0.1
    if record.authority_name:
        score += 0.1

    return min(score, 1.0)
