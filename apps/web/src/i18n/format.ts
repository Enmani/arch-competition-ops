import { describeParticipationFee } from "@arch-competition/core";

import { intlLocaleTags, type AppLocale } from "./config";
import type { AppDictionary } from "./dictionaries";
import { formatTokenLabel } from "../lib/discover";

/** The slice of the dictionary the formatters need; client components receive only this. */
export type CommonCopy = Pick<AppDictionary, "common">;

const normalizeLookupKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

const getIntlLocale = (locale: AppLocale) => intlLocaleTags[locale];

/** Replaces `{name}` placeholders; an unknown placeholder is left visible rather than dropped. */
export const fillTemplate = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    name in values ? String(values[name]) : placeholder,
  );

export const translateMappedValue = (
  value: string | null | undefined,
  map: Record<string, string>,
  fallback: string,
) => {
  if (!value) {
    return fallback;
  }

  const translated = map[normalizeLookupKey(value)];
  if (translated) {
    return translated;
  }

  return formatTokenLabel(value);
};

/**
 * Deadlines, capture and update stamps are stored as calendar dates or UTC instants and carry
 * no zone of their own. Formatting always pins `timeZone` (default UTC) so the server render
 * and every browser print the same day: with the viewer's zone, "2026-11-03" would read as
 * 2 November west of Greenwich and trigger a hydration mismatch.
 */
const DATE_FORMAT: Intl.DateTimeFormatOptions = { dateStyle: "medium", timeZone: "UTC" };
export const DATE_TIME_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  month: "short",
  timeZone: "UTC",
  timeZoneName: "short",
  year: "numeric",
};

export const formatLocalizedDate = (
  locale: AppLocale,
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions = DATE_FORMAT,
) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(getIntlLocale(locale), { ...options, timeZone: options.timeZone ?? "UTC" }).format(
    date,
  );
};

export const formatDeadlineLabel = (
  locale: AppLocale,
  dictionary: CommonCopy,
  value: string | null | undefined,
) => {
  const formatted = formatLocalizedDate(locale, value);
  if (!formatted) {
    return dictionary.common.deadlinePending;
  }

  return `${dictionary.common.closesPrefix} ${formatted}`;
};

export const formatCompactCurrency = (locale: AppLocale, value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return null;
  }

  return new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: "EUR",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
};

export const formatCurrency = (locale: AppLocale, value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return null;
  }

  return new Intl.NumberFormat(getIntlLocale(locale), {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
};

/**
 * Localised participation-fee wording. The decision (pending / free / amounts) comes from
 * core's `describeParticipationFee`, the single rule shared with storage: an unknown (NULL)
 * fee reads as pending and only an explicit 0 reads as no participation fee.
 */
export const formatParticipationCost = (
  locale: AppLocale,
  dictionary: CommonCopy,
  registrationFeeEur: number | null,
  submissionFeeEur: number | null,
) => {
  const fee = describeParticipationFee(registrationFeeEur, submissionFeeEur);
  if (fee.kind === "pending") {
    return dictionary.common.feePending;
  }
  if (fee.kind === "free") {
    return dictionary.common.noParticipationFee;
  }

  const { registrationFee, submissionFee } = dictionary.common.templates;
  const parts: string[] = [];
  if (fee.registrationEur !== null) {
    const amount = formatCurrency(locale, fee.registrationEur) ?? fee.registrationEur.toString();
    parts.push(fillTemplate(registrationFee, { amount }));
  }
  if (fee.submissionEur !== null) {
    const amount = formatCurrency(locale, fee.submissionEur) ?? fee.submissionEur.toString();
    parts.push(fillTemplate(submissionFee, { amount }));
  }

  return parts.join(" / ");
};

export const formatStampLabel = (
  locale: AppLocale,
  dictionary: CommonCopy,
  prefix: "capturedPrefix" | "updatedPrefix",
  value: string | null | undefined,
) => {
  const formatted = formatLocalizedDate(locale, value);
  return `${dictionary.common[prefix]} ${formatted ?? dictionary.common.pending}`;
};
