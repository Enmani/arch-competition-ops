import { NextResponse, type NextRequest } from "next/server";

import { localeCookieName, localeCookieOptions } from "./i18n/config";
import { LOCALE_HEADER, localeToRemember, negotiateLocale, resolveLocaleRedirect } from "./i18n/negotiate";
import { SESSION_COOKIE_MAX_AGE_SECONDS, sessionCookieName } from "./lib/session-cookie";

/**
 * Two cross-cutting jobs for every page and API request:
 *
 * 1. Locale. Bare or foreign paths (`/`, `/discover`, `/fr/x`, `/competitions/<slug>`) get a
 *    308 to the negotiated locale; a locale-prefixed page request stamps `x-arch-locale` on
 *    the request so the root layout can render `<html lang>` on the server, and remembers the
 *    choice in the locale cookie. All rules are pure functions in `i18n/negotiate.ts`.
 * 2. Session cookie. The session row is extended on use (see storage `getSession`, 30 days, at
 *    most once a day), but a Server Component cannot set cookies, so without this the cookie
 *    would still expire 30 days after login. Any request carrying a session cookie gets the
 *    same value re-issued with a fresh 30-day lifetime. No database access happens here: an
 *    expired or revoked token simply fails validation later. `/api/auth/*` is excluded so
 *    login/logout keep sole control of the cookie they set or clear.
 */
const isPrefetch = (request: NextRequest) =>
  request.headers.has("next-router-prefetch") ||
  request.headers.get("purpose") === "prefetch" ||
  (request.headers.get("sec-purpose") ?? "").includes("prefetch");

export const middleware = (request: NextRequest) => {
  const production = process.env.NODE_ENV === "production";
  const { pathname, search } = request.nextUrl;
  const cookieLocale = request.cookies.get(localeCookieName)?.value;

  const redirectTarget = resolveLocaleRedirect({
    acceptLanguage: request.headers.get("accept-language"),
    cookieLocale,
    pathname,
    search,
  });
  if (redirectTarget) {
    return NextResponse.redirect(new URL(redirectTarget, request.url), 308);
  }

  const requestHeaders = new Headers(request.headers);
  const pageLocale = pathname.split("/")[1] ?? "";
  requestHeaders.set(
    LOCALE_HEADER,
    negotiateLocale({ acceptLanguage: request.headers.get("accept-language"), cookieLocale: pageLocale || cookieLocale }),
  );
  const response = NextResponse.next({ request: { headers: requestHeaders } });

  const remember = localeToRemember({ cookieLocale, isPrefetch: isPrefetch(request), pathname });
  if (remember) {
    response.cookies.set(localeCookieName, remember, localeCookieOptions(production));
  }

  const name = sessionCookieName(production);
  const token = request.cookies.get(name)?.value;
  if (token) {
    response.cookies.set(name, token, {
      httpOnly: true,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      path: "/",
      sameSite: "lax",
      secure: production,
    });
  }
  return response;
};

export const config = {
  matcher: ["/((?!mcp(?:/|$)|api/auth|api/opportunities/.+/image|_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
