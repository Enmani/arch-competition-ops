import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createAuthHandlers } from "./api/auth-routes";
import { buildRequest, createApiTestContext, readError, type ApiTestContext } from "./api-test-support";
import { readCookie, sessionCookieName } from "./session-cookie";

const withContext = async (
  run: (context: ApiTestContext) => Promise<void>,
  options?: Parameters<typeof createApiTestContext>[0],
) => {
  const context = createApiTestContext(options);
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

const form = (values: Record<string, string>) => new URLSearchParams(values);
const loginRequest = (values: Record<string, string>, options: Parameters<typeof buildRequest>[1] = {}) =>
  buildRequest("/api/auth/login", { body: form(values), method: "POST", ...options });

const registerValues = { email: "new@example.com", locale: "en", password: "correct-password", passwordConfirmation: "correct-password" };

const cookieValue = (response: Response, production = false) =>
  readCookie(response.headers.get("set-cookie")?.split(";")[0] ?? null, sessionCookieName(production));

test("login sets a secure session cookie, redirects with 303 and rotates any presented session", async () => {
  await withContext(async (context) => {
    const user = await context.signIn("member@example.com");
    const { login } = createAuthHandlers(context.deps);

    const response = await login(loginRequest({ email: "Member@Example.com", locale: "zh", password: "correct-password" }, { cookie: user.cookie }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/zh/dashboard");

    const setCookie = response.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\//);
    assert.match(setCookie, /Max-Age=\d+/);
    assert.ok(!/Domain=/i.test(setCookie));

    const newToken = cookieValue(response);
    assert.ok(newToken && newToken !== user.token);
    assert.equal(await context.test.storage.auth.getSession(user.token), null, "the presented session is retired");
    assert.equal((await context.test.storage.auth.getSession(newToken))?.user.email, "member@example.com");
  });
});

test("in production the cookie is __Host- prefixed and Secure", async () => {
  await withContext(
    async (context) => {
      await context.signIn("member@example.com");
      const { login } = createAuthHandlers(context.deps);
      const response = await login(loginRequest({ email: "member@example.com", locale: "en", password: "correct-password" }));
      const setCookie = response.headers.get("set-cookie") ?? "";

      assert.ok(setCookie.startsWith("__Host-arch_competition_ops_session="));
      assert.match(setCookie, /; Secure/);
      assert.match(setCookie, /; HttpOnly/);
      assert.match(setCookie, /; SameSite=Lax/);
      assert.match(setCookie, /; Path=\//);
      assert.ok(!/Domain=/i.test(setCookie));
    },
    { production: true },
  );
});

test("login only honours same-site, locale-prefixed return paths", async () => {
  await withContext(async (context) => {
    await context.signIn("member@example.com");
    const { login } = createAuthHandlers(context.deps);
    const redirectFor = async (next: string) =>
      (await login(loginRequest({ email: "member@example.com", locale: "en", next, password: "correct-password" }))).headers.get("location");

    assert.equal(await redirectFor("/en/ops"), "/en/ops");
    assert.equal(await redirectFor("/zh/discover?search=a%20b"), "/zh/discover?search=a%20b");
    for (const hostile of ["https://evil.example", "//evil.example/en", "/\\evil.example", "/api/auth/logout", "/en/\r\nSet-Cookie: x=1", "javascript:alert(1)", ""]) {
      assert.equal(await redirectFor(hostile), "/en/dashboard", hostile);
    }
  });
});

test("failed logins redirect back without echoing the email and without telling which part was wrong", async () => {
  await withContext(async (context) => {
    await context.signIn("member@example.com");
    const { login } = createAuthHandlers(context.deps);
    const wrongPassword = await login(loginRequest({ email: "member@example.com", locale: "en", password: "nope-nope-nope" }));
    const unknownUser = await login(loginRequest({ email: "ghost@example.com", locale: "en", password: "nope-nope-nope" }));

    assert.equal(wrongPassword.status, 303);
    assert.equal(wrongPassword.headers.get("location"), "/en/login?error=invalid_credentials");
    assert.equal(unknownUser.headers.get("location"), wrongPassword.headers.get("location"));
    assert.equal(wrongPassword.headers.get("set-cookie"), null);

    const missing = await login(loginRequest({ email: "", locale: "zh", password: "" }));
    assert.equal(missing.headers.get("location"), "/zh/login?error=missing_fields");
  });
});

test("login is throttled with 429 + Retry-After for API clients and a redirect for browsers", async () => {
  await withContext(async (context) => {
    await context.signIn("member@example.com");
    const { login } = createAuthHandlers(context.deps);
    const attempt = (options: Parameters<typeof buildRequest>[1] = {}) =>
      login(loginRequest({ email: "member@example.com", locale: "en", password: "wrong-wrong-wrong" }, { headers: { "cf-connecting-ip": "203.0.113.7" }, ...options }));

    for (let index = 0; index < 5; index += 1) {
      assert.equal((await attempt()).status, 303);
    }

    const blocked = await attempt();
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal((await readError(blocked)).code, "rate_limited");

    const browser = await attempt({ accept: "text/html,application/xhtml+xml" });
    assert.equal(browser.status, 303);
    assert.equal(browser.headers.get("location"), "/en/login?error=too_many_attempts");

    // Even the correct password is refused while blocked, and another client is unaffected.
    const correctButBlocked = await login(loginRequest({ email: "member@example.com", locale: "en", password: "correct-password" }, { headers: { "cf-connecting-ip": "203.0.113.7" } }));
    assert.equal(correctButBlocked.status, 429);
    const otherClient = await login(loginRequest({ email: "member@example.com", locale: "en", password: "correct-password" }, { headers: { "cf-connecting-ip": "198.51.100.2" } }));
    assert.equal(otherClient.status, 303);
    assert.equal(otherClient.headers.get("location"), "/en/dashboard");
  });
});

test("auth form endpoints reject cross-origin posts and non-form bodies", async () => {
  await withContext(async (context) => {
    const { login, register } = createAuthHandlers(context.deps);
    const crossOrigin = await login(loginRequest({ email: "a@example.com", password: "x" }, { origin: "https://evil.example" }));
    assert.equal(crossOrigin.status, 403);
    assert.equal((await readError(crossOrigin)).code, "csrf_rejected");

    const json = await register(buildRequest("/api/auth/register", { body: { email: "a@example.com" }, method: "POST" }));
    assert.equal(json.status, 415);
    assert.equal((await readError(json)).code, "unsupported_media_type");
  });
});

test("registration creates the account and signs in; the personal data never reaches the URL", async () => {
  await withContext(async (context) => {
    const { register } = createAuthHandlers(context.deps);
    const response = await register(buildRequest("/api/auth/register", { body: form(registerValues), method: "POST" }));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/en/dashboard");
    assert.equal((await context.test.storage.auth.getSession(cookieValue(response)))?.user.email, "new@example.com");

    const mismatch = await register(buildRequest("/api/auth/register", { body: form({ ...registerValues, passwordConfirmation: "different-password" }), method: "POST" }));
    assert.equal(mismatch.headers.get("location"), "/en/register?error=password_mismatch");
    const weak = await register(buildRequest("/api/auth/register", { body: form({ ...registerValues, email: "weak@example.com", password: "short", passwordConfirmation: "short" }), method: "POST" }));
    assert.equal(weak.headers.get("location"), "/en/register?error=weak_password");
    const invalid = await register(buildRequest("/api/auth/register", { body: form({ ...registerValues, email: "not-an-email" }), method: "POST" }));
    assert.equal(invalid.headers.get("location"), "/en/register?error=invalid_email");
  });
});

test("registering an existing email gives the same generic answer and does not reveal the account", async () => {
  await withContext(async (context) => {
    await context.signIn("taken@example.com");
    const { register } = createAuthHandlers(context.deps);
    const response = await register(buildRequest("/api/auth/register", { body: form({ ...registerValues, email: "TAKEN@example.com" }), method: "POST" }));

    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/en/register?error=registration_failed");
    assert.equal(response.headers.get("set-cookie"), null);
    assert.ok(!(response.headers.get("location") ?? "").includes("taken"));
  });
});

test("registration is rate-limited per client address", async () => {
  await withContext(async (context) => {
    const { register } = createAuthHandlers(context.deps);
    const attempt = (index: number) =>
      register(buildRequest("/api/auth/register", { body: form({ ...registerValues, email: `user${index}@example.com` }), headers: { "cf-connecting-ip": "203.0.113.99" }, method: "POST" }));

    for (let index = 0; index < 5; index += 1) {
      assert.equal((await attempt(index)).status, 303);
    }
    const blocked = await attempt(5);
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
  });
});

test("logout is POST-only, same-origin, retires the session and clears the cookie", async () => {
  await withContext(async (context) => {
    const user = await context.signIn("member@example.com");
    const { logout } = createAuthHandlers(context.deps);

    const crossOrigin = await logout(buildRequest("/api/auth/logout", { body: form({ locale: "en" }), cookie: user.cookie, method: "POST", origin: "https://evil.example" }));
    assert.equal(crossOrigin.status, 403);
    assert.ok(await context.test.storage.auth.getSession(user.token));

    const response = await logout(buildRequest("/api/auth/logout", { body: form({ locale: "zh" }), cookie: user.cookie, method: "POST" }));
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "/zh/login");
    assert.match(response.headers.get("set-cookie") ?? "", /Max-Age=0/);
    assert.equal(await context.test.storage.auth.getSession(user.token), null);

    const routeSource = readFileSync(new URL("../app/api/auth/logout/route.ts", import.meta.url), "utf8");
    assert.match(routeSource, /export const POST =/);
    assert.doesNotMatch(routeSource, /export const (GET|PUT|PATCH|DELETE) =/);
  });
});

test("logout with scope=all signs the user out everywhere", async () => {
  await withContext(async (context) => {
    const first = await context.signIn("member@example.com");
    const second = await context.test.storage.auth.createSession({ userId: first.userId });
    const { logout } = createAuthHandlers(context.deps);

    await logout(buildRequest("/api/auth/logout", { body: form({ locale: "en", scope: "all" }), cookie: first.cookie, method: "POST" }));
    assert.equal(await context.test.storage.auth.getSession(first.token), null);
    assert.equal(await context.test.storage.auth.getSession(second.token), null);
  });
});

test("unexpected failures return a generic 500 without internal details", async () => {
  const messages: string[] = [];
  const original = console.error;
  console.error = (line: string) => messages.push(String(line));
  try {
    const { login } = createAuthHandlers({
      getStorage: async () => {
        throw new Error("connection string postgres://admin:hunter2@db/internal exploded");
      },
    });
    const response = await login(loginRequest({ email: "a@example.com", locale: "en", password: "correct-password" }));

    assert.equal(response.status, 500);
    const body = await response.text();
    assert.ok(!body.includes("hunter2") && !body.includes("postgres"));
    assert.deepEqual(JSON.parse(body), { error: { code: "internal_error", message: "Something went wrong on our side. Please try again later." } });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /api.unhandled_error/);
    assert.ok(!messages[0].includes("correct-password"));
  } finally {
    console.error = original;
  }
});
