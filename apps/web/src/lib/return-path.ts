import { buildLocalePath, isLocale, type AppLocale } from "../i18n/config";

/**
 * Where to send a user after signing in. The value comes from a query string or a form field,
 * so it is untrusted: only same-site absolute paths that start with a known locale segment are
 * accepted. Anything else (other origins, protocol-relative `//host`, backslashes, control
 * characters, unknown prefixes) falls back to the dashboard.
 */
export const sanitizeReturnPath = (value: unknown, locale: AppLocale) => {
  const fallback = buildLocalePath(locale, "/dashboard");
  if (typeof value !== "string" || value.length === 0 || value.length > 500) {
    return fallback;
  }
  if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(value)) {
    return fallback;
  }
  const [firstSegment] = value.split(/[/?#]/).filter(Boolean);
  if (!firstSegment || !isLocale(firstSegment)) {
    return fallback;
  }
  return value;
};

export const buildLoginRedirect = (locale: AppLocale, returnPath: string) =>
  `${buildLocalePath(locale, "/login")}?next=${encodeURIComponent(sanitizeReturnPath(returnPath, locale))}`;
