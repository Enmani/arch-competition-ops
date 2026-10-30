import type {
  BuildingCategory,
  DesignScope,
  DiscoverFilters,
  ProjectMode,
  ProjectType,
  NoticeDetail,
} from "@arch-competition/core";

/**
 * Persistence model: one row of `competitions` exactly as the schema (apps/web/migrations)
 * defines it. It never leaves the storage package; consumers get `StoredOpportunityFeedItem`.
 * Empty `organizer` ('') means the buyer is unknown; `source_name` is the publishing platform.
 */
export type OpportunityRow = {
  audience: string;
  authority_name: string | null;
  brief_pdf_url: string | null;
  building_categories: string;
  built_asset_types: string;
  competition_types: string;
  cpv_codes: string;
  deadline_at: string | null;
  dedup_key: string;
  design_scopes: string;
  discovered_at: string;
  documents_portal_url: string | null;
  eligibility_summary: string | null;
  estimated_contract_value_eur: number | null;
  estimated_contract_value_text: string | null;
  evidence_level: string;
  evidence_note: string | null;
  extraction_confidence: number;
  geo_confidence: number | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_source: string | null;
  id: string;
  implementation_path: string | null;
  jurisdiction: string | null;
  languages: string;
  last_verified_at: string | null;
  licensed_architect_required: number | null;
  local_partner_required: number | null;
  location_label: string | null;
  official_notice_id: string | null;
  official_sectors: string;
  official_url: string | null;
  opportunity_type: string;
  organizer: string;
  prize_summary: string | null;
  procedure_type: string | null;
  project_modes: string;
  project_types: string;
  qualification_score: number | null;
  regions: string;
  registration_fee_eur: number | null;
  source_id: string | null;
  source_name: string | null;
  source_url: string;
  status: string;
  submission_fee_eur: number | null;
  title: string;
  updated_at: string;
};

export type StoredProjectType = ProjectType;
export type StoredBuildingCategory = BuildingCategory;
export type StoredDesignScope = DesignScope;
export type StoredProjectMode = ProjectMode;
/** Validated by core's `parseDiscoverFilters`; storage clamps again before building SQL. */
export type StoredOpportunityQuery = DiscoverFilters;

export type StoredFilterOptions = {
  buildingCategories: BuildingCategory[];
  designScopes: DesignScope[];
  implementationPaths: string[];
  jurisdictions: string[];
  procedureTypes: string[];
  projectModes: ProjectMode[];
  projectTypes: ProjectType[];
};

/**
 * Read model for the website and `/api/opportunities`.
 *
 * Truth rules encoded here:
 * - `authorityName` is the buyer (authority_name, then organizer); '' when unknown;
 *   consumers show their own localised "unknown";
 * - `organizerName` is the stored organizer or null; `sourceName` is the publishing platform
 *   and is never presented as the buyer;
 * - `officialUrl` is null unless the worker stored one (no silent fallback to source_url);
 * - NULL fees stay null; use core's `describeParticipationFee` to word them.
 * The `*Label` fields are English fallbacks, see ../presentation.ts.
 */
export type StoredOpportunityFeedItem = {
  noticeDetails?: NoticeDetail[];
  audience: string[];
  authorityName: string;
  briefPdfUrl: string | null;
  buildingCategories: BuildingCategory[];
  builtAssetTypes: string[];
  competitionTypes: string[];
  contractValueLabel: string;
  cpvCodes: string[];
  deadlineAt: string | null;
  deadlineLabel: string;
  description: string;
  designScopes: DesignScope[];
  discoveredAt: string;
  discoveredLabel: string;
  documentsPortalUrl: string | null;
  eligibilitySummary: string;
  estimatedContractValueEur: number | null;
  estimatedContractValueText: string | null;
  evidenceLevelKey: string;
  evidenceLevelLabel: string;
  evidenceNote: string;
  extractionConfidence: number;
  feeLabel: string;
  geoConfidence: number | null;
  geoLat: number | null;
  geoLng: number | null;
  geoSource: string | null;
  id: string;
  implementationPathKey: string | null;
  implementationPathLabel: string;
  jurisdictionKey: string | null;
  jurisdictionLabel: string;
  languages: string[];
  licensedArchitectRequired: boolean | null;
  localPartnerRequired: boolean | null;
  locationLabel: string | null;
  officialNoticeId: string | null;
  officialSectors: string[];
  officialUrl: string | null;
  opportunityTypeKey: string;
  opportunityTypeLabel: string;
  organizerName: string | null;
  prizeSummary: string | null;
  procedureTypeKey: string | null;
  procedureTypeLabel: string;
  projectModes: ProjectMode[];
  projectTypeKey: ProjectType | null;
  projectTypes: ProjectType[];
  qualificationLabel: string;
  qualificationScore: number | null;
  regions: string[];
  registrationFeeEur: number | null;
  slug: string;
  sourceId: string | null;
  sourceName: string | null;
  sourceTierLabel: string;
  sourceUrl: string;
  statusKey: string;
  statusLabel: string;
  subtitle: string;
  submissionFeeEur: number | null;
  tags: string[];
  title: string;
  updatedAt: string;
  updatedLabel: string;
};

export type StoredDiscoverSurfaceData = {
  filterOptions: StoredFilterOptions;
  opportunities: StoredOpportunityFeedItem[];
  total: number;
};
