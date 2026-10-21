import { loginFormSchema, logoutFormSchema, registerFormSchema } from "@arch-competition/core";
import { isStoredAuthError, type Storage } from "@arch-competition/storage";

import { buildLocalePath, defaultLocale, isLocale, type AppLocale } from "../../i18n/config";
import { getRequestSessionToken, type AuthDeps } from "../auth";
import { sanitizeReturnPath } from "../return-path";
import { serializeClearedSessionCookie, serializeSessionCookie } from "../session-cookie";
import { assertFormRequest, assertSameOrigin } from "./csrf";
import { HttpError, clientIp, errorResponse, guarded } from "./http";

/**
 * Login / register / logout form endpoints (`POST /api/auth/*`).
 *
 * - Same-origin only (see ./csrf.ts) and form-encoded bodies only.
 * - Failures never echo the email back (no email in URLs): browsers are redirected to the page
 *   with `?error=<code>`; API clients that do not ask for HTML get `429` + `Retry-After` when
 *   throttled.
 * - Registration answers "that email cannot be used" with one generic code for every failure
 *   that could reveal an existing account (`registration_failed`) and is rate-limited per
 *   client. Email ownership is not verified yet (needs a mail service): documented limitation.
 */
type RedirectOptions = { cookie?: string };

const redirectTo = (path: string, { cookie }: RedirectOptions = {}) => {
  const headers = new Headers({ "cache-control": "no-store", location: path });
  if (cookie) {
    headers.append("set-cookie", cookie);
  }
  return new Response(null, { headers, status: 303 });
};

const resolveLocale = (value: string): AppLocale => (isLocale(value) ? value : defaultLocale);

const readForm = async <Output>(
  request: Request,
  schema: { safeParse(input: unknown): { data: Output; success: true } | { success: false } },
) => {
  assertSameOrigin(request);
  assertFormRequest(request);
  const form = await request.formData();
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") {
      values[key] = value;
    }
  }
  const result = schema.safeParse(values);
  return result.success ? result.data : null;
};

const wantsHtml = (request: Request) => (request.headers.get("accept") ?? "").includes("text/html");

const failureRedirect = (locale: AppLocale, page: "/login" | "/register", error: string, next: string) => {
  const params = new URLSearchParams({ error });
  if (next) {
    params.set("next", next);
  }
  return redirectTo(`${buildLocalePath(locale, page)}?${params.toString()}`);
};

const tooManyAttempts = (request: Request, locale: AppLocale, page: "/login" | "/register", next: string, retryAfterSeconds: number) =>
  wantsHtml(request)
    ? failureRedirect(locale, page, "too_many_attempts", next)
    : errorResponse("rate_limited", "Too many attempts. Please wait before trying again.", {
        "retry-after": String(retryAfterSeconds),
      });

const startSession = async (storage: Storage, request: Request, userId: string, deps: AuthDeps) => {
  const production = deps.production ?? process.env.NODE_ENV === "production";
  const { session, token } = await storage.auth.createSession({
    replaceToken: getRequestSessionToken(request, production),
    userId,
  });
  return serializeSessionCookie(token, session.expiresAt, production);
};

export const createAuthHandlers = (deps: AuthDeps) => ({
  login: guarded("POST /api/auth/login", async (request: Request) => {
    const form = await readForm(request, loginFormSchema);
    const locale = resolveLocale(form?.locale ?? "");
    const next = sanitizeReturnPath(form?.next, locale);
    if (!form || !form.email || !form.password) {
      return failureRedirect(locale, "/login", "missing_fields", form?.next ?? "");
    }

    const storage = await deps.getStorage();
    const subject = { email: form.email, ip: clientIp(request) };
    const throttle = await storage.auth.checkThrottle({ ...subject, scope: "login" });
    if (!throttle.allowed) {
      return tooManyAttempts(request, locale, "/login", form.next, throttle.retryAfterSeconds);
    }

    const user = await storage.auth.authenticate({ email: form.email, password: form.password });
    if (!user) {
      await storage.auth.recordAttempt({ ...subject, scope: "login" });
      return failureRedirect(locale, "/login", "invalid_credentials", form.next);
    }

    await storage.auth.clearLoginFailures(subject);
    return redirectTo(next, { cookie: await startSession(storage, request, user.id, deps) });
  }),

  register: guarded("POST /api/auth/register", async (request: Request) => {
    const form = await readForm(request, registerFormSchema);
    const locale = resolveLocale(form?.locale ?? "");
    const next = sanitizeReturnPath(form?.next, locale);
    if (!form || !form.email || !form.password || !form.passwordConfirmation) {
      return failureRedirect(locale, "/register", "missing_fields", form?.next ?? "");
    }

    const storage = await deps.getStorage();
    const subject = { email: form.email, ip: clientIp(request) };
    const throttle = await storage.auth.checkThrottle({ ip: subject.ip, scope: "register" });
    if (!throttle.allowed) {
      return tooManyAttempts(request, locale, "/register", form.next, throttle.retryAfterSeconds);
    }
    // Every attempt counts, successful or not: this is what bounds account creation per client.
    await storage.auth.recordAttempt({ ip: subject.ip, scope: "register" });

    if (form.password !== form.passwordConfirmation) {
      return failureRedirect(locale, "/register", "password_mismatch", form.next);
    }

    try {
      const user = await storage.auth.register({ email: form.email, password: form.password });
      return redirectTo(next, { cookie: await startSession(storage, request, user.id, deps) });
    } catch (error) {
      if (isStoredAuthError(error)) {
        const code = error.code === "invalid_email" || error.code === "weak_password" ? error.code : "registration_failed";
        return failureRedirect(locale, "/register", code, form.next);
      }
      throw error;
    }
  }),

  logout: guarded("POST /api/auth/logout", async (request: Request) => {
    assertSameOrigin(request);
    const contentType = request.headers.get("content-type") ?? "";
    const values: Record<string, string> = {};
    if (/^(application\/x-www-form-urlencoded|multipart\/form-data)/i.test(contentType)) {
      for (const [key, value] of (await request.formData()).entries()) {
        if (typeof value === "string") values[key] = value;
      }
    } else if (contentType.trim() !== "") {
      throw new HttpError("unsupported_media_type", "Content-Type must be a form encoding.");
    }
    const parsed = logoutFormSchema.safeParse(values);
    const locale = resolveLocale(parsed.success ? parsed.data.locale : "");
    const scope = parsed.success ? parsed.data.scope : "current";

    const production = deps.production ?? process.env.NODE_ENV === "production";
    const token = getRequestSessionToken(request, production);
    if (token) {
      const storage = await deps.getStorage();
      if (scope === "all") {
        const session = await storage.auth.getSession(token);
        if (session) {
          await storage.auth.deleteAllSessions(session.userId);
        }
      }
      await storage.auth.deleteSession(token);
    }
    return redirectTo(buildLocalePath(locale, "/login"), { cookie: serializeClearedSessionCookie(production) });
  }),
});
