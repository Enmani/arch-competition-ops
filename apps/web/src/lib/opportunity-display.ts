import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import type { AppLocale } from "../i18n/config";
import type { DisplayCopy } from "../i18n/slices";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDeadlineLabel,
  formatLocalizedDate,
  formatParticipationCost,
  formatStampLabel,
  translateMappedValue,
} from "../i18n/format";
import { formatTokenLabel } from "./discover";
import { pickOpportunityDisplayLocality } from "@arch-competition/previews/location";

const combiningDiacriticPattern = /[\u0300-\u036f]/g;

const normalizeLooseText = (value: string) =>
  value
    .normalize("NFD")
    .replace(combiningDiacriticPattern, "")
    .toLowerCase();

const isMachineReadableSourceUrl = (value: string | null | undefined) => {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.pathname.includes("/api/");
  } catch {
    return false;
  }
};

export const joinValues = (
  values: string[],
  formatter: (value: string) => string = (value) => value,
  fallback: string,
) => {
  if (values.length === 0) {
    return fallback;
  }

  return values.map(formatter).join(" · ");
};

export const truthFlag = (
  dictionary: DisplayCopy,
  value: boolean | null,
  positive: string,
  negative: string,
) => {
  if (value === null) {
    return dictionary.common.unstated;
  }

  return value ? positive : negative;
};

const formatProjectCategoryLabel = (
  dictionary: DisplayCopy,
  opportunity: StoredOpportunityFeedItem,
  fallback: string,
) => {
  const projectTypeLabel = opportunity.projectTypeKey
    ? translateMappedValue(
        opportunity.projectTypeKey,
        dictionary.taxonomy.projectTypes,
        formatTokenLabel(opportunity.projectTypeKey),
      )
    : null;
  const primaryBuildingCategory = opportunity.buildingCategories[0];
  const buildingCategoryLabel = primaryBuildingCategory
    ? translateMappedValue(
        primaryBuildingCategory,
        dictionary.taxonomy.buildingCategories,
        formatTokenLabel(primaryBuildingCategory),
      )
    : null;

  if (projectTypeLabel && buildingCategoryLabel) {
    return `${projectTypeLabel} · ${buildingCategoryLabel}`;
  }

  return projectTypeLabel ?? buildingCategoryLabel ?? fallback;
};

export const getOpportunityDisplayMeta = (
  dictionary: DisplayCopy,
  locale: AppLocale,
  opportunity: StoredOpportunityFeedItem,
) => {
  const statusLabel = translateMappedValue(
    opportunity.statusKey,
    dictionary.taxonomy.statuses,
    opportunity.statusLabel,
  );
  const jurisdictionLabel = translateMappedValue(
    opportunity.jurisdictionKey ?? opportunity.jurisdictionLabel,
    dictionary.taxonomy.jurisdictions,
    opportunity.jurisdictionLabel,
  );
  const procedureLabel = translateMappedValue(
    opportunity.procedureTypeKey ?? opportunity.procedureTypeLabel,
    dictionary.taxonomy.procedures,
    opportunity.procedureTypeLabel,
  );
  const implementationPathLabel = translateMappedValue(
    opportunity.implementationPathKey ?? opportunity.implementationPathLabel,
    dictionary.taxonomy.implementationPaths,
    opportunity.implementationPathLabel,
  );
  const evidenceLevelLabel = translateMappedValue(
    opportunity.evidenceLevelKey,
    dictionary.taxonomy.evidenceLevels,
    opportunity.evidenceLevelLabel,
  );
  const opportunityTypeLabel = translateMappedValue(
    opportunity.opportunityTypeKey,
    dictionary.taxonomy.opportunityTypes,
    opportunity.opportunityTypeLabel,
  );
  const deadlineLabel = formatDeadlineLabel(locale, dictionary, opportunity.deadlineAt);
  const deadlineValueLabel =
    formatLocalizedDate(locale, opportunity.deadlineAt) ?? dictionary.common.deadlinePending;
  // '' means the buyer is not published; never fall back to the platform name or invent one.
  const authorityLabel = opportunity.authorityName.trim() || dictionary.common.organizerNotPublished;
  // null when the notice states no value, so a card can leave the slot out instead of announcing "pending".
  const cardValueLabel =
    formatCompactCurrency(locale, opportunity.estimatedContractValueEur) ??
    opportunity.estimatedContractValueText ??
    opportunity.prizeSummary ??
    null;
  const valueLabel =
    formatCurrency(locale, opportunity.estimatedContractValueEur) ??
    opportunity.estimatedContractValueText ??
    opportunity.prizeSummary ??
    dictionary.common.valuePending;
  const participationCostLabel = formatParticipationCost(
    locale,
    dictionary,
    opportunity.registrationFeeEur,
    opportunity.submissionFeeEur,
  );
  const discoveryTrail =
    opportunity.discoveredAt || opportunity.updatedAt
      ? `${formatStampLabel(locale, dictionary, "capturedPrefix", opportunity.discoveredAt)} · ${formatStampLabel(
          locale,
          dictionary,
          "updatedPrefix",
          opportunity.updatedAt,
        )}`
      : dictionary.common.seedSample;
  const explicitLocation = pickOpportunityDisplayLocality(opportunity);
  const locationLabel =
    explicitLocation && normalizeLooseText(explicitLocation) !== normalizeLooseText(jurisdictionLabel)
      ? `${jurisdictionLabel} · ${explicitLocation}`
      : jurisdictionLabel || explicitLocation || dictionary.common.unknown;
  const documentsPortalLink =
    opportunity.documentsPortalUrl &&
    opportunity.documentsPortalUrl !== opportunity.officialUrl &&
    opportunity.documentsPortalUrl !== opportunity.briefPdfUrl
      ? opportunity.documentsPortalUrl
      : null;
  const officialPageLink =
    opportunity.officialUrl && !isMachineReadableSourceUrl(opportunity.officialUrl)
      ? opportunity.officialUrl
      : null;
  const sourceTraceLink =
    opportunity.sourceUrl !== officialPageLink &&
    opportunity.sourceUrl !== documentsPortalLink &&
    opportunity.sourceUrl !== opportunity.briefPdfUrl
      ? opportunity.sourceUrl
      : null;
  const cardCategoryLabel = formatProjectCategoryLabel(
    dictionary,
    opportunity,
    `${opportunityTypeLabel} · ${procedureLabel}`,
  );

  return {
    authorityLabel,
    cardCategoryLabel,
    cardValueLabel,
    deadlineLabel,
    deadlineValueLabel,
    discoveryTrail,
    documentsPortalLink,
    evidenceLevelLabel,
    implementationPathLabel,
    jurisdictionLabel,
    locationLabel,
    officialPageLink,
    opportunityTypeLabel,
    participationCostLabel,
    procedureLabel,
    sourceTraceLink,
    statusLabel,
    valueLabel,
  };
};

type TaxonomyListKey =
  | "audiences"
  | "builtAssetTypes"
  | "competitionTags"
  | "designScopes"
  | "officialSectors"
  | "projectModes"
  | "regions";

/** Joins a list of controlled-vocabulary values as localized labels (unknown values are title-cased). */
export const formatTaxonomyList = (copy: DisplayCopy, key: TaxonomyListKey, values: readonly string[]) =>
  joinValues(
    [...values],
    (value) => translateMappedValue(value, copy.taxonomy[key], formatTokenLabel(value)),
    copy.common.unstated,
  );
