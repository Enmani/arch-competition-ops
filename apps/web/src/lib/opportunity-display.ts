import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import {
  formatCompactCurrency,
  formatCurrency,
  formatDeadlineLabel,
  formatLocalizedDate,
  formatParticipationCost,
  formatStampLabel,
  translateMappedValue,
} from "@/i18n/format";
import { formatTokenLabel } from "@/lib/discover";
import { pickOpportunityExplicitCity } from "@/lib/opportunity-location";

const normalizeLooseText = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
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
  dictionary: AppDictionary,
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
  dictionary: AppDictionary,
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
  dictionary: AppDictionary,
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
    formatLocalizedDate(
      locale,
      opportunity.deadlineAt,
      locale === "zh"
        ? { year: "numeric", month: "numeric", day: "numeric" }
        : { day: "2-digit", month: "short", year: "numeric" },
    ) ?? dictionary.common.deadlinePending;
  const cardValueLabel =
    formatCompactCurrency(locale, opportunity.estimatedContractValueEur) ??
    opportunity.estimatedContractValueText ??
    opportunity.prizeSummary ??
    dictionary.common.valuePending;
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
  const explicitCity = pickOpportunityExplicitCity(opportunity);
  const explicitLocation = opportunity.locationLabel;
  const locationLabel =
    explicitLocation && normalizeLooseText(explicitLocation) !== normalizeLooseText(jurisdictionLabel)
      ? `${jurisdictionLabel} · ${explicitLocation}`
      : explicitCity && normalizeLooseText(explicitCity) !== normalizeLooseText(jurisdictionLabel)
      ? `${jurisdictionLabel} · ${explicitCity}`
      : jurisdictionLabel || explicitLocation || explicitCity || dictionary.common.unknown;
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

export const formatAudienceLabel = (
  dictionary: AppDictionary,
  opportunity: StoredOpportunityFeedItem,
) =>
  joinValues(
    opportunity.audience,
    (value) =>
      translateMappedValue(
        value,
        dictionary.taxonomy.audiences,
        formatTokenLabel(value),
      ),
    dictionary.common.unstated,
  );

export const formatRegionsLabel = (
  dictionary: AppDictionary,
  opportunity: StoredOpportunityFeedItem,
) =>
  joinValues(
    opportunity.regions,
    (value) =>
      translateMappedValue(
        value,
        dictionary.taxonomy.regions,
        formatTokenLabel(value),
      ),
    dictionary.common.unstated,
  );

export const formatCompetitionTagsLabel = (
  dictionary: AppDictionary,
  opportunity: StoredOpportunityFeedItem,
) =>
  joinValues(
    opportunity.competitionTypes,
    (value) =>
      translateMappedValue(
        value,
        dictionary.taxonomy.competitionTags,
        formatTokenLabel(value),
      ),
    dictionary.common.unstated,
  );
