import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";

import Database from "better-sqlite3";

import {
  type ProfessionalOpportunity,
  getRadarSnapshot,
} from "@arch-competition/core";

type OpportunityRow = {
  id: string;
  title: string;
  organizer: string | null;
  authority_name: string | null;
  official_url: string | null;
  source_url: string;
  status: string;
  opportunity_type: string;
  jurisdiction: string | null;
  procedure_type: string | null;
  official_notice_id: string | null;
  regions: string;
  languages: string;
  competition_types: string;
  audience: string;
  cpv_codes: string;
  implementation_path: string | null;
  licensed_architect_required: number | null;
  local_partner_required: number | null;
  registration_fee_eur: number | null;
  submission_fee_eur: number | null;
  estimated_contract_value_eur: number | null;
  estimated_contract_value_text: string | null;
  prize_summary: string | null;
  location_label: string | null;
  geo_lat: number | null;
  geo_lng: number | null;
  geo_source: string | null;
  geo_confidence: number | null;
  deadline_at: string | null;
  eligibility_summary: string | null;
  brief_pdf_url: string | null;
  documents_portal_url: string | null;
  extraction_confidence: number;
  evidence_level: string;
  qualification_score: number | null;
  evidence_note: string | null;
  last_verified_at: string | null;
  discovered_at: string;
  updated_at: string;
};

type SqlParameter = string | number | bigint | Uint8Array | null;
export type StoredProjectType =
  | "urban_regeneration"
  | "environment_design"
  | "urban_planning"
  | "building_project";
export type StoredBuildingCategory =
  | "healthcare"
  | "education"
  | "housing"
  | "civic_public"
  | "sport_leisure"
  | "culture_heritage"
  | "transport_infrastructure";
export type StoredOpportunityQuery = {
  buildingCategories?: StoredBuildingCategory[];
  includeExpired?: boolean;
  deadlineAfter?: string;
  deadlineBefore?: string;
  implementationPath?: string;
  jurisdiction?: string;
  limit?: number;
  licensedArchitectRequired?: boolean;
  maxEstimatedValueEur?: number;
  minEstimatedValueEur?: number;
  minQualificationScore?: number;
  publishedWithinDays?: number;
  projectTypes?: StoredProjectType[];
  procedureType?: string;
  search?: string;
  sort?: "deadline" | "highest_value" | "latest";
};
export type StoredFilterOptions = {
  buildingCategories: StoredBuildingCategory[];
  implementationPaths: string[];
  jurisdictions: string[];
  projectTypes: StoredProjectType[];
  procedureTypes: string[];
};
export type StoredDiscoverSurfaceData = {
  filterOptions: StoredFilterOptions;
  opportunities: StoredOpportunityFeedItem[];
};
export type StoredSourceHealthItem = {
  sourceId: string;
  sourceName: string;
  sourceKind: string;
  sourceTier: string;
  lastStatus: string;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastSuccessAt: string | null;
  lastDocumentCount: number;
  lastUpsertedCount: number;
  lastParseFailureCount: number;
  duplicateGroupCount: number;
  maxDuplicateGroupSize: number;
  lastError: string | null;
};
export type StoredDuplicatePressureSummary = {
  duplicateGroups: number;
  recordsInDuplicateGroups: number;
  maxDuplicateGroupSize: number;
};
export type StoredOpportunityFeedItem = ProfessionalOpportunity & {
  audience: string[];
  buildingCategories: StoredBuildingCategory[];
  briefPdfUrl: string | null;
  competitionTypes: string[];
  cpvCodes: string[];
  deadlineAt: string | null;
  discoveredAt: string;
  discoveredLabel: string;
  documentsPortalUrl: string | null;
  estimatedContractValueEur: number | null;
  estimatedContractValueText: string | null;
  evidenceLevelKey: string;
  extractionConfidence: number;
  geoConfidence: number | null;
  geoLat: number | null;
  geoLng: number | null;
  geoSource: string | null;
  implementationPathKey: string | null;
  jurisdictionKey: string | null;
  languages: string[];
  licensedArchitectRequired: boolean | null;
  locationLabel: string | null;
  localPartnerRequired: boolean | null;
  officialNoticeId: string | null;
  opportunityTypeKey: string;
  organizerName: string;
  prizeSummary: string | null;
  projectTypeKey: StoredProjectType | null;
  procedureTypeKey: string | null;
  qualificationScore: number | null;
  regions: string[];
  registrationFeeEur: number | null;
  sourceUrl: string;
  statusKey: string;
  submissionFeeEur: number | null;
  updatedAt: string;
  updatedLabel: string;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "../../..");
const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const projectTypeOrder: StoredProjectType[] = [
  "urban_regeneration",
  "environment_design",
  "urban_planning",
  "building_project",
];
const buildingCategoryOrder: StoredBuildingCategory[] = [
  "education",
  "healthcare",
  "housing",
  "civic_public",
  "sport_leisure",
  "culture_heritage",
  "transport_infrastructure",
];
type ProcedureTypeRegistry = {
  aliasGroups: Record<string, readonly string[]>;
  suppressedAliases: readonly string[];
};

const resolveSqlitePath = () => {
  const envPath = process.env.ARCH_COMPETITION_DB_PATH;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath);
  }
  return path.join(repoRoot, "data", "competitions.sqlite");
};

