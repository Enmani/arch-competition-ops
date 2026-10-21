import {
  BUILDING_CATEGORIES,
  DESIGN_SCOPES,
  PROJECT_MODES,
  PROJECT_TYPES,
  includesValue,
  type Logger,
} from "@arch-competition/core";

import { resolveProcedureType } from "../procedure-types";
import {
  canonicalLabel,
  evidenceLevelLabels,
  formatContractValue,
  formatDeadline,
  formatFee,
  formatQualification,
  formatStamp,
  implementationPathLabels,
  opportunityTypeLabels,
  procedureLabels,
  statusLabels,
  titleCase,
} from "../presentation";
import type { OpportunityRow, StoredOpportunityFeedItem } from "./types";

/**
 * Persistence row -> read model. Classification (project types, building categories, design
 * scopes, project modes) is read from the columns the worker wrote at ingestion time; there
 * is no second, runtime heuristic. Each row is mapped exactly once.
 */
const parseJsonArray = (payload: string | null, row: OpportunityRow, column: string, logger: Logger) => {
  if (!payload) {
    return [] as string[];
  }
  try {
    const value: unknown = JSON.parse(payload);
    if (Array.isArray(value)) {
      return value.filter((item): item is string => typeof item === "string");
    }
  } catch {
    // Fall through to the warning below.
  }
  // Recoverable: render the record with an empty list but leave a trace for the data owner.
  logger.warn("storage.malformed_json_column", { column, rowId: row.id });
  return [] as string[];
};

const known = <T extends string>(values: readonly T[], items: string[]) =>
  values.filter((value) => items.includes(value) && includesValue(values, value));

const toBoolean = (value: number | null) => (value === null ? null : value === 1);

const blankToNull = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

export const toOpportunityFeedItem = (row: OpportunityRow, logger: Logger): StoredOpportunityFeedItem => {
  const column = (name: keyof OpportunityRow) => parseJsonArray(row[name] as string | null, row, name, logger);
  const competitionTypes = column("competition_types");
  const cpvCodes = column("cpv_codes");
  const procedure = resolveProcedureType(row.procedure_type);
  const projectTypes = known(PROJECT_TYPES, column("project_types"));
  const organizerName = blankToNull(row.organizer);
  // Buyer = authority_name, then organizer. The publishing platform (source_name) is never a buyer.
  const authorityName = blankToNull(row.authority_name) ?? organizerName ?? "";
  const procedureLabel = procedure.key
    ? canonicalLabel(procedure.key, procedureLabels, "Procedure pending")
    : "Procedure pending";
  const implementationPathLabel = canonicalLabel(
    row.implementation_path,
    implementationPathLabels,
    "Implementation path pending",
  );
  const evidenceLevelLabel = canonicalLabel(row.evidence_level, evidenceLevelLabels, "Evidence level pending");
  const tags = [...competitionTypes.map(titleCase), ...cpvCodes].slice(0, 4);

  return {
    audience: column("audience"),
    authorityName,
    briefPdfUrl: row.brief_pdf_url,
    buildingCategories: known(BUILDING_CATEGORIES, column("building_categories")),
    builtAssetTypes: column("built_asset_types"),
    competitionTypes,
    contractValueLabel: formatContractValue(
      row.estimated_contract_value_eur,
      row.estimated_contract_value_text,
      row.prize_summary,
    ),
    cpvCodes,
    deadlineAt: row.deadline_at,
    deadlineLabel: formatDeadline(row.deadline_at),
    description: `Implementation path: ${implementationPathLabel}. Evidence level: ${evidenceLevelLabel}.`,
    designScopes: known(DESIGN_SCOPES, column("design_scopes")),
    discoveredAt: row.discovered_at,
    discoveredLabel: formatStamp(row.discovered_at, "Captured"),
    documentsPortalUrl: row.documents_portal_url,
    eligibilitySummary: row.eligibility_summary ?? "",
    estimatedContractValueEur: row.estimated_contract_value_eur,
    estimatedContractValueText: row.estimated_contract_value_text,
    evidenceLevelKey: row.evidence_level,
    evidenceLevelLabel,
    evidenceNote: row.evidence_note ?? "",
    extractionConfidence: row.extraction_confidence,
    feeLabel: formatFee(row.registration_fee_eur, row.submission_fee_eur),
    geoConfidence: row.geo_confidence,
    geoLat: row.geo_lat,
    geoLng: row.geo_lng,
    geoSource: row.geo_source,
    id: row.id,
    implementationPathKey: row.implementation_path,
    implementationPathLabel,
    jurisdictionKey: row.jurisdiction,
    jurisdictionLabel: titleCase(row.jurisdiction),
    languages: column("languages"),
    licensedArchitectRequired: toBoolean(row.licensed_architect_required),
    localPartnerRequired: toBoolean(row.local_partner_required),
    locationLabel: row.location_label,
    officialNoticeId: row.official_notice_id,
    officialSectors: column("official_sectors"),
    officialUrl: blankToNull(row.official_url),
    opportunityTypeKey: row.opportunity_type,
    opportunityTypeLabel: canonicalLabel(row.opportunity_type, opportunityTypeLabels, "Opportunity type pending"),
    organizerName,
    prizeSummary: row.prize_summary,
    procedureTypeKey: procedure.key,
    procedureTypeLabel: procedureLabel,
    projectModes: known(PROJECT_MODES, column("project_modes")),
    projectTypeKey: projectTypes[0] ?? null,
    projectTypes,
    qualificationLabel: formatQualification(
      row.licensed_architect_required,
      row.local_partner_required,
      row.eligibility_summary,
    ),
    qualificationScore: row.qualification_score,
    regions: column("regions"),
    registrationFeeEur: row.registration_fee_eur,
    slug: row.id,
    sourceId: row.source_id,
    sourceName: blankToNull(row.source_name),
    sourceTierLabel:
      row.evidence_level === "official_notice" || row.evidence_level === "official_listing"
        ? "Primary official source"
        : "Secondary source",
    sourceUrl: row.source_url,
    statusKey: row.status,
    statusLabel: canonicalLabel(row.status, statusLabels, "Status pending"),
    submissionFeeEur: row.submission_fee_eur,
    subtitle: [authorityName, procedureLabel].filter(Boolean).join(" · "),
    tags: tags.length > 0 ? tags : ["Procurement-backed"],
    title: row.title,
    updatedAt: row.updated_at,
    updatedLabel: formatStamp(row.updated_at, "Updated"),
  };
};
