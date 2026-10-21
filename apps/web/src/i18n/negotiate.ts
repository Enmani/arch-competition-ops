import { defaultLocale, isLocale, localeCookieName, type AppLocale } from "./config";

/**
 * Locale negotiation and the bare-path redirect rule. Pure functions with no framework imports:
 * `middleware.ts` applies them to every page request, and `negotiate.test.ts` pins the rules.
 *
 * Preference order: locale cookie, then `Accept-Language` (q-values and regions honoured),
 * then `defaultLocale`.
 */
export { localeCookieName };

/** Request header through which middleware tells Server Components which locale the URL selected. */
export const LOCALE_HEADER = "x-arch-locale";

type LanguageRange = { order: number; quality: number; tag: string };

/** Parses an `Accept-Language` header into ranges sorted by quality (ties keep header order). */
export const parseAcceptLanguage = (header: string | null | undefined): LanguageRange[] => {
  if (!header) {
    return [];
  }

  const ranges: LanguageRange[] = [];
  header.split(",").forEach((part, order) => {
    const [rawTag, ...parameters] = part.split(";");
    const tag = rawTag.trim().toLowerCase();
    if (!tag || tag === "*") {
      return;
    }

    let quality = 1;
    for (const parameter of parameters) {
      const [name, value] = parameter.split("=");
      if (name?.trim().toLowerCase() === "q") {
        quality = Number(value?.trim());
      }
    }
    // q outside 0..1 or not a number is a malformed range: ignore it rather than guess.
    if (!Number.isFinite(quality) || quality <= 0 || quality > 1) {
      return;
    }
    ranges.push({ order, quality, tag });
  });

  return ranges.sort((left, right) => right.quality - left.quality || left.order - right.order);
};

/** Maps a language tag such as `zh-CN`, `en-US` or `ZH` to a supported locale, if any. */
const localeFromLanguageTag = (tag: string): AppLocale | null => {
  const primary = tag.trim().toLowerCase().split(/[-_]/)[0] ?? "";
  return isLocale(primary) ? primary : null;
};

export const negotiateLocale = (input: {
  acceptLanguage?: string | null;
  cookieLocale?: string | null;
}): AppLocale => {
  if (input.cookieLocale && isLocale(input.cookieLocale)) {
    return input.cookieLocale;
  }

  for (const range of parseAcceptLanguage(input.acceptLanguage)) {
    const locale = localeFromLanguageTag(range.tag);
    if (locale) {
      return locale;
    }
  }

  return defaultLocale;
};

const STATIC_FILE_PATTERN =
  /\.(?:avif|css|gif|ico|jpe?g|js|json|map|png|svg|txt|webmanifest|webp|woff2?|xml)$/i;
// Two letters plus optional subtags: looks like a locale prefix (`fr`, `en-GB`, `zh_CN`).
const LOCALE_LIKE_PATTERN = /^[a-z]{2}(?:[-_][a-z0-9]{2,8})*$/i;
const LEGACY_DETAIL_SEGMENT = "competitions";
const DETAIL_SEGMENT = "opportunities";

const safeDecode = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** Re-encodes a path segment once, so `%20`, raw unicode and already-encoded slugs end up equal. */
const normalizeSegment = (segment: string) => encodeURIComponent(safeDecode(segment));

const toPath = (locale: AppLocale, rest: string[]) => {
  const [first, ...tail] = rest;
  // `/competitions/<slug>` is the pre-i18n detail URL; it maps to `/opportunities/<slug>`.
  const mapped = first === LEGACY_DETAIL_SEGMENT ? [DETAIL_SEGMENT, ...tail.map(normalizeSegment)] : rest;
  return mapped.length === 0 ? `/${locale}/discover` : `/${locale}/${mapped.join("/")}`;
};

type LocaleRedirectInput = {
  acceptLanguage?: string | null;
  cookieLocale?: string | null;
  pathname: string;
  /** Raw query string including the leading `?`, or an empty string. */
  search?: string;
};

/**
 * The permanent (308) redirect target for a page request, or `null` when the request needs
 * none. API routes, Next internals and static files are never redirected.
 *
 * - `/`                         -> `/<preferred>/discover`
 * - `/discover?x=1`             -> `/<preferred>/discover?x=1`
 * - `/competitions/<slug>`      -> `/<preferred>/opportunities/<slug>`
 * - `/<locale>`                 -> `/<locale>/discover`
 * - `/<locale>/competitions/s`  -> `/<locale>/opportunities/s`
 * - `/en-GB/x`                  -> `/en/x` (a region of a supported language)
 * - `/fr/x` (unsupported)       -> `/<preferred>/x`
 */
export const resolveLocaleRedirect = (input: LocaleRedirectInput): string | null => {
  const { pathname } = input;
  const search = input.search ?? "";
  if (
    pathname === "/api" ||
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    STATIC_FILE_PATTERN.test(pathname)
  ) {
    return null;
  }

  // Dropping empty segments also collapses `//` so a redirect can never become protocol-relative.
  const segments = pathname.split("/").filter((segment) => segment.length > 0);
  const [first, ...rest] = segments;
  const preferred = () => negotiateLocale(input);

  if (first && isLocale(first)) {
    const needsRedirect = rest.length === 0 || rest[0] === LEGACY_DETAIL_SEGMENT || pathname.includes("//");
    return needsRedirect ? `${toPath(first, rest)}${search}` : null;
  }

  if (first && LOCALE_LIKE_PATTERN.test(first)) {
    return `${toPath(localeFromLanguageTag(first) ?? preferred(), rest)}${search}`;
  }

  return `${toPath(preferred(), segments)}${search}`;
};

/**
 * The locale to remember in the cookie after serving a page: the one in the URL, unless the
 * cookie already holds it. Prefetches are skipped because the locale switcher link is
 * prefetched without the visitor having chosen that language.
 */
export const localeToRemember = (input: {
  cookieLocale?: string | null;
  isPrefetch: boolean;
  pathname: string;
}): AppLocale | null => {
  if (input.isPrefetch) {
    return null;
  }
  const first = input.pathname.split("/").find((segment) => segment.length > 0);
  if (!first || !isLocale(first) || first === input.cookieLocale) {
    return null;
  }
  return first;
};