const loadProcedureTypeRegistry = (): ProcedureTypeRegistry => {
  const registryPath = path.join(repoRoot, "config", "procedure-type-registry.json");
  const payload = JSON.parse(readFileSync(registryPath, "utf8")) as Partial<ProcedureTypeRegistry>;

  if (!payload.aliasGroups || typeof payload.aliasGroups !== "object") {
    throw new Error("config/procedure-type-registry.json must define aliasGroups");
  }

  return {
    aliasGroups: Object.fromEntries(
      Object.entries(payload.aliasGroups).map(([canonicalKey, aliases]) => [
        canonicalKey,
        Array.isArray(aliases) ? aliases.filter((alias): alias is string => typeof alias === "string") : [],
      ]),
    ),
    suppressedAliases: Array.isArray(payload.suppressedAliases)
      ? payload.suppressedAliases.filter((alias): alias is string => typeof alias === "string")
      : [],
  };
};

const safeJsonArray = (payload: string | null) => {
  if (!payload) {
    return [] as string[];
  }

  try {
    const value = JSON.parse(payload);
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [] as string[];
  }
};

const normalizeMatchText = (value: string | null | undefined) =>
  (value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const compactText = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
};

const normalizeLookupKey = (value: string | null | undefined) => {
  const compacted = compactText(value);
  if (!compacted) {
    return null;
  }

  return compacted
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
};

