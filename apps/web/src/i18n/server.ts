import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";

import { isLocale, localeCookieName, type AppLocale } from "@/i18n/config";
import { dictionaries } from "@/i18n/dictionaries";
import { LOCALE_HEADER, negotiateLocale } from "@/i18n/negotiate";

export const getDictionary = (locale: AppLocale) => dictionaries[locale];

export const resolveLocaleOrNotFound = (value: string): AppLocale => {
  if (!isLocale(value)) {
    notFound();
  }

  return value;
};

/** Cookie, then Accept-Language, then the default (see `negotiateLocale`). */
const getPreferredLocale = async (): Promise<AppLocale> => {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);
  return negotiateLocale({
    acceptLanguage: headerStore.get("accept-language"),
    cookieLocale: cookieStore.get(localeCookieName)?.value,
  });
};

/**
 * The locale of the page being rendered. Middleware stamps it on the request from the URL's
 * first segment, so the root layout (which has no `params`) can emit the right `<html lang>`
 * during SSR. Routes that skip middleware fall back to the visitor's preference.
 */
export const getRequestLocale = async (): Promise<AppLocale> => {
  const fromUrl = (await headers()).get(LOCALE_HEADER);
  return fromUrl && isLocale(fromUrl) ? fromUrl : getPreferredLocale();
};
