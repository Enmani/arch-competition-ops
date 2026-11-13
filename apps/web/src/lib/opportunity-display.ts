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
import { getOpportunityJurisdictionCode, pickOpportunityDisplayLocality } from "@arch-competition/previews/location";

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

/** The title to show: the AI-condensed one in the reader's language, else the rule-cleaned source title. */
export const pickDisplayTitle = (locale: AppLocale, opportunity: StoredOpportunityFeedItem) =>
  (locale === "zh" ? opportunity.displayTitleZh : opportunity.displayTitleEn) ?? opportunity.displayTitle;

/** A card has room for an amount, not a sentence; longer stated values stay on the detail page. */
const CARD_VALUE_TEXT_MAX_LENGTH = 32;

const pickShortValueText = (value: string | null) => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length <= CARD_VALUE_TEXT_MAX_LENGTH ? trimmed : null;
};

/** A Chinese address leads with the city: 柳州市鸡喇路1号 reads as 柳州市. */
const HAN_CITY_LEAD_PATTERN = /^[\p{Script=Han}]{2,10}?(?:市|县|区|旗|镇|乡|街道)/u;
/** A segment that is a street address, not a city, is skipped in favour of the next one. */
const ADDRESS_SEGMENT_PATTERN =
  /(?:\d|路|街|道|巷|弄|号|大道|广场|园区|新区|开发区|\b(?:avenue|ave|boulevard|bd|calle|gasse|laan|piazza|platz|road|rd|rue|straat|strasse|straße|street|st|ulica|via|viale|weg)\b)/iu;
const TRAILING_PARENTHETICAL_PATTERN = /\s*[（(][^）)]*[）)]\s*$/u;
const CARD_CITY_MAX_LENGTH = 28;

const trimLocationSegment = (value: string) => value.replace(TRAILING_PARENTHETICAL_PATTERN, "").trim();

/**
 * The card line reads like a gallery caption: "New York, US". The city comes from the stored
 * locality (an address is reduced to its leading city, never invented), the country from the
 * jurisdiction record; a locality that cannot be reduced to a city falls back to the country alone.
 */
export const pickCardLocationLine = (opportunity: StoredOpportunityFeedItem) => {
  // The locator rejects a label that is really a street address ("230 Milson Line, Palmerston
  // North"); the card still reads the city from the stored label, never from the street.
  const locality =
    (pickOpportunityDisplayLocality(opportunity) ?? opportunity.locationLabel ?? "").trim();
  const hanCity = HAN_CITY_LEAD_PATTERN.exec(locality)?.[0];
  const city =
    (hanCity ? trimLocationSegment(hanCity) : null) ??
    locality
      .split(/[,，;；]/u)
      .map((segment) => trimLocationSegment(segment))
      .find((segment) => segment.length > 0 && !ADDRESS_SEGMENT_PATTERN.test(segment)) ??
    "";
  const countryCode = getOpportunityJurisdictionCode(opportunity);
  const countryName = opportunity.jurisdictionLabel.trim();

  if (!city || city.length > CARD_CITY_MAX_LENGTH) {
    return countryName || countryCode;
  }

  return `${city}, ${countryCode}`;
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
    pickShortValueText(opportunity.estimatedContractValueText) ??
    pickShortValueText(opportunity.prizeSummary);
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
  // The card keeps to four facts; the full stored location stays on the detail page.
  const locationLineLabel = pickCardLocationLine(opportunity);

  return {
    authorityLabel,
    displayTitle: pickDisplayTitle(locale, opportunity),
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
    locationLineLabel,
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
