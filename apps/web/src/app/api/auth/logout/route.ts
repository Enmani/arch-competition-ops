import { type NextRequest, NextResponse } from "next/server";

import { buildLocalePath, defaultLocale, isLocale } from "@/i18n/config";
import { authSessionCookieName, authSessionCookieOptions } from "@/lib/auth";
import { deleteWebAuthSession } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

export const GET = async (request: NextRequest) => {
  const url = new URL(request.url);
  const rawLocale = url.searchParams.get("locale") ?? "";
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const token = request.cookies.get(authSessionCookieName)?.value;

  if (token) {
    await deleteWebAuthSession(token);
  }

  const response = NextResponse.redirect(new URL(buildLocalePath(locale, "/login"), request.url));
  response.cookies.set(authSessionCookieName, "", {
    ...authSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
};
