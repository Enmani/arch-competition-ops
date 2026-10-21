import { headers } from "next/headers";
import type { Metadata } from "next";

import { buildLocalePath, defaultLocale, locales, type AppLocale } from "@/i18n/config";
import { getDictionary } from "@/i18n/server";
import { resolveSiteOrigin } from "./site-url";

type StaticPageKey = keyof ReturnType<typeof getDictionary>["meta"]["pages"];

export const getSiteOrigin = async () => {
  const headerStore = await headers();
  return resolveSiteOrigin({
    configured: process.env.SITE_URL,
    forwardedProto: headerStore.get("x-forwarded-proto"),
    host: headerStore.get("x-forwarded-host") ?? headerStore.get("host"),
  });
};

/** canonical + hreflang alternates for a locale-independent path such as `/discover`. */
const buildAlternates = (locale: AppLocale, path: string): NonNullable<Metadata["alternates"]> => ({
  canonical: buildLocalePath(locale, path),
  languages: {
    ...Object.fromEntries(locales.map((item) => [item, buildLocalePath(item, path)])),
    "x-default": buildLocalePath(defaultLocale, path),
  },
});

type PageMetadataInput = {
  description: string;
  index?: boolean;
  locale: AppLocale;
  path: string;
  title: string;
  type?: "article" | "website";
  images?: string[];
};

/** One place that assembles title, description, robots, hreflang and Open Graph for a page. */
export const composePageMetadata = ({
  description,
  images,
  index = true,
  locale,
  path,
  title,
  type = "website",
}: PageMetadataInput): Metadata => {
  const { meta } = getDictionary(locale);
  const url = buildLocalePath(locale, path);
  return {
    alternates: buildAlternates(locale, path),
    description,
    openGraph: {
      alternateLocale: locales.filter((item) => item !== locale).map((item) => getDictionary(item).meta.ogLocale),
      description,
      images,
      locale: meta.ogLocale,
      siteName: meta.siteName,
      title: `${title} | ${meta.siteName}`,
      type,
      url,
    },
    robots: index ? undefined : { follow: false, index: false },
    title,
  };
};

export const buildPageMetadata = (
  locale: AppLocale,
  page: StaticPageKey,
  path: string,
  options: { index?: boolean } = {},
): Metadata => {
  const copy = getDictionary(locale).meta.pages[page];
  return composePageMetadata({ description: copy.description, index: options.index, locale, path, title: copy.title });
};