const titleCase = (value: string | null | undefined) => {
  if (!value) {
    return "Unknown";
  }

  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

const canonicalOpportunityTypeLabels: Record<string, string> = {
  public_design_contest: "Public design contest",
  public_design_services_procurement: "Public design services procurement",
  framework_design_services: "Framework design services",
  negotiated_follow_on_services: "Negotiated follow-on services",
};

const canonicalProcedureLabels: Record<string, string> = {
  design_contest: "Design contest",
  negotiated_procedure_after_contest: "Negotiated procedure after contest",
  public_design_services_tender: "Public design services tender",
  maitrise_d_oeuvre_procurement: "Maitrise d oeuvre procurement",
  planning_competition: "Planning competition",
  selective: "Selective procedure",
  framework_agreement: "Framework agreement",
  negotiated_procedure: "Negotiated procedure",
  adapted_procedure: "Adapted procedure",
  open: "Open procedure",
  "neg-w-call": "Negotiated procedure with call",
  "neg-wo-call": "Negotiated procedure without call",
};

const procedureTypeRegistry = loadProcedureTypeRegistry();
const procedureAliasGroups = procedureTypeRegistry.aliasGroups;
const suppressedProcedureAliases = procedureTypeRegistry.suppressedAliases;

const procedureAliasLookup = Object.fromEntries(
  Object.entries(procedureAliasGroups).flatMap(([canonicalKey, aliases]) =>
    aliases.map((alias) => [normalizeLookupKey(alias), canonicalKey] as const),
  ),
) as Record<string, string>;

const suppressedProcedureAliasLookup = new Set(
  suppressedProcedureAliases.map((alias) => normalizeLookupKey(alias)).filter((alias): alias is string => Boolean(alias)),
);

const resolveProcedureFilterValues = (value: string) => {
  const lookupKey = normalizeLookupKey(value);
  if (!lookupKey) {
    return [value];
  }

  if (suppressedProcedureAliasLookup.has(lookupKey)) {
    return [];
  }

  const canonicalKey = procedureAliasLookup[lookupKey];
  if (!canonicalKey) {
    return [value];
  }

  return procedureAliasGroups[canonicalKey] ? [...procedureAliasGroups[canonicalKey]] : [canonicalKey];
};

const canonicalImplementationPathLabels: Record<string, string> = {
  winner_or_winners_progress_to_negotiated_service_award:
    "Winner or winners progress to negotiated service award",
  service_contract_award_after_competitive_selection:
    "Service contract award after competitive selection",
  framework_selection_for_repeated_design_commissions:
    "Framework selection for repeated design commissions",
};

const canonicalEvidenceLevelLabels: Record<string, string> = {
  official_notice: "Official notice",
  official_listing: "Official listing",
  authority_page: "Authority page",
  secondary: "Secondary source",
  tertiary: "Tertiary source",
};

const canonicalStatusLabels: Record<string, string> = {
  discovered: "Discovered",
  shortlisted: "Shortlisted",
  verified: "Verified",
  archived: "Archived",
  discarded: "Discarded",
};

const canonicalLabel = (
  value: string | null | undefined,
  labels: Record<string, string>,
  fallback: string,
) => {
  if (!value) {
    return fallback;
  }
  return labels[value] ?? titleCase(value);
};

const resolveProcedureTypePresentation = (value: string | null | undefined) => {
  const rawValue = compactText(value);
  if (!rawValue) {
    return {
      key: null,
      label: "Procedure pending",
    };
  }

  if (/[<>{}\[\]"]/u.test(rawValue)) {
    return {
      key: null,
      label: "Procedure pending",
    };
  }

  const lookupKey = normalizeLookupKey(rawValue);
  if (lookupKey && suppressedProcedureAliasLookup.has(lookupKey)) {
    return {
      key: null,
      label: "Procedure pending",
    };
  }

  if (lookupKey && Object.prototype.hasOwnProperty.call(procedureAliasLookup, lookupKey)) {
    const key = procedureAliasLookup[lookupKey];
    return {
      key,
      label: key ? canonicalLabel(key, canonicalProcedureLabels, "Procedure pending") : "Procedure pending",
    };
  }

  return {
    key: rawValue,
    label: titleCase(rawValue),
  };
};

const formatDeadline = (value: string | null) => {
  if (!value) {
    return "Deadline pending";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `Closes ${date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
};

const formatStamp = (value: string | null | undefined, prefix: string) => {
  if (!value) {
    return `${prefix} pending`;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return `${prefix} ${value}`;
  }

  return `${prefix} ${date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  })}`;
};

const formatDateOnly = (value: Date) => {
  const year = value.getFullYear();
  const month = `${value.getMonth() + 1}`.padStart(2, "0");
  const day = `${value.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const resolveTodayDate = () => {
  const override = process.env.ARCH_COMPETITION_TODAY?.trim();
  if (override && isoDatePattern.test(override)) {
    return override;
  }
  return formatDateOnly(new Date());
};

const normalizeIsoDate = (value: string | undefined) => {
  if (!value) {
    return undefined;
  }
  const normalizedValue = value.trim();
  return isoDatePattern.test(normalizedValue) ? normalizedValue : undefined;
};

type OpportunityClassification = {
  buildingCategories: StoredBuildingCategory[];
  projectType: StoredProjectType | null;
};

const detectBuildingCategories = (row: OpportunityRow) => {
  const competitionTypes = new Set(safeJsonArray(row.competition_types).map(normalizeMatchText));
  const haystack = normalizeMatchText(
    [row.title, row.eligibility_summary, row.authority_name, row.organizer].filter(Boolean).join(" "),
  );
  const categories = new Set<StoredBuildingCategory>();

  if (
    competitionTypes.has("healthcare") ||
    ["hospital", "clinic", "clinique", "ospedale", "ospedal", "healthcare", "medical"].some((keyword) =>
      haystack.includes(keyword),
    )
  ) {
    categories.add("healthcare");
  }

  if (
    competitionTypes.has("education") ||
    [
      "school",
      "schule",
      "scuola",
      "ecole",
      "college",
      "grundschule",
      "groupe scolaire",
      "campus scolaire",
    ].some((keyword) => haystack.includes(keyword))
  ) {
    categories.add("education");
  }

  if (
    competitionTypes.has("housing") ||
    ["housing", "logement", "wohn", "wohnung", "residential", "residenziale"].some((keyword) =>
      haystack.includes(keyword),
    )
  ) {
    categories.add("housing");
  }

  if (
    competitionTypes.has("public_building") ||
    [
      "library",
      "bibliothe",
      "town hall",
      "mairie",
      "rathaus",
      "feuerwache",
      "community centre",
      "community center",
      "begegnungszentrum",
      "cimiter",
      "cemeter",
    ].some((keyword) => haystack.includes(keyword))
  ) {
    categories.add("civic_public");
  }

  if (
    ["sport", "sportif", "sportivo", "stadium", "arena", "leisure", "loisir", "loisirs", "complexe sportif"].some(
      (keyword) => haystack.includes(keyword),
    )
  ) {
    categories.add("sport_leisure");
  }

  if (
    [
      "archaeolog",
      "museum",
      "heritage",
      "patrimoine",
      "restoration",
      "restauro",
      "restauro",
      "monument",
      "sanctuary",
    ].some((keyword) => haystack.includes(keyword))
  ) {
    categories.add("culture_heritage");
  }

  if (
    [
      "rail",
      "station",
      "tunnel",
      "bridge",
      "underbridge",
      "tram",
      "metro",
      "bahn",
      "transport",
      "passenger access",
    ].some((keyword) => haystack.includes(keyword))
  ) {
    categories.add("transport_infrastructure");
  }

  return buildingCategoryOrder.filter((category) => categories.has(category));
};

const classifyOpportunity = (row: OpportunityRow): OpportunityClassification => {
  const competitionTypes = new Set(safeJsonArray(row.competition_types).map(normalizeMatchText));
  const haystack = normalizeMatchText(
    [row.title, row.eligibility_summary, row.procedure_type, row.implementation_path].filter(Boolean).join(" "),
  );
  const buildingCategories = detectBuildingCategories(row);

  const isUrbanRegeneration =
    competitionTypes.has("adaptive_reuse") ||
    [
      "urban regeneration",
      "rigenerazione urbana",
      "renouvellement urbain",
      "adaptive reuse",
      "historic center",
      "centro storico",
    ].some((keyword) => haystack.includes(keyword));

  if (isUrbanRegeneration) {
    return {
      buildingCategories,
      projectType: "urban_regeneration",
    };
  }

  const isEnvironmentDesign =
    competitionTypes.has("landscape") ||
    ["landscape", "public realm", "park", "garden", "plaza", "square", "waterfront"].some((keyword) =>
      haystack.includes(keyword),
    );

  if (isEnvironmentDesign) {
    return {
      buildingCategories,
      projectType: "environment_design",
    };
  }

  const isUrbanPlanning =
    competitionTypes.has("masterplan") ||
    competitionTypes.has("urban_design") ||
    normalizeMatchText(row.procedure_type).includes("planning_competition") ||
    [
      "masterplan",
      "planning",
      "piano regolatore",
      "urban plan",
      "städtebau",
      "urbanisme",
    ].some((keyword) => haystack.includes(keyword));

  if (isUrbanPlanning) {
    return {
      buildingCategories,
      projectType: "urban_planning",
    };
  }

  const isBuildingProject =
    buildingCategories.length > 0 ||
    [
      "architecture",
      "public_building",
      "healthcare",
      "education",
      "housing",
      "infrastructure",
      "built_work",
      "interior",
    ].some((category) => competitionTypes.has(category));

  return {
    buildingCategories,
    projectType: isBuildingProject ? "building_project" : null,
  };
};

const matchesDerivedFilters = (row: OpportunityRow, filters: StoredOpportunityQuery) => {
  const requestedProjectTypes = filters.projectTypes ?? [];
  const requestedBuildingCategories = filters.buildingCategories ?? [];

  if (requestedProjectTypes.length === 0 && requestedBuildingCategories.length === 0) {
    return true;
  }

  const classification = classifyOpportunity(row);
  if (
    requestedProjectTypes.length > 0 &&
    (!classification.projectType || !requestedProjectTypes.includes(classification.projectType))
  ) {
    return false;
  }
  if (
    requestedBuildingCategories.length > 0 &&
    !requestedBuildingCategories.some((buildingCategory) =>
      classification.buildingCategories.includes(buildingCategory),
    )
  ) {
    return false;
  }

  return true;
};

const buildScopedFilterOptions = (
  rows: OpportunityRow[],
  filters: StoredOpportunityQuery = {},
): StoredFilterOptions => {
  const projectTypes = new Set<StoredProjectType>(filters.projectTypes ?? []);
  const buildingCategories = new Set<StoredBuildingCategory>(filters.buildingCategories ?? []);
  const jurisdictions = new Set<string>();
  const procedureTypes = new Set<string>();
  const implementationPaths = new Set<string>();

  if (filters.jurisdiction) {
    jurisdictions.add(filters.jurisdiction);
  }
  if (filters.procedureType) {
    const selectedProcedure = resolveProcedureTypePresentation(filters.procedureType).key;
    if (selectedProcedure) {
      procedureTypes.add(selectedProcedure);
    }
  }
  if (filters.implementationPath) {
    implementationPaths.add(filters.implementationPath);
  }

  for (const row of rows) {
    const classification = classifyOpportunity(row);
    if (classification.projectType) {
      projectTypes.add(classification.projectType);
    }
    for (const category of classification.buildingCategories) {
      buildingCategories.add(category);
    }

    const jurisdiction = compactText(row.jurisdiction);
    if (jurisdiction) {
      jurisdictions.add(jurisdiction);
    }

    const procedure = resolveProcedureTypePresentation(row.procedure_type).key;
    if (procedure) {
      procedureTypes.add(procedure);
    }

    const implementationPath = compactText(row.implementation_path);
    if (implementationPath) {
      implementationPaths.add(implementationPath);
    }
  }

  return {
    buildingCategories: buildingCategoryOrder.filter((category) => buildingCategories.has(category)),
    jurisdictions: [...jurisdictions].sort((left, right) => left.localeCompare(right)),
    projectTypes: projectTypeOrder.filter((projectType) => projectTypes.has(projectType)),
    procedureTypes: [...procedureTypes].sort((left, right) => left.localeCompare(right)),
    implementationPaths: [...implementationPaths].sort((left, right) => left.localeCompare(right)),
  };
};

const formatFee = (registrationFee: number | null, submissionFee: number | null) => {
  if ((registrationFee ?? 0) === 0 && (submissionFee ?? 0) === 0) {
    return "No participation fee";
  }

  const parts: string[] = [];
  if (registrationFee !== null) {
    parts.push(`EUR ${registrationFee.toFixed(0)} registration`);
  }
  if (submissionFee !== null) {
    parts.push(`EUR ${submissionFee.toFixed(0)} submission`);
  }
  return parts.join(" / ") || "Fee pending";
};

const formatContractValue = (
  value: number | null,
  valueText: string | null,
  prizeSummary: string | null,
) => {
  if (value !== null) {
    return `Estimated service value EUR ${(value / 1_000_000).toFixed(2)}M`;
  }
  if (valueText) {
    return valueText;
  }
  if (prizeSummary) {
    return prizeSummary;
  }
  return "Commercial value pending";
};

const formatQualification = (
  licensedArchitectRequired: number | null,
  localPartnerRequired: number | null,
  eligibilitySummary: string | null,
) => {
  const parts: string[] = [];
  if (licensedArchitectRequired === 1) {
    parts.push("Licensed architect required");
  }
  if (localPartnerRequired === 1) {
    parts.push("Local partner likely");
  }
  if (parts.length > 0) {
    return parts.join(" · ");
  }
  return eligibilitySummary ?? "Qualification pending";
};

const buildSubtitle = (row: OpportunityRow) => {
  const authority = row.authority_name ?? row.organizer ?? "Unnamed authority";
  const procedure = resolveProcedureTypePresentation(row.procedure_type);
  return `${authority} · ${procedure.label}`;
};

const buildDescription = (row: OpportunityRow) => {
  const implementation = canonicalLabel(
    row.implementation_path,
    canonicalImplementationPathLabels,
    "Implementation path pending",
  );
  const evidence = canonicalLabel(
    row.evidence_level,
    canonicalEvidenceLevelLabels,
    "Evidence level pending",
  );
  return `Implementation path: ${implementation}. Evidence level: ${evidence}.`;
};

const toBoolean = (value: number | null) => {
  if (value === null) {
    return null;
  }
  return value === 1;
};

const toOpportunity = (row: OpportunityRow): ProfessionalOpportunity => {
  const competitionTypes = safeJsonArray(row.competition_types);
  const cpvCodes = safeJsonArray(row.cpv_codes);
  const tags = [...competitionTypes.map(titleCase), ...cpvCodes].slice(0, 4);
  const procedure = resolveProcedureTypePresentation(row.procedure_type);

  return {
    id: row.id,
    slug: row.id,
    title: row.title,
    subtitle: buildSubtitle(row),
    authorityName: row.authority_name ?? row.organizer ?? "Unknown authority",
    jurisdictionLabel: titleCase(row.jurisdiction),
    opportunityTypeLabel: canonicalLabel(
      row.opportunity_type,
      canonicalOpportunityTypeLabels,
      "Opportunity type pending",
    ),
    procedureTypeLabel: procedure.label,
    implementationPathLabel: canonicalLabel(
      row.implementation_path,
      canonicalImplementationPathLabels,
      "Implementation path pending",
    ),
    statusLabel: canonicalLabel(row.status, canonicalStatusLabels, "Status pending"),
    deadlineLabel: formatDeadline(row.deadline_at),
    feeLabel: formatFee(row.registration_fee_eur, row.submission_fee_eur),
    contractValueLabel: formatContractValue(
      row.estimated_contract_value_eur,
      row.estimated_contract_value_text,
      row.prize_summary,
    ),
    qualificationLabel: formatQualification(
      row.licensed_architect_required,
      row.local_partner_required,
      row.eligibility_summary,
    ),
    sourceTierLabel:
      row.evidence_level === "official_notice" || row.evidence_level === "official_listing"
        ? "Primary official source"
        : "Secondary source",
    evidenceLevelLabel: canonicalLabel(
      row.evidence_level,
      canonicalEvidenceLevelLabels,
      "Evidence level pending",
    ),
    tags: tags.length > 0 ? tags : ["Procurement-backed"],
    description: buildDescription(row),
    eligibilitySummary: row.eligibility_summary ?? "",
    evidenceNote: row.evidence_note ?? "",
    officialUrl: row.official_url ?? row.source_url,
  };
};

const toOpportunityFeedItem = (row: OpportunityRow): StoredOpportunityFeedItem => {
  const base = toOpportunity(row);
  const procedure = resolveProcedureTypePresentation(row.procedure_type);
  const classification = classifyOpportunity(row);

  return {
    ...base,
    audience: safeJsonArray(row.audience),
    buildingCategories: classification.buildingCategories,
    briefPdfUrl: row.brief_pdf_url,
    competitionTypes: safeJsonArray(row.competition_types),
    cpvCodes: safeJsonArray(row.cpv_codes),
    deadlineAt: row.deadline_at,
    discoveredAt: row.discovered_at,
    discoveredLabel: formatStamp(row.discovered_at, "Captured"),
    documentsPortalUrl: row.documents_portal_url,
    estimatedContractValueEur: row.estimated_contract_value_eur,
    estimatedContractValueText: row.estimated_contract_value_text,
    evidenceLevelKey: row.evidence_level,
    extractionConfidence: row.extraction_confidence,
    geoConfidence: row.geo_confidence,
    geoLat: row.geo_lat,
    geoLng: row.geo_lng,
    geoSource: row.geo_source,
    implementationPathKey: row.implementation_path,
    jurisdictionKey: row.jurisdiction,
    languages: safeJsonArray(row.languages),
    licensedArchitectRequired: toBoolean(row.licensed_architect_required),
    locationLabel: row.location_label,
    localPartnerRequired: toBoolean(row.local_partner_required),
    officialNoticeId: row.official_notice_id,
    opportunityTypeKey: row.opportunity_type,
    organizerName: row.organizer ?? "Unknown organizer",
    prizeSummary: row.prize_summary,
    projectTypeKey: classification.projectType,
    procedureTypeKey: procedure.key,
    qualificationScore: row.qualification_score,
    regions: safeJsonArray(row.regions),
    registrationFeeEur: row.registration_fee_eur,
    sourceUrl: row.source_url,
    statusKey: row.status,
    submissionFeeEur: row.submission_fee_eur,
    updatedAt: row.updated_at,
    updatedLabel: formatStamp(row.updated_at, "Updated"),
  };
};

const toProfessionalOpportunity = ({
  audience: _audience,
  buildingCategories: _buildingCategories,
  briefPdfUrl: _briefPdfUrl,
  competitionTypes: _competitionTypes,
  cpvCodes: _cpvCodes,
  deadlineAt: _deadlineAt,
  discoveredAt: _discoveredAt,
  discoveredLabel: _discoveredLabel,
  documentsPortalUrl: _documentsPortalUrl,
  estimatedContractValueEur: _estimatedContractValueEur,
  estimatedContractValueText: _estimatedContractValueText,
  evidenceLevelKey: _evidenceLevelKey,
  extractionConfidence: _extractionConfidence,
  geoConfidence: _geoConfidence,
  geoLat: _geoLat,
  geoLng: _geoLng,
  geoSource: _geoSource,
  implementationPathKey: _implementationPathKey,
  jurisdictionKey: _jurisdictionKey,
  languages: _languages,
  licensedArchitectRequired: _licensedArchitectRequired,
  locationLabel: _locationLabel,
  localPartnerRequired: _localPartnerRequired,
  officialNoticeId: _officialNoticeId,
  opportunityTypeKey: _opportunityTypeKey,
  organizerName: _organizerName,
  prizeSummary: _prizeSummary,
  projectTypeKey: _projectTypeKey,
  procedureTypeKey: _procedureTypeKey,
  qualificationScore: _qualificationScore,
  regions: _regions,
  registrationFeeEur: _registrationFeeEur,
  sourceUrl: _sourceUrl,
  statusKey: _statusKey,
  submissionFeeEur: _submissionFeeEur,
  updatedAt: _updatedAt,
  updatedLabel: _updatedLabel,
  ...opportunity
}: StoredOpportunityFeedItem): ProfessionalOpportunity => opportunity;

const readRows = <T>(statement: string, parameters: SqlParameter[] = []) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    return [] as T[];
  }

  const database = new Database(sqlitePath, { readonly: true });

  try {
    return database.prepare(statement).all(...parameters) as T[];
  } finally {
    database.close();
  }
};

const readRow = <T>(statement: string, parameters: SqlParameter[] = []) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    return undefined;
  }

  const database = new Database(sqlitePath, { readonly: true });

  try {
    return database.prepare(statement).get(...parameters) as T | undefined;
  } finally {
    database.close();
  }
};

