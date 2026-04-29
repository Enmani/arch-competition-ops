import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import {
  defaultLocale,
  isLocale,
  localeCookieName,
  type AppLocale,
} from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionaries";

export const getDictionary = (locale: AppLocale) => dictionaries[locale];

export const resolveLocaleOrNotFound = (value: string): AppLocale => {
  if (!isLocale(value)) {
    notFound();
  }

  return value;
};

export const getPreferredLocale = async (): Promise<AppLocale> => {
  const cookieStore = await cookies();
  const cookieLocale = cookieStore.get(localeCookieName)?.value;

  if (cookieLocale && isLocale(cookieLocale)) {
    return cookieLocale;
  }

  const headerStore = await headers();
  const acceptLanguage = headerStore.get("accept-language")?.toLowerCase() ?? "";

  if (acceptLanguage.includes("zh")) {
    return "zh";
  }

  if (acceptLanguage.includes("en")) {
    return "en";
  }

  return defaultLocale;
};
