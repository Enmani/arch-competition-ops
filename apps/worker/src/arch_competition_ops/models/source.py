from __future__ import annotations

from pydantic import BaseModel, Field

# AI maintenance note:
# - url_list_path/url_list are for long portal sets; do not hardcode city lists into source YAML bodies.
# - buyer_allowlist_path/buyer_allowlist are for country or authority focus lists such as Italy SCP buyers.
# - collector lets new packs opt into an existing collector family without editing the registry per source id.
# - New country onboarding should usually mean a new pack file plus an existing collector family, not a bespoke Python branch.

class SourceDefinition(BaseModel):
    source_id: str
    name: str
    kind: str
    jurisdiction: str
    base_url: str
    collector: str | None = None
    url_list_path: str | None = None
    url_list: list[str] = Field(default_factory=list)
    buyer_allowlist_path: str | None = None
    buyer_allowlist: list[str] = Field(default_factory=list)
    scan_method: str
    extractor: str
    verifier: str | None = None
    source_tier: str = "secondary"
    priority: float = Field(default=0.5, ge=0.0, le=1.0)
    enabled: bool = True
    regions: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    notes: str | None = None


class SourceCatalog(BaseModel):
    sources: list[SourceDefinition] = Field(default_factory=list)


class TargetingPreferences(BaseModel):
    regions: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    audience: list[str] = Field(default_factory=list)
    competition_types: list[str] = Field(default_factory=list)
    opportunity_types: list[str] = Field(default_factory=list)
    procedure_types: list[str] = Field(default_factory=list)
    evidence_levels: list[str] = Field(default_factory=list)
    max_registration_fee_eur: float | None = None
    max_submission_fee_eur: float | None = None
    min_estimated_contract_value_eur: float | None = None
    deadline_window_days: int | None = None
    prioritize_official_sources: bool = True
    require_brief_or_program: bool = True
    require_implementation_path: bool = True
    require_licensed_architect_signal: bool = True
    include_student_only: bool = False
    include_built_projects: bool = True
    include_unpaid_calls: bool = False
    positive_keywords: list[str] = Field(default_factory=list)
    negative_keywords: list[str] = Field(default_factory=list)


class Taxonomy(BaseModel):
    regions: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    source_kinds: list[str] = Field(default_factory=list)
    source_tiers: list[str] = Field(default_factory=list)
    scan_methods: list[str] = Field(default_factory=list)
    competition_statuses: list[str] = Field(default_factory=list)
    competition_types: list[str] = Field(default_factory=list)
    opportunity_types: list[str] = Field(default_factory=list)
    procedure_types: list[str] = Field(default_factory=list)
    implementation_paths: list[str] = Field(default_factory=list)
    evidence_levels: list[str] = Field(default_factory=list)
    audience: list[str] = Field(default_factory=list)
    project_types: list[str] = Field(default_factory=list)
    building_categories: list[str] = Field(default_factory=list)
