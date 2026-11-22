import { localeCookieName, localeCookieOptions } from "../i18n/config";

import { SESSION_COOKIE_MAX_AGE_SECONDS, sessionCookieAttributes, sessionCookieName } from "./session-cookie";
import { THEME_STORAGE_KEY } from "./theme";

/**
 * Everything the site itself keeps in the visitor's browser, read from the constants that set
 * it, for the cookie table on the About page. There are no analytics, advertising or other
 * third-party cookies; adding any browser storage means adding a row here (legal-content.test.ts
 * checks the rows against the code that writes them).
 */
export type SiteStorageId = "locale" | "session" | "theme";

export type SiteStorageItem = {
  /** Attributes as the browser shows them, e.g. HttpOnly; empty for localStorage. */
  flags: readonly string[];
  id: SiteStorageId;
  kind: "cookie" | "localStorage";
  /** null: kept until the visitor changes the setting or clears site data. */
  maxAgeSeconds: number | null;
  name: string;
};

const localeFlags = () => {
  const options = localeCookieOptions(true);
  return [
    ...(options.secure ? ["Secure"] : []),
    `SameSite=${options.sameSite[0].toUpperCase()}${options.sameSite.slice(1)}`,
  ];
};

/** Production values (the deployed site runs over https). */
export const SITE_STORAGE: readonly SiteStorageItem[] = [
  {
    flags: sessionCookieAttributes(true).filter((attribute) => attribute !== "Path=/"),
    id: "session",
    kind: "cookie",
    maxAgeSeconds: SESSION_COOKIE_MAX_AGE_SECONDS,
    name: sessionCookieName(true),
  },
  {
    flags: localeFlags(),
    id: "locale",
    kind: "cookie",
    maxAgeSeconds: localeCookieOptions(true).maxAge,
    name: localeCookieName,
  },
  { flags: [], id: "theme", kind: "localStorage", maxAgeSeconds: null, name: THEME_STORAGE_KEY },
];

/** Clears the saved preferences (language cookie and theme). The sign-in session is kept. */
export const clearSavedPreferences = (clearTheme: () => void) => {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${localeCookieName}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  clearTheme();
};