const hasColumn = (tableName: string, columnName: string) => {
  try {
    return readRows<{ name: string }>(`PRAGMA table_info(${tableName})`).some(
      (row) => row.name === columnName,
    );
  } catch {
    return false;
  }
};

const hasTable = (tableName: string) => {
  try {
    const row = readRow<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    return Boolean(row?.name);
  } catch {
    return false;
  }
};

const buildOpportunitySelectList = () => {
  if (hasColumn("competitions", "geo_lat")) {
    return "*";
  }

  return `
    *,
    NULL AS location_label,
    NULL AS geo_lat,
    NULL AS geo_lng,
    NULL AS geo_source,
    NULL AS geo_confidence
  `;
};

export const hasStoredOpportunities = () => {
  try {
    const row = readRow<{ total: number }>("SELECT COUNT(*) AS total FROM competitions");
    return (row?.total ?? 0) > 0;
  } catch {
    return false;
  }
};

export const getStoredOpportunities = (limit = 24): ProfessionalOpportunity[] => {
  return queryStoredOpportunities({ limit });
};

const buildOpportunityWhereClause = ({
  includeExpired,
  deadlineAfter,
  deadlineBefore,
  implementationPath,
  jurisdiction,
  licensedArchitectRequired,
  maxEstimatedValueEur,
  minEstimatedValueEur,
  minQualificationScore,
  publishedWithinDays,
  procedureType,
  search,
}: StoredOpportunityQuery) => {
  const conditions: string[] = [];
  const parameters: SqlParameter[] = [];
  const normalizedDeadlineAfter = normalizeIsoDate(deadlineAfter);
  const today = resolveTodayDate();

  if (search) {
    const normalizedSearch = `%${search.trim().toLowerCase()}%`;
    if (normalizedSearch !== "%%") {
      conditions.push(`
        (
          LOWER(title) LIKE ?
          OR LOWER(COALESCE(authority_name, '')) LIKE ?
          OR LOWER(COALESCE(organizer, '')) LIKE ?
          OR LOWER(COALESCE(official_notice_id, '')) LIKE ?
        )
      `);
      parameters.push(normalizedSearch, normalizedSearch, normalizedSearch, normalizedSearch);
    }
  }
  if (jurisdiction) {
    conditions.push("jurisdiction = ?");
    parameters.push(jurisdiction);
  }
  if (procedureType) {
    const procedureFilterValues = resolveProcedureFilterValues(procedureType);
    if (procedureFilterValues.length === 0) {
      conditions.push("1 = 0");
    } else if (procedureFilterValues.length === 1) {
      conditions.push("procedure_type = ?");
      parameters.push(procedureFilterValues[0]);
    } else {
      conditions.push(`procedure_type IN (${procedureFilterValues.map(() => "?").join(", ")})`);
      parameters.push(...procedureFilterValues);
    }
  }
  if (implementationPath) {
    conditions.push("implementation_path = ?");
    parameters.push(implementationPath);
  }
  if (licensedArchitectRequired !== undefined) {
    conditions.push("licensed_architect_required = ?");
    parameters.push(licensedArchitectRequired ? 1 : 0);
  }
  if (minQualificationScore !== undefined) {
    conditions.push("COALESCE(qualification_score, 0) >= ?");
    parameters.push(minQualificationScore);
  }
  if (publishedWithinDays !== undefined) {
    const threshold = new Date(Date.now() - publishedWithinDays * 24 * 60 * 60 * 1000).toISOString();
    conditions.push("discovered_at >= ?");
    parameters.push(threshold);
  }
  if (includeExpired === true) {
    conditions.push("status != 'discarded'");
  } else {
    conditions.push("status NOT IN ('archived', 'discarded')");
  }
  if (includeExpired === true) {
    if (normalizedDeadlineAfter) {
      conditions.push("deadline_at >= ?");
      parameters.push(normalizedDeadlineAfter);
    }
  } else if (normalizedDeadlineAfter) {
    conditions.push("deadline_at >= ?");
    parameters.push(normalizedDeadlineAfter >= today ? normalizedDeadlineAfter : today);
  } else {
    conditions.push("(deadline_at IS NULL OR deadline_at >= ?)");
    parameters.push(today);
  }
  if (deadlineBefore) {
    conditions.push("deadline_at <= ?");
    parameters.push(deadlineBefore);
  }
  if (minEstimatedValueEur !== undefined) {
    conditions.push("COALESCE(estimated_contract_value_eur, 0) >= ?");
    parameters.push(minEstimatedValueEur);
  }
  if (maxEstimatedValueEur !== undefined) {
    conditions.push("COALESCE(estimated_contract_value_eur, 0) <= ?");
    parameters.push(maxEstimatedValueEur);
  }

  return {
    parameters,
    whereClause: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
  };
};

