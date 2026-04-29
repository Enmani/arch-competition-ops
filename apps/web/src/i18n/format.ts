import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { formatTokenLabel } from "@/lib/discover";

const normalizeLookupKey = (value: string) => value.trim().toLowerCase().replace(/\s+/g, "_");

export const getIntlLocale = (locale: AppLocale) => (locale === "zh" ? "zh-CN" : "en-GB");

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

export const formatLocalizedDate = (
  locale: AppLocale,
  value: string | null | undefined,
  options: Intl.DateTimeFormatOptions,
) => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(getIntlLocale(locale), options).format(date);
};

export const formatDeadlineLabel = (
  locale: AppLocale,
  dictionary: AppDictionary,
  value: string | null | undefined,
) => {
  const formatted = formatLocalizedDate(
    locale,
    value,
    locale === "zh"
      ? { year: "numeric", month: "numeric", day: "numeric" }
      : { day: "2-digit", month: "short", year: "numeric" },
  );

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

export const formatParticipationCost = (
  locale: AppLocale,
  dictionary: AppDictionary,
  registrationFeeEur: number | null,
  submissionFeeEur: number | null,
) => {
  if ((registrationFeeEur ?? 0) === 0 && (submissionFeeEur ?? 0) === 0) {
    return dictionary.common.noParticipationFee;
  }

  const parts: string[] = [];
  if (registrationFeeEur !== null) {
    const amount = formatCurrency(locale, registrationFeeEur) ?? registrationFeeEur.toString();
    parts.push(locale === "zh" ? `${amount} 注册` : `${amount} registration`);
  }
  if (submissionFeeEur !== null) {
    const amount = formatCurrency(locale, submissionFeeEur) ?? submissionFeeEur.toString();
    parts.push(locale === "zh" ? `${amount} 提交` : `${amount} submission`);
  }

  return parts.join(" / ") || dictionary.common.feePending;
};

export const formatStampLabel = (
  locale: AppLocale,
  dictionary: AppDictionary,
  prefix: "capturedPrefix" | "updatedPrefix",
  value: string | null | undefined,
) => {
  const formatted = formatLocalizedDate(
    locale,
    value,
    locale === "zh"
      ? { year: "numeric", month: "numeric", day: "numeric" }
      : { day: "2-digit", month: "short", year: "numeric" },
  );

  if (!formatted) {
    return `${dictionary.common[prefix]} ${dictionary.common.pending}`;
  }

  return `${dictionary.common[prefix]} ${formatted}`;
};
