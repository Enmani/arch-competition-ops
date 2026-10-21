import { createTestStorage, type TestStorage } from "@arch-competition/storage/testing";

import type { AuthDeps } from "./auth";
import { sessionCookieName } from "./session-cookie";

/** Test-only helpers shared by the API tests (never imported by application code). */
export const ORIGIN = "https://app.example.test";

export type ApiTestContext = {
  cleanup(): void;
  deps: AuthDeps;
  signIn(email: string): Promise<{ cookie: string; token: string; userId: string }>;
  test: TestStorage;
};

export const createApiTestContext = (
  { environment = {}, production = false }: { environment?: Record<string, string | undefined>; production?: boolean } = {},
): ApiTestContext => {
  const test = createTestStorage();
  return {
    cleanup: () => test.cleanup(),
    deps: { environment, getStorage: async () => test.storage, production },
    async signIn(email: string) {
      const user = await test.storage.auth.register({ email, password: "correct-password" });
      const { token } = await test.storage.auth.createSession({ userId: user.id });
      return { cookie: `${sessionCookieName(production)}=${token}`, token, userId: user.id };
    },
    test,
  };
};

type RequestOptions = {
  accept?: string;
  body?: unknown;
  contentType?: string | null;
  cookie?: string;
  headers?: Record<string, string>;
  method?: string;
  origin?: string | null;
};

/** Builds a same-origin browser-like request by default; every header can be overridden. */
export const buildRequest = (path: string, options: RequestOptions = {}) => {
  const { accept, body, contentType, cookie, headers = {}, method = "GET", origin = ORIGIN } = options;
  const requestHeaders = new Headers(headers);
  if (origin !== null && method !== "GET") requestHeaders.set("origin", origin);
  if (cookie) requestHeaders.set("cookie", cookie);
  if (accept) requestHeaders.set("accept", accept);

  let payload: BodyInit | undefined;
  if (body instanceof URLSearchParams) {
    payload = body;
    requestHeaders.set("content-type", contentType ?? "application/x-www-form-urlencoded");
  } else if (body !== undefined) {
    payload = typeof body === "string" ? body : JSON.stringify(body);
    if (contentType !== null) requestHeaders.set("content-type", contentType ?? "application/json");
  }
  return new Request(`${ORIGIN}${path}`, { body: payload, headers: requestHeaders, method });
};

export const readError = async (response: Response) => {
  const payload = (await response.json()) as { error: { code: string; message: string } };
  return payload.error;
};
