import { type NextRequest, NextResponse } from "next/server";

import { authSessionCookieName, authSessionCookieOptions } from "@/lib/auth";
import { buildLocalePath, defaultLocale, isLocale, type AppLocale } from "@/i18n/config";
import {
  createWebAuthSession,
  createWebAuthUser,
  isAuthStorageError,
} from "@/lib/server-storage";

export const dynamic = "force-dynamic";

const readFormValue = (formData: FormData, key: string, trim = false) => {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return "";
  }
  return trim ? value.trim() : value;
};

const resolveLocale = (value: string) => (isLocale(value) ? value : defaultLocale);

const buildRedirectResponse = (request: NextRequest, pathname: string) =>
  NextResponse.redirect(new URL(pathname, request.url), { status: 303 });

const buildErrorResponse = (
  request: NextRequest,
  locale: AppLocale,
  error: string,
  email = "",
) => {
  const params = new URLSearchParams({ error });
  if (email) {
    params.set("email", email);
  }

  return buildRedirectResponse(
    request,
    `${buildLocalePath(locale, "/register")}?${params.toString()}`,
  );
};

export const POST = async (request: NextRequest) => {
  const formData = await request.formData();
  const locale = resolveLocale(readFormValue(formData, "locale"));
  const email = readFormValue(formData, "email", true);
  const password = readFormValue(formData, "password");
  const passwordConfirmation = readFormValue(formData, "passwordConfirmation");

  if (!email || !password || !passwordConfirmation) {
    return buildErrorResponse(request, locale, "missing_fields", email);
  }

  if (password !== passwordConfirmation) {
    return buildErrorResponse(request, locale, "password_mismatch", email);
  }

  try {
    const user = await createWebAuthUser({ email, password });
    const { session, token } = await createWebAuthSession({ userId: user.id });
    const response = buildRedirectResponse(request, buildLocalePath(locale, "/dashboard"));

    response.cookies.set(
      authSessionCookieName,
      token,
      authSessionCookieOptions(session.expiresAt),
    );

    return response;
  } catch (error) {
    if (isAuthStorageError(error)) {
      return buildErrorResponse(request, locale, error.code, email);
    }

    return buildErrorResponse(request, locale, "unexpected", email);
  }
};
