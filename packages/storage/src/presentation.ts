import {
  describeParticipationFee,
  type CompetitionStatus,
  type EvidenceLevel,
  type ImplementationPath,
  type OpportunityType,
  type ProcedureType,
} from "@arch-competition/core";

/**
 * English fallback labels carried on the read model.
 *
 * The web app localises from the *keys* (statusKey, evidenceLevelKey, ...) and only falls
 * back to these strings. They are a view-model concern that still lives here because the
 * existing components and the JSON API rely on them; the table types below make the compiler
 * force an entry for every value in the shared taxonomy.
 * Removal condition: delete once every consumer translates from keys and the web engineer
 * drops the label fallbacks (tracked in docs/structures/2026-10-21-storage-auth-api-architecture.md).
 */
export const titleCase = (value: string | null | undefined) => {
  if (!value) {
    return "Unknown";
  }
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
};

export const opportunityTypeLabels: Record<OpportunityType, string> = {
  public_design_contest: "Public design contest",
  public_design_services_procurement: "Public design services procurement",
  framework_design_services: "Framework design services",
  negotiated_follow_on_services: "Negotiated follow-on services",
};

export const procedureLabels: Record<ProcedureType, string> = {
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

export const implementationPathLabels: Record<ImplementationPath, string> = {
  winner_or_winners_progress_to_negotiated_service_award:
    "Winner or winners progress to negotiated service award",
  service_contract_award_after_competitive_selection:
    "Service contract award after competitive selection",
  framework_selection_for_repeated_design_commissions:
    "Framework selection for repeated design commissions",
  unknown: "Implementation path pending",
};

export const evidenceLevelLabels: Record<EvidenceLevel, string> = {
  official_notice: "Official notice",
  official_listing: "Official listing",
  authority_page: "Authority page",
  secondary: "Secondary source",
  tertiary: "Tertiary source",
};

export const statusLabels: Record<CompetitionStatus, string> = {
  discovered: "Discovered",
  shortlisted: "Shortlisted",
  verified: "Verified",
  archived: "Archived",
  discarded: "Discarded",
};

export const canonicalLabel = (
  value: string | null | undefined,
  labels: Record<string, string>,
  fallback: string,
) => {
  if (!value) {
    return fallback;
  }
  return labels[value] ?? titleCase(value);
};

const formatDate = (date: Date) =>
  date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC", year: "numeric" });

export const formatDeadline = (value: string | null) => {
  if (!value) {
    return "Deadline pending";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `Closes ${formatDate(date)}`;
};

export const formatStamp = (value: string | null | undefined, prefix: string) => {
  if (!value) {
    return `${prefix} pending`;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? `${prefix} ${value}` : `${prefix} ${formatDate(date)}`;
};

/** Fee wording; the decision itself comes from core's `describeParticipationFee`. */
export const formatFee = (registrationFee: number | null, submissionFee: number | null) => {
  const fee = describeParticipationFee(registrationFee, submissionFee);
  if (fee.kind === "pending") {
    return "Fee pending";
  }
  if (fee.kind === "free") {
    return "No participation fee";
  }
  const parts: string[] = [];
  if (fee.registrationEur !== null) {
    parts.push(`EUR ${fee.registrationEur.toFixed(0)} registration`);
  }
  if (fee.submissionEur !== null) {
    parts.push(`EUR ${fee.submissionEur.toFixed(0)} submission`);
  }
  return parts.join(" / ");
};

export const formatContractValue = (
  value: number | null,
  valueText: string | null,
  prizeSummary: string | null,
) => {
  if (value !== null) {
    return `Estimated service value EUR ${(value / 1_000_000).toFixed(2)}M`;
  }
  return valueText ?? prizeSummary ?? "Commercial value pending";
};

export const formatQualification = (
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
  return parts.length > 0 ? parts.join(" · ") : (eligibilitySummary ?? "Qualification pending");
};
