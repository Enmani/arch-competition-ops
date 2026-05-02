"use server";

import { redirect } from "next/navigation";

import { buildLocalePath, defaultLocale, isLocale, type AppLocale } from "@/i18n/config";
import { setAuthSessionCookie } from "@/lib/auth";
import {
  createWebAuthSession,
  createWebAuthUser,
  isAuthStorageError,
  type StoredAuthUser,
} from "@/lib/server-storage";

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
  redirect(`${buildLocalePath(locale, "/register")}?${params.toString()}`);
};

export const registerAction = async (rawLocale: AppLocale, formData: FormData) => {
  const locale = isLocale(rawLocale) ? rawLocale : defaultLocale;
  const email = readFormValue(formData, "email", true);
  const password = readFormValue(formData, "password");
  const passwordConfirmation = readFormValue(formData, "passwordConfirmation");

  if (!email || !password || !passwordConfirmation) {
    redirectWithError(locale, "missing_fields", email);
  }

  if (password !== passwordConfirmation) {
    redirectWithError(locale, "password_mismatch", email);
  }

  let user: StoredAuthUser;
  try {
    user = await createWebAuthUser({ email, password });
  } catch (error) {
    if (isAuthStorageError(error)) {
      return redirectWithError(locale, error.code, email);
    }
    return redirectWithError(locale, "unexpected", email);
  }

  const { session, token } = await createWebAuthSession({ userId: user.id });
  await setAuthSessionCookie(token, session.expiresAt);
  redirect(buildLocalePath(locale, "/dashboard"));
};