const buildSortClause = (sort: StoredOpportunityQuery["sort"]) => {
  if (sort === "latest") {
    return "updated_at DESC, COALESCE(qualification_score, 0) DESC";
  }
  if (sort === "highest_value") {
    return "COALESCE(estimated_contract_value_eur, 0) DESC, COALESCE(qualification_score, 0) DESC, updated_at DESC";
  }
  return "COALESCE(deadline_at, '9999-12-31') ASC, COALESCE(qualification_score, 0) DESC, updated_at DESC";
};

const queryVisibleOpportunityRows = (
  {
    sort = "deadline",
    ...filters
  }: Omit<StoredOpportunityQuery, "limit"> = {},
  sqlLimit?: number,
) => {
  if (!hasStoredOpportunities()) {
    return [] as OpportunityRow[];
  }

  const { parameters, whereClause } = buildOpportunityWhereClause(filters);
  const hasDerivedFilters = Boolean(
    (filters.projectTypes?.length ?? 0) > 0 || (filters.buildingCategories?.length ?? 0) > 0,
  );
  const useSqlLimit = !hasDerivedFilters && sqlLimit !== undefined;
  const rows = readRows<OpportunityRow>(
    `
      SELECT ${buildOpportunitySelectList()}
      FROM competitions
      ${whereClause}
      ORDER BY ${buildSortClause(sort)}
      ${useSqlLimit ? "LIMIT ?" : ""}
    `,
    useSqlLimit ? [...parameters, sqlLimit] : parameters,
  );

  if (rows.length === 0) {
    return [];
  }

  return hasDerivedFilters ? rows.filter((row) => matchesDerivedFilters(row, filters)) : rows;
};

