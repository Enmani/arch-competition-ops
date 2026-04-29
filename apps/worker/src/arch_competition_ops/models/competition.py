from __future__ import annotations

from datetime import date, datetime, timezone

from pydantic import BaseModel, Field


class CompetitionRecord(BaseModel):
    competition_id: str | None = None
    title: str
    organizer: str = "unknown"
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
    deadline_at: date | None = None
    eligibility_summary: str | None = None
    brief_pdf_url: str | None = None
    documents_portal_url: str | None = None
    extraction_confidence: float = Field(default=0.5, ge=0.0, le=1.0)
    evidence_level: str = "secondary"
    qualification_score: float | None = Field(default=None, ge=0.0, le=1.0)
    evidence_note: str | None = None
    last_verified_at: datetime | None = None
    discovered_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    def canonical_deadline(self) -> str:
        if self.deadline_at is None:
            return "unknown-date"
        return self.deadline_at.isoformat()
