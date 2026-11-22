/**
 * Session cookie naming and serialisation (pure, no framework imports).
 *
 * Production: `__Host-` prefix (the browser then enforces Secure, Path=/ and no Domain),
 * Secure, HttpOnly, SameSite=Lax. Local development over http cannot set Secure cookies on
 * every browser, so it uses the plain name without Secure.
 */
const BASE_NAME = "arch_competition_ops_session";

/** Browser lifetime of the session cookie; middleware re-issues it on every visit (see middleware.ts). */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const sessionCookieName = (production: boolean) => (production ? `__Host-${BASE_NAME}` : BASE_NAME);

export const readCookie = (cookieHeader: string | null, name: string) => {
  if (!cookieHeader) {
    return null;
  }
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator > 0 && part.slice(0, separator).trim() === name) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
};

export const sessionCookieAttributes = (production: boolean) => ["Path=/", "HttpOnly", "SameSite=Lax", ...(production ? ["Secure"] : [])];

export const serializeSessionCookie = (token: string, expiresAt: string, production: boolean) => {
  const expires = new Date(expiresAt);
  const maxAge = Math.max(0, Math.floor((expires.getTime() - Date.now()) / 1000));
  return [`${sessionCookieName(production)}=${token}`, ...sessionCookieAttributes(production), `Expires=${expires.toUTCString()}`, `Max-Age=${maxAge}`].join("; ");
};

export const serializeClearedSessionCookie = (production: boolean) =>
  [`${sessionCookieName(production)}=`, ...sessionCookieAttributes(production), "Expires=Thu, 01 Jan 1970 00:00:00 GMT", "Max-Age=0"].join("; ");