export const queryStoredOpportunityFeed = ({
  limit = 24,
  sort = "deadline",
  ...filters
}: StoredOpportunityQuery = {}): StoredOpportunityFeedItem[] => {
  const rows = queryVisibleOpportunityRows({ sort, ...filters }, limit);
  if (rows.length === 0) {
    return [];
  }
  return rows.slice(0, limit).map(toOpportunityFeedItem);
};

export const queryStoredOpportunities = (query: StoredOpportunityQuery = {}): ProfessionalOpportunity[] => {
  return queryStoredOpportunityFeed(query).map(toProfessionalOpportunity);
};

export const getStoredOpportunityFeedItemBySlug = (slug: string) => {
  if (!hasStoredOpportunities()) {
    return undefined;
  }

  const row = readRow<OpportunityRow>(
    `SELECT ${buildOpportunitySelectList()} FROM competitions WHERE id = ?`,
    [slug],
  );
  return row ? toOpportunityFeedItem(row) : undefined;
};

export const getStoredOpportunityBySlug = (slug: string) => {
  const feedItem = getStoredOpportunityFeedItemBySlug(slug);
  return feedItem ? toProfessionalOpportunity(feedItem) : undefined;
};

export const getStoredRadarSnapshot = () => {
  return getRadarSnapshot(getStoredOpportunities());
};

