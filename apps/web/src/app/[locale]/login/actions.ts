"use server";

import { redirect } from "next/navigation";

import {
  authenticateStoredAuthUser,
  createStoredAuthSession,
} from "@arch-competition/storage";

import { buildLocalePath, defaultLocale, isLocale, type AppLocale } from "@/i18n/config";
import { setAuthSessionCookie } from "@/lib/auth";

const readFormValue = (formData: FormData, key: string, trim = false) => {
  const value = formData.get(key);
  if (typeof value !== "string") {
    return "";
  }
  return trim ? value.trim() : value;
};

const redirectWithError = (locale: AppLocale, error: string, email = ""): never => {
  const params = new URLSearchParams({ error });
  if (email) {
    params.set("email", email);
  }
  redirect(`${buildLocalePath(locale, "/login")}?${params.toString()}`);
};

export const loginAction = async (rawLocale: AppLocale, formData: FormData) => {
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const email = readFormValue(formData, "email", true);
  const password = readFormValue(formData, "password");

  if (!email || !password) {
    redirectWithError(locale, "missing_fields", email);
  }

  const user = authenticateStoredAuthUser({ email, password });
  if (!user) {
    return redirectWithError(locale, "invalid_credentials", email);
  }

  const { session, token } = createStoredAuthSession({ userId: user.id });
  await setAuthSessionCookie(token, session.expiresAt);
  redirect(buildLocalePath(locale, "/dashboard"));
};
