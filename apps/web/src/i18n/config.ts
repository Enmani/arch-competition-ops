export const locales = ["zh", "en"] as const;

export type AppLocale = (typeof locales)[number];

export const defaultLocale: AppLocale = "zh";
export const localeCookieName = "arch_competition_ops_locale";

export const isLocale = (value: string): value is AppLocale =>
  locales.includes(value as AppLocale);

export const buildLocalePath = (locale: AppLocale, pathname = "/") => {
  const normalizedPathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return normalizedPathname === "/" ? `/${locale}` : `/${locale}${normalizedPathname}`;
};

export const stripLocalePrefix = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);
  if (segments.length === 0) {
    return "/";
  }

  const [maybeLocale, ...rest] = segments;
  if (!maybeLocale || !isLocale(maybeLocale)) {
    return pathname || "/";
  }

  return rest.length === 0 ? "/" : `/${rest.join("/")}`;
};

export const serializeSearchParams = (
  searchParams: Record<string, string | string[] | undefined>,
) => {
  const urlSearchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item) {
          urlSearchParams.append(key, item);
        }
      });
      continue;
    }

    if (value) {
      urlSearchParams.set(key, value);
    }
  }

  const serialized = urlSearchParams.toString();
  return serialized ? `?${serialized}` : "";
};
