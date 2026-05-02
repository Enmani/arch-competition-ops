import { cookies } from "next/headers";

import { getWebAuthSession, type StoredAuthUser } from "@/lib/server-storage";

export const authSessionCookieName = "arch_competition_ops_session";

export const authSessionCookieOptions = (expiresAt?: string) => {
  const options = {
    httpOnly: true,
    path: "/",
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
  };

  return expiresAt ? { ...options, expires: new Date(expiresAt) } : options;
};

export const getAuthSessionToken = async () => {
  const cookieStore = await cookies();
  return cookieStore.get(authSessionCookieName)?.value ?? null;
};

export const setAuthSessionCookie = async (token: string, expiresAt: string) => {
  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, token, authSessionCookieOptions(expiresAt));
};

export const clearAuthSessionCookie = async () => {
  const cookieStore = await cookies();
  cookieStore.set(authSessionCookieName, "", {
    ...authSessionCookieOptions(),
    maxAge: 0,
  });
};

export const getCurrentAuthUser = async (): Promise<StoredAuthUser | null> => {
  const token = await getAuthSessionToken();
  return (await getWebAuthSession(token))?.user ?? null;
};
