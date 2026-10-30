from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, Field

from arch_competition_ops.clock import now_utc


class CompetitionRecord(BaseModel):
    competition_id: str | None = None
    title: str
    # Real buyer / organizer only. Empty string means "not stated"; never a platform name.
    organizer: str = ""
    # Publishing platform that surfaced the record (config/sources.yml source_id / name).
    source_id: str | None = None
    source_name: str | None = None
    authority_name: str | None = None
    official_url: str | None = None
    source_url: str
    status: str = "discovered"
    opportunity_type: str = "unknown"
    jurisdiction: str | None = None
    procedure_type: str | None = None
    official_notice_id: str | None = None
    regions: list[str] = Field(default_factory=list)
    languages: list[str] = Field(default_factory=list)
    competition_types: list[str] = Field(default_factory=list)
    project_types: list[str] = Field(default_factory=list)
    building_categories: list[str] = Field(default_factory=list)
    official_sectors: list[str] = Field(default_factory=list)
    built_asset_types: list[str] = Field(default_factory=list)
    design_scopes: list[str] = Field(default_factory=list)
    project_modes: list[str] = Field(default_factory=list)
    audience: list[str] = Field(default_factory=list)
    cpv_codes: list[str] = Field(default_factory=list)
    implementation_path: str | None = None
    licensed_architect_required: bool | None = None
    local_partner_required: bool | None = None
    registration_fee_eur: float | None = None
    submission_fee_eur: float | None = None
    estimated_contract_value_eur: float | None = None
    estimated_contract_value_text: str | None = None
    prize_summary: str | None = None
    location_label: str | None = None
    geo_lat: float | None = None
    geo_lng: float | None = None
    geo_source: str | None = None
    geo_confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    deadline_at: date | None = None
    eligibility_summary: str | None = None  # qualification clause text only
    # Project prose from the source. Transient: used for classification and keyword
    # filtering, never written to the database.
    description: str | None = Field(default=None, exclude=True)
    # Only adapters whose contract guarantees one notice per URL may enable URL identity.
    # Listing/API-root URLs can name many opportunities and must never be merged on URL alone.
    source_url_is_notice: bool = Field(default=False, exclude=True)
    brief_pdf_url: str | None = None
    documents_portal_url: str | None = None
    extraction_confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    evidence_level: str = "secondary"
    qualification_score: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence_note: str | None = None
    last_verified_at: datetime | None = None
    discovered_at: datetime = Field(default_factory=now_utc)

    def canonical_deadline(self) -> str:
        if self.deadline_at is None:
            return "unknown-date"
        return self.deadline_at.isoformat()