export const getStoredOpsSnapshot = () => {
  if (!hasStoredOpportunities()) {
    return {
      total: 0,
      verified: 0,
      primary: 0,
    };
  }

  const row = readRow<{
    total: number;
    verified: number;
    primary_count: number;
  }>(
    `
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS verified,
        SUM(CASE WHEN evidence_level IN ('official_notice', 'official_listing') THEN 1 ELSE 0 END) AS primary_count
      FROM competitions
    `,
  );

  return {
    total: row?.total ?? 0,
    verified: row?.verified ?? 0,
    primary: row?.primary_count ?? 0,
  };
};

type SourceHealthRow = {
  source_id: string;
  source_name: string;
  source_kind: string;
  source_tier: string;
  last_status: string;
  last_run_started_at: string | null;
  last_run_completed_at: string | null;
  last_success_at: string | null;
  last_document_count: number;
  last_upserted_count: number;
  last_parse_failure_count: number;
  duplicate_group_count: number;
  max_duplicate_group_size: number;
  last_error: string | null;
};

export const getStoredSourceHealth = (limit = 20): StoredSourceHealthItem[] => {
  if (!hasTable("source_health")) {
    return [];
  }

  try {
    const rows = readRows<SourceHealthRow>(
      `
        SELECT
          source_id,
          source_name,
          source_kind,
          source_tier,
          last_status,
          last_run_started_at,
          last_run_completed_at,
          last_success_at,
          last_document_count,
          last_upserted_count,
          last_parse_failure_count,
          duplicate_group_count,
          max_duplicate_group_size,
          last_error
        FROM source_health
        ORDER BY
          CASE
            WHEN last_status = 'failed' THEN 0
            WHEN COALESCE(last_parse_failure_count, 0) > 0 THEN 1
            WHEN COALESCE(duplicate_group_count, 0) > 0 THEN 2
            ELSE 3
          END ASC,
          COALESCE(last_run_completed_at, last_success_at, '') ASC,
          source_name ASC
        LIMIT ?
      `,
      [limit],
    );

    return rows.map((row) => ({
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceKind: row.source_kind,
      sourceTier: row.source_tier,
      lastStatus: row.last_status,
      lastRunStartedAt: row.last_run_started_at,
      lastRunCompletedAt: row.last_run_completed_at,
      lastSuccessAt: row.last_success_at,
      lastDocumentCount: row.last_document_count,
      lastUpsertedCount: row.last_upserted_count,
      lastParseFailureCount: row.last_parse_failure_count,
      duplicateGroupCount: row.duplicate_group_count,
      maxDuplicateGroupSize: row.max_duplicate_group_size,
      lastError: row.last_error,
    }));
  } catch {
    return [];
  }
};

