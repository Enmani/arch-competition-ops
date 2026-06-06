import type { ProfessionalOpportunity } from "@arch-competition/core";

type SqlParameter = string | number | null;

type D1RunResult = {
  meta?: {
    changes?: number;
    last_row_id?: number | string;
  };
};

type D1StatementLike = {
  all<T = unknown>(): Promise<{ results?: T[] }>;
  bind(...values: SqlParameter[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1RunResult>;
};

export type D1DatabaseLike = {
  prepare(statement: string): D1StatementLike;
};

const combiningDiacriticPattern = /[\u0300-\u036f]/g;

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
  project_types: string | null;
  building_categories: string | null;
  official_sectors: string | null;
  built_asset_types: string | null;
  design_scopes: string | null;
  project_modes: string | null;
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

export type StoredProjectType =
  | "urban_regeneration"
  | "environment_design"
  | "urban_planning"
  | "interior_project"
  | "building_project";
export type StoredBuildingCategory =
  | "healthcare"
  | "education"
  | "housing"
  | "civic_public"
  | "sport_leisure"
  | "culture_heritage"
  | "transport_infrastructure";
export type StoredDesignScope =
  | "interior_design"
  | "architectural_design"
  | "scheme"
  | "preliminary"
  | "construction_docs"
  | "planning"
  | "design_service";
export type StoredProjectMode = "new_build" | "renovation" | "extension";
export type StoredOpportunityQuery = {
  buildingCategories?: StoredBuildingCategory[];
  designScopes?: StoredDesignScope[];
  includeExpired?: boolean;
  deadlineAfter?: string;
  deadlineBefore?: string;
  implementationPath?: string;
  jurisdiction?: string;
  limit?: number;
  offset?: number;
  licensedArchitectRequired?: boolean;
  maxEstimatedValueEur?: number;
  minEstimatedValueEur?: number;
  minQualificationScore?: number;
  publishedWithinDays?: number;
  projectTypes?: StoredProjectType[];
  projectModes?: StoredProjectMode[];
  procedureType?: string;
  search?: string;
  sort?: "deadline" | "highest_value" | "latest";
};
export type StoredFilterOptions = {
  buildingCategories: StoredBuildingCategory[];
  designScopes: StoredDesignScope[];
  implementationPaths: string[];
  jurisdictions: string[];
  projectModes: StoredProjectMode[];
  projectTypes: StoredProjectType[];
  procedureTypes: string[];
};
export type StoredDiscoverSurfaceData = {
  filterOptions: StoredFilterOptions;
  opportunities: StoredOpportunityFeedItem[];
  total: number;
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
  officialSectors: string[];
  builtAssetTypes: string[];
  designScopes: string[];
  projectModes: string[];
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

const isoDatePattern = /^\d{4}-\d{2}-\d{2}$/;
const projectTypeOrder: StoredProjectType[] = [
  "urban_regeneration",
  "environment_design",
  "urban_planning",
  "interior_project",
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
const designScopeOrder: StoredDesignScope[] = [
  "interior_design",
  "architectural_design",
  "scheme",
  "preliminary",
  "construction_docs",
  "planning",
  "design_service",
];
const projectModeOrder: StoredProjectMode[] = ["new_build", "renovation", "extension"];
const procedureAliasGroups: Record<string, readonly string[]> = {
  design_contest: ["design_contest", "project_competition"],
  planning_competition: ["planning_competition"],
  selective: ["selective"],
  maitrise_d_oeuvre_procurement: [
    "maitrise_d_oeuvre_procurement",
    "maitrise_doeuvre_procurement",
  ],
  public_design_services_tender: [
    "public_design_services_tender",
    "ANNOUNCEMENT_OF_COMPETITION",
    "request_for_proposals",
    "request_for_tender",
    "request_for_quotes",
    "official_procurement_notice",
    "authority_profile_notice",
    "anac_public_notice",
    "Avviso",
    "P1",
  ],
  framework_agreement: ["framework_agreement", "framework"],
  open: [
    "open",
    "open_procedure",
    "Offenes Verfahren",
    "Procédure Ouverte",
    "Competitive - Open bidding",
    "Open procedure (above threshold)",
    "Open procedure (below threshold)",
    "Abierto",
    "UVgO/VgV, Offenes Verfahren",
  ],
  negotiated_procedure: ["negotiated_procedure", "Procédure Négociée"],
  adapted_procedure: ["adapted_procedure", "Procédure Adaptée"],
  "neg-w-call": ["neg-w-call", "Verhandlungsverfahren mit Teilnahmewettbewerb"],
  "neg-wo-call": ["neg-wo-call", "Single tender action (below threshold)"],
};
const suppressedProcedureAliases = ["secondary_discovery_listing", "AD3", "Altri avvisi"];

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
    .replace(combiningDiacriticPattern, "")
    .toLowerCase();

const compactText = (value: string | null | undefined) => {
  if (!value) {
    return null;
  }

  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length > 0 ? collapsed : null;
};

const normalizeOpportunitySlugLookup = (slug: string) => {
  const candidates = [slug];

  try {
    const decodedSlug = decodeURIComponent(slug);
    if (decodedSlug !== slug) {
      candidates.push(decodedSlug);
    }
  } catch {
    // Keep the original slug when a request contains malformed percent encoding.
  }

  return candidates;
};

const normalizeLookupKey = (value: string | null | undefined) => {
  const compacted = compactText(value);
  if (!compacted) {
    return null;
  }

  return compacted
    .normalize("NFD")
    .replace(combiningDiacriticPattern, "")
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
  const override = typeof process !== "undefined" ? process.env.ARCH_COMPETITION_TODAY?.trim() : undefined;
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
  designScopes: StoredDesignScope[];
  projectTypes: StoredProjectType[];
  projectModes: StoredProjectMode[];
};

const detectBuildingCategories = (row: OpportunityRow) => {
  const explicitCategories = safeJsonArray(row.building_categories).filter(
    (item): item is StoredBuildingCategory =>
      buildingCategoryOrder.includes(item as StoredBuildingCategory),
  );
  if (explicitCategories.length > 0) {
    return buildingCategoryOrder.filter((category) => explicitCategories.includes(category));
  }

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
  const explicitDesignScopes = safeJsonArray(row.design_scopes).filter(
    (item): item is StoredDesignScope => designScopeOrder.includes(item as StoredDesignScope),
  );
  const explicitProjectModes = safeJsonArray(row.project_modes).filter(
    (item): item is StoredProjectMode => projectModeOrder.includes(item as StoredProjectMode),
  );
  const explicitProjectTypes = safeJsonArray(row.project_types).filter(
    (item): item is StoredProjectType => projectTypeOrder.includes(item as StoredProjectType),
  );
  if (explicitProjectTypes.length > 0) {
    return {
      buildingCategories: detectBuildingCategories(row),
      designScopes: explicitDesignScopes,
      projectTypes: projectTypeOrder.filter((projectType) => explicitProjectTypes.includes(projectType)),
      projectModes: explicitProjectModes,
    };
  }

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
      designScopes: explicitDesignScopes,
      projectTypes: ["urban_regeneration"],
      projectModes: explicitProjectModes,
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
      designScopes: explicitDesignScopes,
      projectTypes: ["environment_design"],
      projectModes: explicitProjectModes,
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
      designScopes: explicitDesignScopes,
      projectTypes: ["urban_planning"],
      projectModes: explicitProjectModes,
    };
  }

  const isInteriorProject =
    competitionTypes.has("interior") ||
    [
      "interior",
      "interiors",
      "fit out",
      "fit-out",
      "refit",
      "室内",
      "精装修",
      "公区",
      "软装",
    ].some((keyword) => haystack.includes(keyword));

  if (isInteriorProject) {
    return {
      buildingCategories,
      designScopes: explicitDesignScopes,
      projectTypes: ["interior_project"],
      projectModes: explicitProjectModes,
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
    designScopes: explicitDesignScopes,
    projectTypes: isBuildingProject ? ["building_project"] : [],
    projectModes: explicitProjectModes,
  };
};

const matchesDerivedFilters = (row: OpportunityRow, filters: StoredOpportunityQuery) => {
  const requestedProjectTypes = filters.projectTypes ?? [];
  const requestedBuildingCategories = filters.buildingCategories ?? [];
  const requestedDesignScopes = filters.designScopes ?? [];
  const requestedProjectModes = filters.projectModes ?? [];

  if (
    requestedProjectTypes.length === 0 &&
    requestedBuildingCategories.length === 0 &&
    requestedDesignScopes.length === 0 &&
    requestedProjectModes.length === 0
  ) {
    return true;
  }

  const classification = classifyOpportunity(row);
  if (
    requestedProjectTypes.length > 0 &&
    !requestedProjectTypes.some((projectType) => classification.projectTypes.includes(projectType))
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
  if (
    requestedDesignScopes.length > 0 &&
    !requestedDesignScopes.some((designScope) => classification.designScopes.includes(designScope))
  ) {
    return false;
  }
  if (
    requestedProjectModes.length > 0 &&
    !requestedProjectModes.some((projectMode) => classification.projectModes.includes(projectMode))
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
  const designScopes = new Set<StoredDesignScope>(filters.designScopes ?? []);
  const jurisdictions = new Set<string>();
  const procedureTypes = new Set<string>();
  const implementationPaths = new Set<string>();
  const projectModes = new Set<StoredProjectMode>(filters.projectModes ?? []);

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
    for (const projectType of classification.projectTypes) {
      projectTypes.add(projectType);
    }
    for (const category of classification.buildingCategories) {
      buildingCategories.add(category);
    }
    for (const designScope of classification.designScopes) {
      designScopes.add(designScope);
    }
    for (const projectMode of classification.projectModes) {
      projectModes.add(projectMode);
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
    designScopes: designScopeOrder.filter((designScope) => designScopes.has(designScope)),
    jurisdictions: [...jurisdictions].sort((left, right) => left.localeCompare(right)),
    projectModes: projectModeOrder.filter((projectMode) => projectModes.has(projectMode)),
    projectTypes: projectTypeOrder.filter((projectType) => projectTypes.has(projectType)),
    procedureTypes: [...procedureTypes].sort((left, right) => left.localeCompare(right)),
    implementationPaths: [...implementationPaths].sort((left, right) => left.localeCompare(right)),
  };
};

const formatFee = (registrationFee: number | null, submissionFee: number | null) => {
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
    officialSectors: safeJsonArray(row.official_sectors),
    builtAssetTypes: safeJsonArray(row.built_asset_types),
    designScopes: classification.designScopes,
    projectModes: classification.projectModes,
    opportunityTypeKey: row.opportunity_type,
    organizerName: row.organizer ?? "Unknown organizer",
    prizeSummary: row.prize_summary,
    projectTypeKey: classification.projectTypes[0] ?? null,
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
  officialSectors: _officialSectors,
  builtAssetTypes: _builtAssetTypes,
  designScopes: _designScopes,
  projectModes: _projectModes,
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

const bindStatement = (database: D1DatabaseLike, statement: string, parameters: SqlParameter[] = []) => {
  const preparedStatement = database.prepare(statement);
  return parameters.length > 0 ? preparedStatement.bind(...parameters) : preparedStatement;
};

const readRows = async <T>(
  database: D1DatabaseLike,
  statement: string,
  parameters: SqlParameter[] = [],
) => {
  const result = await bindStatement(database, statement, parameters).all<T>();
  return (result.results ?? []) as T[];
};

const readRow = async <T>(
  database: D1DatabaseLike,
  statement: string,
  parameters: SqlParameter[] = [],
) => {
  return (await bindStatement(database, statement, parameters).first<T>()) ?? undefined;
};

const runStatement = async (
  database: D1DatabaseLike,
  statement: string,
  parameters: SqlParameter[] = [],
) => bindStatement(database, statement, parameters).run();

const hasTable = async (database: D1DatabaseLike, tableName: string) => {
  try {
    const row = await readRow<{ name: string }>(
      database,
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    return Boolean(row?.name);
  } catch {
    return false;
  }
};

const hasColumn = async (database: D1DatabaseLike, tableName: string, columnName: string) => {
  try {
    const rows = await readRows<{ name: string }>(database, `PRAGMA table_info(${tableName})`);
    return rows.some((row) => row.name === columnName);
  } catch {
    return false;
  }
};

const buildOpportunitySelectList = async (database: D1DatabaseLike) => {
  const hasGeoColumns = await hasColumn(database, "competitions", "geo_lat");
  const hasClassificationColumns = await hasColumn(database, "competitions", "project_types");

  if (hasGeoColumns && hasClassificationColumns) {
    return "*";
  }

  return `
    *,
    ${hasClassificationColumns ? "project_types" : "NULL AS project_types"},
    ${hasClassificationColumns ? "building_categories" : "NULL AS building_categories"},
    ${hasClassificationColumns ? "official_sectors" : "NULL AS official_sectors"},
    ${hasClassificationColumns ? "built_asset_types" : "NULL AS built_asset_types"},
    ${hasClassificationColumns ? "design_scopes" : "NULL AS design_scopes"},
    ${hasClassificationColumns ? "project_modes" : "NULL AS project_modes"},
    ${hasGeoColumns ? "location_label" : "NULL AS location_label"},
    ${hasGeoColumns ? "geo_lat" : "NULL AS geo_lat"},
    ${hasGeoColumns ? "geo_lng" : "NULL AS geo_lng"},
    ${hasGeoColumns ? "geo_source" : "NULL AS geo_source"},
    ${hasGeoColumns ? "geo_confidence" : "NULL AS geo_confidence"}
  `;
};

export const hasD1Opportunities = async (database: D1DatabaseLike) => {
  try {
    const row = await readRow<{ total: number }>(database, "SELECT COUNT(*) AS total FROM competitions");
    return (row?.total ?? 0) > 0;
  } catch {
    return false;
  }
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

const queryVisibleOpportunityRows = async (
  database: D1DatabaseLike,
  {
    offset,
    sort = "deadline",
    ...filters
  }: StoredOpportunityQuery = {},
  sqlLimit?: number,
) => {
  if (!(await hasD1Opportunities(database))) {
    return [] as OpportunityRow[];
  }

  const { parameters, whereClause } = buildOpportunityWhereClause(filters);
  const hasDerivedFilters = Boolean(
    (filters.projectTypes?.length ?? 0) > 0 ||
      (filters.buildingCategories?.length ?? 0) > 0 ||
      (filters.designScopes?.length ?? 0) > 0 ||
      (filters.projectModes?.length ?? 0) > 0,
  );
  const useSqlLimit = !hasDerivedFilters && sqlLimit !== undefined;
  const useSqlOffset = useSqlLimit && !hasDerivedFilters && offset !== undefined && offset > 0;
  const selectList = await buildOpportunitySelectList(database);
  const sqlParameters = [...parameters];
  if (useSqlLimit) {
    sqlParameters.push(sqlLimit);
  }
  if (useSqlOffset) {
    sqlParameters.push(offset);
  }
  const rows = await readRows<OpportunityRow>(
    database,
    `
      SELECT ${selectList}
      FROM competitions
      ${whereClause}
      ORDER BY ${buildSortClause(sort)}
      ${useSqlLimit ? "LIMIT ?" : ""}
      ${useSqlOffset ? "OFFSET ?" : ""}
    `,
    sqlParameters,
  );

  if (rows.length === 0) {
    return [];
  }

  return hasDerivedFilters ? rows.filter((row) => matchesDerivedFilters(row, filters)) : rows;
};

export const queryD1OpportunityFeed = async (
  database: D1DatabaseLike,
  {
    limit = 24,
    offset = 0,
    sort = "deadline",
    ...filters
  }: StoredOpportunityQuery = {},
): Promise<StoredOpportunityFeedItem[]> => {
  const rows = await queryVisibleOpportunityRows(database, { offset, sort, ...filters }, limit);
  if (rows.length === 0) {
    return [];
  }
  return rows.slice(0, limit).map(toOpportunityFeedItem);
};

export const queryD1Opportunities = async (
  database: D1DatabaseLike,
  query: StoredOpportunityQuery = {},
): Promise<ProfessionalOpportunity[]> => {
  const feed = await queryD1OpportunityFeed(database, query);
  return feed.map(toProfessionalOpportunity);
};

export const getD1OpportunityFeedItemBySlug = async (
  database: D1DatabaseLike,
  slug: string,
) => {
  if (!(await hasD1Opportunities(database))) {
    return undefined;
  }

  const selectList = await buildOpportunitySelectList(database);
  for (const slugCandidate of normalizeOpportunitySlugLookup(slug)) {
    const row = await readRow<OpportunityRow>(
      database,
      `SELECT ${selectList} FROM competitions WHERE id = ?`,
      [slugCandidate],
    );
    if (row) {
      return toOpportunityFeedItem(row);
    }
  }

  return undefined;
};

export const getD1OpsSnapshot = async (database: D1DatabaseLike) => {
  if (!(await hasD1Opportunities(database))) {
    return {
      total: 0,
      verified: 0,
      primary: 0,
    };
  }

  const row = await readRow<{
    total: number;
    verified: number;
    primary_count: number;
  }>(
    database,
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

export const getD1SourceHealth = async (
  database: D1DatabaseLike,
  limit = 20,
): Promise<StoredSourceHealthItem[]> => {
  if (!(await hasTable(database, "source_health"))) {
    return [];
  }

  try {
    const rows = await readRows<SourceHealthRow>(
      database,
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

export const getD1DuplicatePressureSummary = async (
  database: D1DatabaseLike,
): Promise<StoredDuplicatePressureSummary> => {
  if (!(await hasD1Opportunities(database))) {
    return {
      duplicateGroups: 0,
      recordsInDuplicateGroups: 0,
      maxDuplicateGroupSize: 0,
    };
  }

  const row = await readRow<StoredDuplicatePressureSummary>(
    database,
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
  designScopes: [],
  jurisdictions: [],
  projectModes: [],
  projectTypes: [],
  procedureTypes: [],
  implementationPaths: [],
});

export const getD1DiscoverSurfaceData = async (
  database: D1DatabaseLike,
  {
    limit = 24,
    offset = 0,
    sort = "deadline",
    ...filters
  }: StoredOpportunityQuery = {},
): Promise<StoredDiscoverSurfaceData> => {
  const rows = await queryVisibleOpportunityRows(database, { sort, ...filters });
  if (rows.length === 0) {
    return {
      filterOptions: emptyFilterOptions(),
      opportunities: [],
      total: 0,
    };
  }

  return {
    filterOptions: buildScopedFilterOptions(rows, filters),
    opportunities: rows.slice(offset, offset + limit).map(toOpportunityFeedItem),
    total: rows.length,
  };
};

export type StoredSavedSearch = {
  createdAt: string;
  filters: StoredOpportunityQuery;
  id: number;
  name: string;
  updatedAt: string;
  workspaceKey: string;
};
export type StoredSavedSearchQuery = {
  limit?: number;
  workspaceKey: string;
};
export type StoredSavedSearchCreateInput = {
  filters: StoredOpportunityQuery;
  name: string;
  workspaceKey: string;
};
export type StoredSavedSearchDeleteInput = {
  id: number;
  workspaceKey: string;
};
export type StoredWatchlistEntry = {
  createdAt: string;
  id: number;
  opportunityId: string;
  updatedAt: string;
  workspaceKey: string;
};
export type StoredWatchlistEntryQuery = {
  limit?: number;
  workspaceKey: string;
};
export type StoredWatchlistEntryCreateInput = {
  opportunityId: string;
  workspaceKey: string;
};
export type StoredWatchlistEntryDeleteInput = {
  opportunityId: string;
  workspaceKey: string;
};

type SavedSearchRow = {
  created_at: string;
  filters_json: string;
  id: number;
  name: string;
  updated_at: string;
  workspace_key: string;
};

type WatchlistEntryRow = {
  created_at: string;
  id: number;
  opportunity_id: string;
  updated_at: string;
  workspace_key: string;
};

const storedProjectTypes = new Set<StoredProjectType>(projectTypeOrder);
const storedBuildingCategories = new Set<StoredBuildingCategory>([
  "healthcare",
  "education",
  "housing",
  "civic_public",
  "sport_leisure",
  "culture_heritage",
  "transport_infrastructure",
]);
const storedDesignScopes = new Set<StoredDesignScope>([
  "interior_design",
  "architectural_design",
  "scheme",
  "preliminary",
  "construction_docs",
  "planning",
  "design_service",
]);
const storedProjectModes = new Set<StoredProjectMode>(["new_build", "renovation", "extension"]);
const storedSortValues = new Set<NonNullable<StoredOpportunityQuery["sort"]>>([
  "deadline",
  "highest_value",
  "latest",
]);

const toUniqueArray = <T extends string>(values: T[]) => [...new Set(values)];
const normalizeText = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};
const normalizeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);
const safeJsonParse = (payload: string) => {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return {};
  }
};

const normalizeStoredFilters = (value: unknown): StoredOpportunityQuery => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const buildingCategories = Array.isArray(source.buildingCategories)
    ? toUniqueArray(
        source.buildingCategories.filter(
          (item): item is StoredBuildingCategory =>
            typeof item === "string" && storedBuildingCategories.has(item as StoredBuildingCategory),
        ),
      )
    : [];
  const designScopes = Array.isArray(source.designScopes)
    ? toUniqueArray(
        source.designScopes.filter(
          (item): item is StoredDesignScope =>
            typeof item === "string" && storedDesignScopes.has(item as StoredDesignScope),
        ),
      )
    : [];
  const projectTypes = Array.isArray(source.projectTypes)
    ? toUniqueArray(
        source.projectTypes.filter(
          (item): item is StoredProjectType =>
            typeof item === "string" && storedProjectTypes.has(item as StoredProjectType),
        ),
      )
    : [];
  const projectModes = Array.isArray(source.projectModes)
    ? toUniqueArray(
        source.projectModes.filter(
          (item): item is StoredProjectMode =>
            typeof item === "string" && storedProjectModes.has(item as StoredProjectMode),
        ),
      )
    : [];
  const rawSort = typeof source.sort === "string" ? source.sort : undefined;
  const sort =
    rawSort && storedSortValues.has(rawSort as NonNullable<StoredOpportunityQuery["sort"]>)
      ? (rawSort as NonNullable<StoredOpportunityQuery["sort"]>)
      : undefined;
  const licensedArchitectRequired =
    typeof source.licensedArchitectRequired === "boolean"
      ? source.licensedArchitectRequired
      : undefined;
  const includeExpired = typeof source.includeExpired === "boolean" ? source.includeExpired : undefined;
  const normalizedFilters: StoredOpportunityQuery = {};

  if (buildingCategories.length > 0) normalizedFilters.buildingCategories = buildingCategories;
  if (designScopes.length > 0) normalizedFilters.designScopes = designScopes;
  const deadlineAfter = normalizeText(typeof source.deadlineAfter === "string" ? source.deadlineAfter : undefined);
  if (deadlineAfter) normalizedFilters.deadlineAfter = deadlineAfter;
  const deadlineBefore = normalizeText(typeof source.deadlineBefore === "string" ? source.deadlineBefore : undefined);
  if (deadlineBefore) normalizedFilters.deadlineBefore = deadlineBefore;
  const implementationPath = normalizeText(typeof source.implementationPath === "string" ? source.implementationPath : undefined);
  if (implementationPath) normalizedFilters.implementationPath = implementationPath;
  if (includeExpired === true) normalizedFilters.includeExpired = true;
  const jurisdiction = normalizeText(typeof source.jurisdiction === "string" ? source.jurisdiction : undefined);
  if (jurisdiction) normalizedFilters.jurisdiction = jurisdiction;
  if (licensedArchitectRequired === true) normalizedFilters.licensedArchitectRequired = true;
  const maxEstimatedValueEur = normalizeNumber(source.maxEstimatedValueEur);
  if (maxEstimatedValueEur !== undefined) normalizedFilters.maxEstimatedValueEur = maxEstimatedValueEur;
  const minEstimatedValueEur = normalizeNumber(source.minEstimatedValueEur);
  if (minEstimatedValueEur !== undefined) normalizedFilters.minEstimatedValueEur = minEstimatedValueEur;
  const minQualificationScore = normalizeNumber(source.minQualificationScore);
  if (minQualificationScore !== undefined) normalizedFilters.minQualificationScore = minQualificationScore;
  const procedureType = normalizeText(typeof source.procedureType === "string" ? source.procedureType : undefined);
  if (procedureType) normalizedFilters.procedureType = procedureType;
  if (projectTypes.length > 0) normalizedFilters.projectTypes = projectTypes;
  if (projectModes.length > 0) normalizedFilters.projectModes = projectModes;
  const publishedWithinDays = normalizeNumber(source.publishedWithinDays);
  if (publishedWithinDays !== undefined) normalizedFilters.publishedWithinDays = publishedWithinDays;
  const search = normalizeText(typeof source.search === "string" ? source.search : undefined);
  if (search) normalizedFilters.search = search;
  if (sort) normalizedFilters.sort = sort;

  return normalizedFilters;
};

const isSavedSearchEmpty = (filters: StoredOpportunityQuery) => Object.keys(filters).length === 0;

const mapSavedSearchRow = (row: SavedSearchRow): StoredSavedSearch => ({
  createdAt: row.created_at,
  filters: normalizeStoredFilters(safeJsonParse(row.filters_json)),
  id: row.id,
  name: row.name,
  updatedAt: row.updated_at,
  workspaceKey: row.workspace_key,
});

const mapWatchlistEntryRow = (row: WatchlistEntryRow): StoredWatchlistEntry => ({
  createdAt: row.created_at,
  id: row.id,
  opportunityId: row.opportunity_id,
  updatedAt: row.updated_at,
  workspaceKey: row.workspace_key,
});

const normalizeWorkspaceKey = (workspaceKey: string) => {
  const normalized = normalizeText(workspaceKey);
  if (!normalized) {
    throw new Error("Workspace key is required");
  }
  return normalized;
};

const normalizeSavedSearchName = (name: string) => {
  const normalized = normalizeText(name);
  if (!normalized) {
    throw new Error("Saved search name is required");
  }
  if (normalized.length > 80) {
    throw new Error("Saved search name must be 80 characters or fewer");
  }
  return normalized;
};

const normalizeOpportunityId = (opportunityId: string) => {
  const normalized = normalizeText(opportunityId);
  if (!normalized) {
    throw new Error("Opportunity id is required");
  }
  return normalized;
};

const getD1SavedSearchById = async (database: D1DatabaseLike, id: number) => {
  const row = await readRow<SavedSearchRow>(
    database,
    `
      SELECT id, workspace_key, name, filters_json, created_at, updated_at
      FROM workspace_saved_searches
      WHERE id = ?
    `,
    [id],
  );

  return row ? mapSavedSearchRow(row) : undefined;
};

const getD1SavedSearchBySignature = async (
  database: D1DatabaseLike,
  workspaceKey: string,
  name: string,
  filtersJson: string,
) => {
  const row = await readRow<SavedSearchRow>(
    database,
    `
      SELECT id, workspace_key, name, filters_json, created_at, updated_at
      FROM workspace_saved_searches
      WHERE workspace_key = ? AND name = ? AND filters_json = ?
      ORDER BY id DESC
      LIMIT 1
    `,
    [workspaceKey, name, filtersJson],
  );

  return row ? mapSavedSearchRow(row) : undefined;
};

const getD1WatchlistEntry = async (
  database: D1DatabaseLike,
  workspaceKey: string,
  opportunityId: string,
) => {
  const row = await readRow<WatchlistEntryRow>(
    database,
    `
      SELECT id, workspace_key, opportunity_id, created_at, updated_at
      FROM workspace_watchlist_entries
      WHERE workspace_key = ? AND opportunity_id = ?
    `,
    [workspaceKey, opportunityId],
  );

  return row ? mapWatchlistEntryRow(row) : undefined;
};

export const queryD1SavedSearches = async ({
  database,
  limit = 20,
  workspaceKey,
}: StoredSavedSearchQuery & { database: D1DatabaseLike }): Promise<StoredSavedSearch[]> => {
  if (!(await hasTable(database, "workspace_saved_searches"))) {
    return [];
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  try {
    const rows = await readRows<SavedSearchRow>(
      database,
      `
        SELECT id, workspace_key, name, filters_json, created_at, updated_at
        FROM workspace_saved_searches
        WHERE workspace_key = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      [normalizedWorkspaceKey, limit],
    );
    return rows.map(mapSavedSearchRow);
  } catch {
    return [];
  }
};

export const createD1SavedSearch = async ({
  database,
  filters,
  name,
  workspaceKey,
}: StoredSavedSearchCreateInput & { database: D1DatabaseLike }): Promise<StoredSavedSearch> => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedName = normalizeSavedSearchName(name);
  const normalizedFilters = normalizeStoredFilters(filters);
  if (isSavedSearchEmpty(normalizedFilters)) {
    throw new Error("Saved search filters are required");
  }

  const filtersJson = JSON.stringify(normalizedFilters);
  const existingSavedSearch = await getD1SavedSearchBySignature(
    database,
    normalizedWorkspaceKey,
    normalizedName,
    filtersJson,
  );
  if (existingSavedSearch) {
    const now = new Date().toISOString();
    await runStatement(database, "UPDATE workspace_saved_searches SET updated_at = ? WHERE id = ?", [
      now,
      existingSavedSearch.id,
    ]);
    const savedSearch = await getD1SavedSearchById(database, existingSavedSearch.id);
    if (!savedSearch) {
      throw new Error("Failed to reload saved search");
    }
    return savedSearch;
  }

  const now = new Date().toISOString();
  const result = await runStatement(
    database,
    `
      INSERT INTO workspace_saved_searches (
        workspace_key,
        name,
        filters_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [normalizedWorkspaceKey, normalizedName, filtersJson, now, now],
  );
  const id = Number(result.meta?.last_row_id);
  const savedSearch = Number.isFinite(id) ? await getD1SavedSearchById(database, id) : undefined;
  if (!savedSearch) {
    throw new Error("Failed to reload saved search");
  }
  return savedSearch;
};

export const deleteD1SavedSearch = async ({
  database,
  id,
  workspaceKey,
}: StoredSavedSearchDeleteInput & { database: D1DatabaseLike }) => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const result = await runStatement(
    database,
    "DELETE FROM workspace_saved_searches WHERE id = ? AND workspace_key = ?",
    [id, normalizedWorkspaceKey],
  );
  return (result.meta?.changes ?? 0) > 0;
};

export const queryD1WatchlistEntries = async ({
  database,
  limit = 50,
  workspaceKey,
}: StoredWatchlistEntryQuery & { database: D1DatabaseLike }): Promise<StoredWatchlistEntry[]> => {
  if (!(await hasTable(database, "workspace_watchlist_entries"))) {
    return [];
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  try {
    const rows = await readRows<WatchlistEntryRow>(
      database,
      `
        SELECT id, workspace_key, opportunity_id, created_at, updated_at
        FROM workspace_watchlist_entries
        WHERE workspace_key = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      [normalizedWorkspaceKey, limit],
    );
    return rows.map(mapWatchlistEntryRow);
  } catch {
    return [];
  }
};

export const listD1WatchedOpportunityIds = async (
  database: D1DatabaseLike,
  workspaceKey: string,
) => {
  if (!(await hasTable(database, "workspace_watchlist_entries"))) {
    return [];
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  try {
    const rows = await readRows<{ opportunity_id: string }>(
      database,
      `
        SELECT opportunity_id
        FROM workspace_watchlist_entries
        WHERE workspace_key = ?
        ORDER BY updated_at DESC, id DESC
      `,
      [normalizedWorkspaceKey],
    );
    return rows.map((row) => row.opportunity_id);
  } catch {
    return [];
  }
};

export const isD1OpportunityWatched = async ({
  database,
  opportunityId,
  workspaceKey,
}: StoredWatchlistEntryCreateInput & { database: D1DatabaseLike }) => {
  if (!(await hasTable(database, "workspace_watchlist_entries"))) {
    return false;
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);

  const row = await readRow<{ opportunity_id: string }>(
    database,
    `
      SELECT opportunity_id
      FROM workspace_watchlist_entries
      WHERE workspace_key = ? AND opportunity_id = ?
    `,
    [normalizedWorkspaceKey, normalizedOpportunityId],
  );

  return Boolean(row?.opportunity_id);
};

export const createD1WatchlistEntry = async ({
  database,
  opportunityId,
  workspaceKey,
}: StoredWatchlistEntryCreateInput & { database: D1DatabaseLike }): Promise<StoredWatchlistEntry> => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);
  const opportunity = await readRow<{ id: string }>(
    database,
    "SELECT id FROM competitions WHERE id = ?",
    [normalizedOpportunityId],
  );
  if (!opportunity) {
    throw new Error(`Unknown opportunity id: ${normalizedOpportunityId}`);
  }

  const now = new Date().toISOString();
  await runStatement(
    database,
    `
      INSERT INTO workspace_watchlist_entries (
        workspace_key,
        opportunity_id,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_key, opportunity_id) DO UPDATE SET
        updated_at = excluded.updated_at
    `,
    [normalizedWorkspaceKey, normalizedOpportunityId, now, now],
  );

  const entry = await getD1WatchlistEntry(database, normalizedWorkspaceKey, normalizedOpportunityId);
  if (!entry) {
    throw new Error("Failed to reload watchlist entry");
  }
  return entry;
};

export const deleteD1WatchlistEntry = async ({
  database,
  opportunityId,
  workspaceKey,
}: StoredWatchlistEntryDeleteInput & { database: D1DatabaseLike }) => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);
  const result = await runStatement(
    database,
    "DELETE FROM workspace_watchlist_entries WHERE workspace_key = ? AND opportunity_id = ?",
    [normalizedWorkspaceKey, normalizedOpportunityId],
  );
  return (result.meta?.changes ?? 0) > 0;
};

type OpsReviewQueueRow = {
  queue_id: string;
  origin: string;
  reason_code: string;
  status: string;
  priority: number;
  title: string;
  summary: string;
  evidence_note: string | null;
  source_id: string | null;
  competition_id: string | null;
  dedup_key: string | null;
  notice_id: string | null;
  payload_json: string;
  is_active: number;
  first_detected_at: string;
  last_detected_at: string;
  updated_at: string;
  latest_decision: string | null;
  latest_actor_label: string | null;
  latest_note: string | null;
  latest_created_at: string | null;
};

export const STORED_OPS_REVIEW_STATUSES = [
  "pending",
  "accepted",
  "rejected",
  "needs_follow_up",
] as const;
export const STORED_OPS_REVIEW_REASON_CODES = [
  "source_parse_failures",
  "source_run_failed",
  "duplicate_cluster",
  "low_confidence_record",
  "evidence_conflict",
  "submission_pending_review",
] as const;
export const STORED_OPS_REVIEW_ORIGINS = ["worker_diagnostic", "submission"] as const;

export type StoredOpsReviewDecisionStatus = (typeof STORED_OPS_REVIEW_STATUSES)[number];
export type StoredOpsReviewReasonCode = (typeof STORED_OPS_REVIEW_REASON_CODES)[number];
export type StoredOpsReviewOrigin = (typeof STORED_OPS_REVIEW_ORIGINS)[number];
export type StoredOpsReviewQueueQuery = {
  activeOnly?: boolean;
  limit?: number;
  reasonCode?: StoredOpsReviewReasonCode | "all";
  status?: StoredOpsReviewDecisionStatus | "all";
};
export type StoredOpsReviewSummary = {
  total: number;
  active: number;
  pending: number;
  accepted: number;
  rejected: number;
  needsFollowUp: number;
  reasons: Array<{
    count: number;
    reasonCode: string;
  }>;
};
export type StoredOpsReviewQueueItem = {
  queueId: string;
  origin: string;
  reasonCode: string;
  status: string;
  priority: number;
  title: string;
  summary: string;
  evidenceNote: string | null;
  sourceId: string | null;
  competitionId: string | null;
  dedupKey: string | null;
  noticeId: string | null;
  payload: Record<string, unknown>;
  isActive: boolean;
  firstDetectedAt: string;
  lastDetectedAt: string;
  updatedAt: string;
  latestDecision: null | {
    actorLabel: string | null;
    createdAt: string;
    decision: string;
    note: string | null;
  };
};
export type StoredOpsReviewDecisionInput = {
  actorLabel?: string | null;
  decision: StoredOpsReviewDecisionStatus;
  queueId: string;
  note?: string | null;
};

const safeJsonRecord = (payload: string) => {
  try {
    const value = JSON.parse(payload) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
};

const mapQueueRow = (row: OpsReviewQueueRow): StoredOpsReviewQueueItem => ({
  queueId: row.queue_id,
  origin: row.origin,
  reasonCode: row.reason_code,
  status: row.status,
  priority: row.priority,
  title: row.title,
  summary: row.summary,
  evidenceNote: row.evidence_note,
  sourceId: row.source_id,
  competitionId: row.competition_id,
  dedupKey: row.dedup_key,
  noticeId: row.notice_id,
  payload: safeJsonRecord(row.payload_json),
  isActive: row.is_active === 1,
  firstDetectedAt: row.first_detected_at,
  lastDetectedAt: row.last_detected_at,
  updatedAt: row.updated_at,
  latestDecision:
    row.latest_decision && row.latest_created_at
      ? {
          actorLabel: row.latest_actor_label,
          createdAt: row.latest_created_at,
          decision: row.latest_decision,
          note: row.latest_note,
        }
      : null,
});

export const getD1OpsReviewSummary = async (
  database: D1DatabaseLike,
): Promise<StoredOpsReviewSummary> => {
  if (!(await hasTable(database, "ops_review_queue_items"))) {
    return {
      total: 0,
      active: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      needsFollowUp: 0,
      reasons: [],
    };
  }

  try {
    const counts = await readRow<{
      accepted: number;
      active: number;
      needsFollowUp: number;
      pending: number;
      rejected: number;
      total: number;
    }>(
      database,
      `
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN is_active = 1 AND status = 'pending' THEN 1 ELSE 0 END) AS pending,
          SUM(CASE WHEN is_active = 1 AND status = 'accepted' THEN 1 ELSE 0 END) AS accepted,
          SUM(CASE WHEN is_active = 1 AND status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
          SUM(CASE WHEN is_active = 1 AND status = 'needs_follow_up' THEN 1 ELSE 0 END) AS needsFollowUp
        FROM ops_review_queue_items
      `,
    );
    const reasons = await readRows<{
      count: number;
      reasonCode: string;
    }>(
      database,
      `
        SELECT reason_code AS reasonCode, COUNT(*) AS count
        FROM ops_review_queue_items
        WHERE is_active = 1
        GROUP BY reason_code
        ORDER BY count DESC, reason_code ASC
      `,
    );

    return {
      total: counts?.total ?? 0,
      active: counts?.active ?? 0,
      pending: counts?.pending ?? 0,
      accepted: counts?.accepted ?? 0,
      rejected: counts?.rejected ?? 0,
      needsFollowUp: counts?.needsFollowUp ?? 0,
      reasons,
    };
  } catch {
    return {
      total: 0,
      active: 0,
      pending: 0,
      accepted: 0,
      rejected: 0,
      needsFollowUp: 0,
      reasons: [],
    };
  }
};

export const queryD1OpsReviewQueue = async (
  database: D1DatabaseLike,
  {
    activeOnly = true,
    limit = 50,
    reasonCode = "all",
    status = "pending",
  }: StoredOpsReviewQueueQuery = {},
): Promise<StoredOpsReviewQueueItem[]> => {
  if (!(await hasTable(database, "ops_review_queue_items"))) {
    return [];
  }

  const conditions: string[] = [];
  const parameters: SqlParameter[] = [];
  if (activeOnly) {
    conditions.push("q.is_active = 1");
  }
  if (status !== "all") {
    conditions.push("q.status = ?");
    parameters.push(status);
  }
  if (reasonCode !== "all") {
    conditions.push("q.reason_code = ?");
    parameters.push(reasonCode);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  try {
    const rows = await readRows<OpsReviewQueueRow>(
      database,
      `
        WITH latest_decision_ids AS (
          SELECT queue_id, MAX(id) AS latest_id
          FROM ops_review_decisions
          GROUP BY queue_id
        )
        SELECT
          q.queue_id,
          q.origin,
          q.reason_code,
          q.status,
          q.priority,
          q.title,
          q.summary,
          q.evidence_note,
          q.source_id,
          q.competition_id,
          q.dedup_key,
          q.notice_id,
          q.payload_json,
          q.is_active,
          q.first_detected_at,
          q.last_detected_at,
          q.updated_at,
          d.decision AS latest_decision,
          d.actor_label AS latest_actor_label,
          d.note AS latest_note,
          d.created_at AS latest_created_at
        FROM ops_review_queue_items AS q
        LEFT JOIN latest_decision_ids AS latest ON latest.queue_id = q.queue_id
        LEFT JOIN ops_review_decisions AS d ON d.id = latest.latest_id
        ${whereClause}
        ORDER BY
          CASE
            WHEN q.status = 'pending' THEN 0
            WHEN q.status = 'needs_follow_up' THEN 1
            WHEN q.status = 'accepted' THEN 2
            WHEN q.status = 'rejected' THEN 3
            ELSE 4
          END ASC,
          q.priority DESC,
          q.last_detected_at DESC,
          q.queue_id ASC
        LIMIT ?
      `,
      [...parameters, limit],
    );

    return rows.map(mapQueueRow);
  } catch {
    return [];
  }
};

const getD1OpsReviewQueueItemById = async (
  database: D1DatabaseLike,
  queueId: string,
) => {
  const row = await readRow<OpsReviewQueueRow>(
    database,
    `
      WITH latest_decision_ids AS (
        SELECT queue_id, MAX(id) AS latest_id
        FROM ops_review_decisions
        GROUP BY queue_id
      )
      SELECT
        q.queue_id,
        q.origin,
        q.reason_code,
        q.status,
        q.priority,
        q.title,
        q.summary,
        q.evidence_note,
        q.source_id,
        q.competition_id,
        q.dedup_key,
        q.notice_id,
        q.payload_json,
        q.is_active,
        q.first_detected_at,
        q.last_detected_at,
        q.updated_at,
        d.decision AS latest_decision,
        d.actor_label AS latest_actor_label,
        d.note AS latest_note,
        d.created_at AS latest_created_at
      FROM ops_review_queue_items AS q
      LEFT JOIN latest_decision_ids AS latest ON latest.queue_id = q.queue_id
      LEFT JOIN ops_review_decisions AS d ON d.id = latest.latest_id
      WHERE q.queue_id = ?
    `,
    [queueId],
  );

  return row ? mapQueueRow(row) : undefined;
};

export const writeD1OpsReviewDecision = async (
  database: D1DatabaseLike,
  {
    actorLabel = "local_operator",
    decision,
    note = null,
    queueId,
  }: StoredOpsReviewDecisionInput,
): Promise<StoredOpsReviewQueueItem> => {
  if (!STORED_OPS_REVIEW_STATUSES.includes(decision)) {
    throw new Error(`Unsupported ops review decision: ${decision}`);
  }

  const existing = await readRow<{ queue_id: string }>(
    database,
    "SELECT queue_id FROM ops_review_queue_items WHERE queue_id = ?",
    [queueId],
  );
  if (!existing) {
    throw new Error(`Unknown ops review queue item: ${queueId}`);
  }

  const now = new Date().toISOString();
  await runStatement(
    database,
    "INSERT INTO ops_review_decisions (queue_id, decision, actor_label, note, created_at) VALUES (?, ?, ?, ?, ?)",
    [queueId, decision, actorLabel, note, now],
  );
  await runStatement(
    database,
    "UPDATE ops_review_queue_items SET status = ?, updated_at = ? WHERE queue_id = ?",
    [decision, now, queueId],
  );

  const updated = await getD1OpsReviewQueueItemById(database, queueId);
  if (!updated) {
    throw new Error(`Failed to reload ops review queue item: ${queueId}`);
  }
  return updated;
};

type AuthUserRow = {
  created_at: string;
  email: string;
  id: string;
  password_hash: string;
  updated_at: string;
};

type AuthSessionRow = {
  created_at: string;
  email: string;
  expires_at: string;
  token_hash: string;
  user_created_at: string;
  user_id: string;
  user_updated_at: string;
};

export type StoredAuthErrorCode = "email_taken" | "invalid_email" | "unknown_user" | "weak_password";

export class StoredAuthError extends Error {
  code: StoredAuthErrorCode;

  constructor(code: StoredAuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "StoredAuthError";
  }
}

export type StoredAuthUser = {
  createdAt: string;
  email: string;
  id: string;
  updatedAt: string;
};

export type StoredAuthSession = {
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
  user: StoredAuthUser;
  userId: string;
};

export type StoredAuthSessionWithToken = {
  session: StoredAuthSession;
  token: string;
};

export type StoredAuthUserCreateInput = {
  email: string;
  password: string;
};
export type StoredAuthLoginInput = {
  email: string;
  password: string;
};
export type StoredAuthSessionCreateInput = {
  expiresAt?: string;
  userId: string;
};

const authSessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinLength = 8;
const textEncoder = new TextEncoder();

const normalizeEmail = (email: string) => email.trim().toLowerCase();
const normalizeEmailOrThrow = (email: string) => {
  const normalizedEmail = normalizeEmail(email);
  if (!emailPattern.test(normalizedEmail)) {
    throw new StoredAuthError("invalid_email", "Email address is invalid.");
  }
  return normalizedEmail;
};
const assertPassword = (password: string) => {
  if (password.length < passwordMinLength) {
    throw new StoredAuthError(
      "weak_password",
      `Password must be at least ${passwordMinLength} characters.`,
    );
  }
};
const toIsoString = (value = new Date()) => value.toISOString();

const base64UrlFromBytes = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/u, "");
};

const bytesFromBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

const randomToken = (size = 32) => {
  const bytes = new Uint8Array(size);
  crypto.getRandomValues(bytes);
  return base64UrlFromBytes(bytes);
};

const digestBase64Url = async (value: string) => {
  const digest = await crypto.subtle.digest("SHA-256", textEncoder.encode(value));
  return base64UrlFromBytes(new Uint8Array(digest));
};

const scryptCost = 16_384;
const scryptBlockSize = 8;
const scryptParallelization = 1;
const scryptKeyLength = 64;

const createPasswordHash = async (password: string) => {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const { scrypt } = await import("node:crypto");
  const derivedBytes = await new Promise<Uint8Array>((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(salt),
      scryptKeyLength,
      {
        N: scryptCost,
        p: scryptParallelization,
        r: scryptBlockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Uint8Array(derivedKey));
      },
    );
  });

  return [
    "scrypt",
    scryptCost,
    scryptBlockSize,
    scryptParallelization,
    base64UrlFromBytes(salt),
    base64UrlFromBytes(derivedBytes),
  ].join("$");
};

const timingSafeEqualBytes = (left: Uint8Array, right: Uint8Array) => {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
};

const verifyPasswordHash = async (password: string, storedHash: string) => {
  const [scheme, rawCost, rawBlockSize, rawParallelization, salt, hash] = storedHash.split("$");
  if (
    scheme !== "scrypt" ||
    !rawCost ||
    !rawBlockSize ||
    !rawParallelization ||
    !salt ||
    !hash
  ) {
    return false;
  }

  const cost = Number.parseInt(rawCost, 10);
  const blockSize = Number.parseInt(rawBlockSize, 10);
  const parallelization = Number.parseInt(rawParallelization, 10);
  if (
    !Number.isFinite(cost) ||
    !Number.isFinite(blockSize) ||
    !Number.isFinite(parallelization) ||
    cost < 2 ||
    blockSize < 1 ||
    parallelization < 1
  ) {
    return false;
  }

  const expectedHash = bytesFromBase64Url(hash);
  const { scrypt } = await import("node:crypto");
  const derivedBytes = await new Promise<Uint8Array>((resolve, reject) => {
    scrypt(
      password,
      Buffer.from(bytesFromBase64Url(salt)),
      expectedHash.length,
      {
        N: cost,
        p: parallelization,
        r: blockSize,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(new Uint8Array(derivedKey));
      },
    );
  });

  return timingSafeEqualBytes(expectedHash, derivedBytes);
};

const mapAuthUserRow = (row: AuthUserRow): StoredAuthUser => ({
  createdAt: row.created_at,
  email: row.email,
  id: row.id,
  updatedAt: row.updated_at,
});

const mapAuthSessionRow = (row: AuthSessionRow): StoredAuthSession => ({
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  tokenHash: row.token_hash,
  user: {
    createdAt: row.user_created_at,
    email: row.email,
    id: row.user_id,
    updatedAt: row.user_updated_at,
  },
  userId: row.user_id,
});

const ensureD1AuthTables = async (database: D1DatabaseLike) => {
  const [hasUsersTable, hasSessionsTable] = await Promise.all([
    hasTable(database, "auth_users"),
    hasTable(database, "auth_sessions"),
  ]);

  if (hasUsersTable && hasSessionsTable) {
    return;
  }

  await runStatement(
    database,
    `
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `,
  );
  await runStatement(
    database,
    `
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      )
    `,
  );
  await runStatement(
    database,
    `
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires
      ON auth_sessions (user_id, expires_at)
    `,
  );
};

const readD1AuthUserById = async (database: D1DatabaseLike, userId: string) => {
  const row = await readRow<AuthUserRow>(
    database,
    `
      SELECT id, email, password_hash, created_at, updated_at
      FROM auth_users
      WHERE id = ?
    `,
    [userId],
  );
  return row ? mapAuthUserRow(row) : undefined;
};

const readD1AuthSession = async (database: D1DatabaseLike, tokenHash: string) => {
  const row = await readRow<AuthSessionRow>(
    database,
    `
      SELECT
        auth_sessions.token_hash,
        auth_sessions.user_id,
        auth_sessions.created_at,
        auth_sessions.expires_at,
        auth_users.email,
        auth_users.created_at AS user_created_at,
        auth_users.updated_at AS user_updated_at
      FROM auth_sessions
      INNER JOIN auth_users ON auth_users.id = auth_sessions.user_id
      WHERE auth_sessions.token_hash = ?
    `,
    [tokenHash],
  );

  return row ? mapAuthSessionRow(row) : undefined;
};

const deleteD1ExpiredSessions = async (database: D1DatabaseLike, now = toIsoString()) => {
  await runStatement(database, "DELETE FROM auth_sessions WHERE expires_at <= ?", [now]);
};

export const createD1AuthUser = async (
  database: D1DatabaseLike,
  {
    email,
    password,
  }: StoredAuthUserCreateInput,
): Promise<StoredAuthUser> => {
  await ensureD1AuthTables(database);

  const normalizedEmail = normalizeEmailOrThrow(email);
  assertPassword(password);

  const existingUser = await readRow<{ id: string }>(
    database,
    "SELECT id FROM auth_users WHERE email = ?",
    [normalizedEmail],
  );
  if (existingUser) {
    throw new StoredAuthError("email_taken", "Email is already registered.");
  }

  const userId = crypto.randomUUID();
  const now = toIsoString();
  try {
    await runStatement(
      database,
      `
        INSERT INTO auth_users (
          id,
          email,
          password_hash,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `,
      [userId, normalizedEmail, await createPasswordHash(password), now, now],
    );
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
      throw new StoredAuthError("email_taken", "Email is already registered.");
    }
    throw error;
  }

  const user = await readD1AuthUserById(database, userId);
  if (!user) {
    throw new Error("Failed to reload auth user.");
  }
  return user;
};

export const authenticateD1AuthUser = async (
  database: D1DatabaseLike,
  {
    email,
    password,
  }: StoredAuthLoginInput,
): Promise<StoredAuthUser | null> => {
  await ensureD1AuthTables(database);

  const normalizedEmail = normalizeEmail(email);
  if (!emailPattern.test(normalizedEmail) || password.length === 0) {
    return null;
  }

  const row = await readRow<AuthUserRow>(
    database,
    `
      SELECT id, email, password_hash, created_at, updated_at
      FROM auth_users
      WHERE email = ?
    `,
    [normalizedEmail],
  );

  if (!row || !(await verifyPasswordHash(password, row.password_hash))) {
    return null;
  }

  return mapAuthUserRow(row);
};

export const createD1AuthSession = async (
  database: D1DatabaseLike,
  {
    expiresAt,
    userId,
  }: StoredAuthSessionCreateInput,
): Promise<StoredAuthSessionWithToken> => {
  await ensureD1AuthTables(database);

  const user = await readD1AuthUserById(database, userId);
  if (!user) {
    throw new StoredAuthError("unknown_user", "Auth user does not exist.");
  }

  const now = toIsoString();
  await deleteD1ExpiredSessions(database, now);

  const token = randomToken();
  const tokenHash = await digestBase64Url(token);
  const sessionExpiresAt = expiresAt ?? new Date(Date.now() + authSessionDurationMs).toISOString();

  await runStatement(
    database,
    `
      INSERT INTO auth_sessions (
        token_hash,
        user_id,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?)
    `,
    [tokenHash, user.id, now, sessionExpiresAt],
  );

  const session = await readD1AuthSession(database, tokenHash);
  if (!session) {
    throw new Error("Failed to reload auth session.");
  }

  return { session, token };
};

export const getD1AuthSession = async (
  database: D1DatabaseLike,
  token: string | null | undefined,
): Promise<StoredAuthSession | null> => {
  await ensureD1AuthTables(database);

  if (!token) {
    return null;
  }

  const tokenHash = await digestBase64Url(token);
  const session = await readD1AuthSession(database, tokenHash);
  if (!session) {
    return null;
  }

  if (session.expiresAt <= toIsoString()) {
    await runStatement(database, "DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
    return null;
  }

  return session;
};

export const deleteD1AuthSession = async (
  database: D1DatabaseLike,
  token: string | null | undefined,
) => {
  await ensureD1AuthTables(database);

  if (!token) {
    return false;
  }

  const result = await runStatement(
    database,
    "DELETE FROM auth_sessions WHERE token_hash = ?",
    [await digestBase64Url(token)],
  );
  return (result.meta?.changes ?? 0) > 0;
};

export const countD1AuthUsers = async (database: D1DatabaseLike) => {
  await ensureD1AuthTables(database);

  const row = await readRow<{ total: number }>(database, "SELECT COUNT(*) AS total FROM auth_users");
  return row?.total ?? 0;
};

export const deleteD1AuthSessionsForUser = async (
  database: D1DatabaseLike,
  userId: string,
) => {
  await ensureD1AuthTables(database);

  const result = await runStatement(database, "DELETE FROM auth_sessions WHERE user_id = ?", [userId]);
  return result.meta?.changes ?? 0;
};
