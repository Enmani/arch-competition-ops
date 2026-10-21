import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";

import type { StoredAuthUser, Storage } from "@arch-competition/storage";

import type { AppLocale } from "../i18n/config";
import { HttpError } from "./api/http";
import { buildLoginRedirect } from "./return-path";
import { getStorage } from "./server-storage";
import { readCookie, sessionCookieName } from "./session-cookie";

/**
 * Authentication and authorisation entry points.
 *
 * Pages use `requirePageUser` / `requirePageAdmin` (redirect or 404), API routes use
 * `requireApiUser` / `requireApiAdmin` (throw `HttpError` 401/403, turned into
 * `{ error: { code, message } }` by `guarded()`).
 * Administrators are exactly the signed-in users whose email is listed (case-insensitively) in
 * the comma-separated `ARCH_OPS_ADMIN_EMAILS` variable; nothing else grants admin rights.
 */
type Environment = Record<string, string | undefined>;

export const parseAdminEmails = (value: string | undefined) =>
  new Set(
    (value ?? "")
      .split(/[,;\s]+/)
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0),
  );

export const isAdminEmail = (email: string, environment: Environment = process.env) =>
  parseAdminEmails(environment.ARCH_OPS_ADMIN_EMAILS).has(email.trim().toLowerCase());

const isProduction = () => process.env.NODE_ENV === "production";

/* ---------------------------------- pages ---------------------------------- */

// `cache` de-duplicates the lookup within one request (layout + page + components).
export const getCurrentAuthUser = cache(async (): Promise<StoredAuthUser | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName(isProduction()))?.value ?? null;
  if (!token) {
    return null;
  }
  return (await (await getStorage()).auth.getSession(token))?.user ?? null;
});

/** Signed-in user or a redirect to `/[locale]/login?next=<returnPath>`. */
export const requirePageUser = async (locale: AppLocale, returnPath: string): Promise<StoredAuthUser> => {
  const user = await getCurrentAuthUser();
  if (!user) {
    redirect(buildLoginRedirect(locale, returnPath));
  }
  return user;
};

/** Administrator or a redirect to login (anonymous) / 404 (signed in but not an administrator). */
export const requirePageAdmin = async (locale: AppLocale, returnPath: string): Promise<StoredAuthUser> => {
  const user = await requirePageUser(locale, returnPath);
  if (!isAdminEmail(user.email)) {
    notFound();
  }
  return user;
};

/* ----------------------------------- API ----------------------------------- */

export type AuthDeps = {
  environment?: Environment;
  getStorage: () => Promise<Storage>;
  production?: boolean;
};

export const getRequestSessionToken = (request: Request, production: boolean) =>
  readCookie(request.headers.get("cookie"), sessionCookieName(production));

export const requireApiUser = async (request: Request, deps: AuthDeps): Promise<StoredAuthUser> => {
  const token = getRequestSessionToken(request, deps.production ?? isProduction());
  const session = token ? await (await deps.getStorage()).auth.getSession(token) : null;
  if (!session) {
    throw new HttpError("unauthenticated", "Sign in to continue.");
  }
  return session.user;
};

export const requireApiAdmin = async (request: Request, deps: AuthDeps): Promise<StoredAuthUser> => {
  const user = await requireApiUser(request, deps);
  if (!isAdminEmail(user.email, deps.environment ?? process.env)) {
    throw new HttpError("forbidden", "Administrator access is required.");
  }
  return user;
};