export const getStoredDuplicatePressureSummary = (): StoredDuplicatePressureSummary => {
  if (!hasStoredOpportunities()) {
    return {
      duplicateGroups: 0,
      recordsInDuplicateGroups: 0,
      maxDuplicateGroupSize: 0,
    };
  }

  const row = readRow<StoredDuplicatePressureSummary>(
    `
      WITH duplicate_groups AS (
        SELECT COUNT(*) AS duplicate_count
        FROM competitions
        GROUP BY dedup_key
        HAVING COUNT(*) > 1
      )
      SELECT
        COUNT(*) AS duplicateGroups,
        COALESCE(SUM(duplicate_count), 0) AS recordsInDuplicateGroups,
        COALESCE(MAX(duplicate_count), 0) AS maxDuplicateGroupSize
      FROM duplicate_groups
    `,
  );

  return {
    duplicateGroups: row?.duplicateGroups ?? 0,
    recordsInDuplicateGroups: row?.recordsInDuplicateGroups ?? 0,
    maxDuplicateGroupSize: row?.maxDuplicateGroupSize ?? 0,
  };
};

const emptyFilterOptions = (): StoredFilterOptions => ({
  buildingCategories: [],
  jurisdictions: [],
  projectTypes: [],
  procedureTypes: [],
  implementationPaths: [],
});

export const getStoredFilterOptions = (filters: StoredOpportunityQuery = {}): StoredFilterOptions => {
  const rows = queryVisibleOpportunityRows(filters);
  return buildScopedFilterOptions(rows, filters);
};

export const getStoredDiscoverSurfaceData = ({
  limit = 24,
  sort = "deadline",
  ...filters
}: StoredOpportunityQuery = {}): StoredDiscoverSurfaceData => {
  const rows = queryVisibleOpportunityRows({ sort, ...filters });
  if (rows.length === 0) {
    return {
      filterOptions: emptyFilterOptions(),
      opportunities: [],
    };
  }

  return {
    filterOptions: buildScopedFilterOptions(rows, filters),
    opportunities: rows.slice(0, limit).map(toOpportunityFeedItem),
  };
};

export {
  STORED_OPS_REVIEW_ORIGINS,
  STORED_OPS_REVIEW_REASON_CODES,
  STORED_OPS_REVIEW_STATUSES,
  getStoredOpsReviewSummary,
  queryStoredOpsReviewQueue,
  writeStoredOpsReviewDecision,
  type StoredOpsReviewDecisionInput,
  type StoredOpsReviewDecisionStatus,
  type StoredOpsReviewOrigin,
  type StoredOpsReviewQueueItem,
  type StoredOpsReviewQueueQuery,
  type StoredOpsReviewReasonCode,
  type StoredOpsReviewSummary,
} from "./ops-review";

export {
  StoredAuthError,
  authenticateStoredAuthUser,
  countStoredAuthUsers,
  createStoredAuthSession,
  createStoredAuthUser,
  deleteStoredAuthSession,
  deleteStoredAuthSessionsForUser,
  getStoredAuthSession,
  type StoredAuthErrorCode,
  type StoredAuthLoginInput,
  type StoredAuthSession,
  type StoredAuthSessionCreateInput,
  type StoredAuthSessionWithToken,
  type StoredAuthUser,
  type StoredAuthUserCreateInput,
} from "./auth";

export {
  createStoredSavedSearch,
  createStoredWatchlistEntry,
  deleteStoredSavedSearch,
  deleteStoredWatchlistEntry,
  isStoredOpportunityWatched,
  listStoredWatchedOpportunityIds,
  queryStoredSavedSearches,
  queryStoredWatchlistEntries,
  type StoredSavedSearch,
  type StoredSavedSearchCreateInput,
  type StoredSavedSearchDeleteInput,
  type StoredSavedSearchQuery,
  type StoredWatchlistEntry,
  type StoredWatchlistEntryCreateInput,
  type StoredWatchlistEntryDeleteInput,
  type StoredWatchlistEntryQuery,
} from "./watchlists";
