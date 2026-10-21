/**
 * Controlled vocabularies shared by storage, API validation and the web app.
 *
 * Single source of truth for the TypeScript side. The values that also appear in
 * `config/taxonomy.yml` are checked against that file by
 * `packages/storage/src/taxonomy-consistency.test.ts`; `DESIGN_SCOPES` and `PROJECT_MODES`
 * are not part of taxonomy.yml yet (the worker writes them from the GGZY collector), see
 * docs/structures/2026-10-21-storage-auth-api-architecture.md.
 *
 * The order of every list is the display order used by filter controls.
 */
export const PROJECT_TYPES = [
  "urban_regeneration",
  "environment_design",
  "urban_planning",
  "interior_project",
  "building_project",
] as const;
export type ProjectType = (typeof PROJECT_TYPES)[number];

export const BUILDING_CATEGORIES = [
  "education",
  "healthcare",
  "housing",
  "civic_public",
  "sport_leisure",
  "culture_heritage",
  "transport_infrastructure",
] as const;
export type BuildingCategory = (typeof BUILDING_CATEGORIES)[number];

export const DESIGN_SCOPES = [
  "interior_design",
  "architectural_design",
  "scheme",
  "preliminary",
  "construction_docs",
  "planning",
  "design_service",
] as const;
export type DesignScope = (typeof DESIGN_SCOPES)[number];

export const PROJECT_MODES = ["new_build", "renovation", "extension"] as const;
export type ProjectMode = (typeof PROJECT_MODES)[number];

export const OPPORTUNITY_SORTS = ["deadline", "highest_value", "latest"] as const;
export type OpportunitySort = (typeof OPPORTUNITY_SORTS)[number];

export const COMPETITION_STATUSES = [
  "discovered",
  "shortlisted",
  "verified",
  "discarded",
  "archived",
] as const;
export type CompetitionStatus = (typeof COMPETITION_STATUSES)[number];

export const EVIDENCE_LEVELS = [
  "official_notice",
  "official_listing",
  "authority_page",
  "secondary",
  "tertiary",
] as const;
export type EvidenceLevel = (typeof EVIDENCE_LEVELS)[number];

export const OPPORTUNITY_TYPES = [
  "public_design_contest",
  "public_design_services_procurement",
  "framework_design_services",
  "negotiated_follow_on_services",
] as const;
export type OpportunityType = (typeof OPPORTUNITY_TYPES)[number];

export const PROCEDURE_TYPES = [
  "design_contest",
  "negotiated_procedure_after_contest",
  "public_design_services_tender",
  "maitrise_d_oeuvre_procurement",
  "planning_competition",
  "selective",
  "framework_agreement",
  "negotiated_procedure",
  "adapted_procedure",
  "open",
  "neg-w-call",
  "neg-wo-call",
] as const;
export type ProcedureType = (typeof PROCEDURE_TYPES)[number];

export const IMPLEMENTATION_PATHS = [
  "winner_or_winners_progress_to_negotiated_service_award",
  "service_contract_award_after_competitive_selection",
  "framework_selection_for_repeated_design_commissions",
  "unknown",
] as const;
export type ImplementationPath = (typeof IMPLEMENTATION_PATHS)[number];

export const OPS_REVIEW_STATUSES = ["pending", "accepted", "rejected", "needs_follow_up"] as const;
export type OpsReviewStatus = (typeof OPS_REVIEW_STATUSES)[number];

export const OPS_REVIEW_REASON_CODES = [
  "source_parse_failures",
  "source_run_failed",
  "duplicate_cluster",
  "low_confidence_record",
  "evidence_conflict",
  "submission_pending_review",
] as const;
export type OpsReviewReasonCode = (typeof OPS_REVIEW_REASON_CODES)[number];

export const OPS_REVIEW_ORIGINS = ["worker_diagnostic", "submission"] as const;
export type OpsReviewOrigin = (typeof OPS_REVIEW_ORIGINS)[number];

export const includesValue = <T extends string>(
  values: readonly T[],
  candidate: unknown,
): candidate is T => typeof candidate === "string" && (values as readonly string[]).includes(candidate);
