import assert from "node:assert/strict";
import { randomBytes, scryptSync } from "node:crypto";
import test from "node:test";

import { AUTH_THROTTLE_POLICIES, SESSION_LIFETIME_MS, StoredAuthError } from "./index";
import { DUMMY_PASSWORD_HASH, SCRYPT_PARAMS, hashPassword, verifyPassword } from "./auth/password";
import { bytesToBase64Url } from "./auth/encoding";
import { createTestStorage, type TestStorage } from "./testing";

const withStorage = async (run: (context: TestStorage) => Promise<void>) => {
  const context = createTestStorage();
  try {
    await run(context);
  } finally {
    context.cleanup();
  }
};

const storedHash = (context: TestStorage, email: string) =>
  (context.raw.prepare("SELECT password_hash FROM auth_users WHERE email = ?").get(email) as { password_hash: string })
    .password_hash;

const legacyNodeHash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64, { N: 16_384, p: 1, r: 8 }).toString("hex");
  return `scrypt$16384$8$1$${salt}$${hash}`;
};

const legacyWorkersHash = (password: string) => {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16_384, p: 1, r: 8 });
  return `scrypt$16384$8$1$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(hash))}`;
};

test("registration normalizes the email, stores a self-describing PHC hash and never the password", async () => {
  await withStorage(async (context) => {
    const user = await context.storage.auth.register({ email: "  Studio@Example.COM ", password: "correct-password" });

    assert.equal(user.email, "studio@example.com");
    const hash = storedHash(context, "studio@example.com");
    assert.match(hash, /^\$scrypt\$ln=14,r=8,p=5\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/);
    assert.ok(!hash.includes("correct-password"));
  });
});

test("registration rejects invalid emails, short passwords and duplicate emails (case-insensitive)", async () => {
  await withStorage(async ({ storage }) => {
    await storage.auth.register({ email: "owner@example.com", password: "correct-password" });

    await assert.rejects(storage.auth.register({ email: "owner@example.com", password: "another-password" }), (error) =>
      error instanceof StoredAuthError && error.code === "email_taken",
    );
    await assert.rejects(storage.auth.register({ email: "OWNER@EXAMPLE.COM", password: "another-password" }), (error) =>
      error instanceof StoredAuthError && error.code === "email_taken",
    );
    await assert.rejects(storage.auth.register({ email: "not-an-email", password: "correct-password" }), (error) =>
      error instanceof StoredAuthError && error.code === "invalid_email",
    );
    await assert.rejects(storage.auth.register({ email: "a@example.com", password: "short" }), (error) =>
      error instanceof StoredAuthError && error.code === "weak_password",
    );
  });
});

test("concurrent registrations of one email create exactly one account", async () => {
  await withStorage(async (context) => {
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => context.storage.auth.register({ email: "race@example.com", password: "correct-password" })),
    );
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((context.raw.prepare("SELECT COUNT(*) AS total FROM auth_users").get() as { total: number }).total, 1);
  });
});

test("authentication accepts the right password and rejects wrong, empty and unknown credentials", async () => {
  await withStorage(async ({ storage }) => {
    await storage.auth.register({ email: "user@example.com", password: "correct-password" });

    assert.equal((await storage.auth.authenticate({ email: "USER@example.com", password: "correct-password" }))?.email, "user@example.com");
    assert.equal(await storage.auth.authenticate({ email: "user@example.com", password: "wrong-password" }), null);
    assert.equal(await storage.auth.authenticate({ email: "user@example.com", password: "" }), null);
    assert.equal(await storage.auth.authenticate({ email: "ghost@example.com", password: "correct-password" }), null);
    assert.equal(await storage.auth.authenticate({ email: "garbage", password: "correct-password" }), null);
  });
});

test("unknown emails still pay for a full scrypt verification", async () => {
  await withStorage(async ({ storage }) => {
    await storage.auth.register({ email: "user@example.com", password: "correct-password" });
    const measure = async (email: string) => {
      const started = performance.now();
      await storage.auth.authenticate({ email, password: "wrong-password" });
      return performance.now() - started;
    };
    await measure("warmup@example.com");
    const known = await measure("user@example.com");
    const unknown = await measure("ghost@example.com");

    // Both paths run scrypt with the same parameters (~100ms+); a skipped hash would take < 20ms.
    assert.ok(unknown > known * 0.5, `unknown ${unknown.toFixed(1)}ms vs known ${known.toFixed(1)}ms`);
    assert.ok(unknown > 30, `unknown-email path too fast: ${unknown.toFixed(1)}ms`);
  });
});

test("the dummy hash is valid and uses exactly the current scrypt parameters", async () => {
  assert.ok(
    DUMMY_PASSWORD_HASH.startsWith(`$scrypt$ln=${SCRYPT_PARAMS.ln},r=${SCRYPT_PARAMS.r},p=${SCRYPT_PARAMS.p}$`),
    "regenerate DUMMY_PASSWORD_HASH after changing SCRYPT_PARAMS",
  );
  assert.deepEqual(await verifyPassword("anything", DUMMY_PASSWORD_HASH), { needsRehash: false, valid: false });
});

test("verification compares raw bytes: hashes round-trip and tampering is rejected", async () => {
  const hash = await hashPassword("pässwörd-密码");
  assert.deepEqual(await verifyPassword("pässwörd-密码", hash), { needsRehash: false, valid: true });
  assert.equal((await verifyPassword("pässwörd-密", hash)).valid, false);
  const [, , , salt, digest] = hash.split("$");
  const tampered = hash.replace(digest, `${digest.slice(0, -2)}${digest.endsWith("AA") ? "BB" : "AA"}`);
  assert.equal((await verifyPassword("pässwörd-密码", tampered)).valid, false);
  assert.equal((await verifyPassword("x", `$scrypt$ln=14,r=8,p=5$${salt}`)).valid, false);
  assert.equal((await verifyPassword("x", "plaintext")).valid, false);
  assert.equal((await verifyPassword("x", "$scrypt$ln=40,r=8,p=5$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAA")).valid, false);
});

test("legacy Node-format hashes still verify and are upgraded to the PHC format on login", async () => {
  await withStorage(async (context) => {
    const { raw, storage } = context;
    const legacy = legacyNodeHash("old-node-password");
    raw.prepare("INSERT INTO auth_users (id, email, password_hash, created_at, updated_at) VALUES ('u1', 'node@example.com', ?, 'x', 'x')").run(legacy);

    assert.equal(await storage.auth.authenticate({ email: "node@example.com", password: "wrong" }), null);
    assert.equal(storedHash(context, "node@example.com"), legacy);

    assert.equal((await storage.auth.authenticate({ email: "node@example.com", password: "old-node-password" }))?.id, "u1");
    const upgraded = storedHash(context, "node@example.com");
    assert.notEqual(upgraded, legacy);
    assert.match(upgraded, /^\$scrypt\$ln=14,r=8,p=5\$/);
    assert.equal((await storage.auth.authenticate({ email: "node@example.com", password: "old-node-password" }))?.id, "u1");
    assert.equal(storedHash(context, "node@example.com"), upgraded);
  });
});

test("legacy Workers-format hashes still verify and are upgraded on login", async () => {
  await withStorage(async (context) => {
    const legacy = legacyWorkersHash("old-workers-password");
    context.raw.prepare("INSERT INTO auth_users (id, email, password_hash, created_at, updated_at) VALUES ('u2', 'workers@example.com', ?, 'x', 'x')").run(legacy);

    assert.equal((await context.storage.auth.authenticate({ email: "workers@example.com", password: "old-workers-password" }))?.id, "u2");
    assert.match(storedHash(context, "workers@example.com"), /^\$scrypt\$ln=14,r=8,p=5\$/);
  });
});

test("a PHC hash with weaker parameters is upgraded too", async () => {
  await withStorage(async (context) => {
    const salt = randomBytes(16);
    const weak = `$scrypt$ln=12,r=8,p=1$${bytesToBase64Url(salt)}$${bytesToBase64Url(new Uint8Array(scryptSync("weak-password", salt, 32, { N: 4096, p: 1, r: 8 })))}`;
    context.raw.prepare("INSERT INTO auth_users (id, email, password_hash, created_at, updated_at) VALUES ('u3', 'weak@example.com', ?, 'x', 'x')").run(weak);

    assert.deepEqual(await verifyPassword("weak-password", weak), { needsRehash: true, valid: true });
    await context.storage.auth.authenticate({ email: "weak@example.com", password: "weak-password" });
    assert.match(storedHash(context, "weak@example.com"), /^\$scrypt\$ln=14,r=8,p=5\$/);
  });
});

test("sessions store only the lowercase hex SHA-256 of a 32-byte token and resolve to their user", async () => {
  await withStorage(async (context) => {
    const user = await context.storage.auth.register({ email: "user@example.com", password: "correct-password" });
    const { session, token } = await context.storage.auth.createSession({ userId: user.id });

    assert.equal(token.length, 43);
    assert.equal(session.user.email, "user@example.com");
    assert.equal(session.expiresAt, new Date(context.clock.now().getTime() + SESSION_LIFETIME_MS).toISOString());
    const row = context.raw.prepare("SELECT token_hash FROM auth_sessions").get() as { token_hash: string };
    assert.match(row.token_hash, /^[0-9a-f]{64}$/);
    assert.notEqual(row.token_hash, token);

    assert.equal((await context.storage.auth.getSession(token))?.userId, user.id);
    assert.equal(await context.storage.auth.getSession("not-a-token"), null);
    assert.equal(await context.storage.auth.getSession(null), null);
    assert.equal(await context.storage.auth.getSession("x".repeat(500)), null);
  });
});

test("session creation for an unknown user inserts nothing", async () => {
  await withStorage(async (context) => {
    await assert.rejects(context.storage.auth.createSession({ userId: "ghost" }), (error) =>
      error instanceof StoredAuthError && error.code === "unknown_user",
    );
    assert.equal((context.raw.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get() as { total: number }).total, 0);
  });
});

test("login rotates the session: the presented token is retired and a new one issued", async () => {
  await withStorage(async (context) => {
    const user = await context.storage.auth.register({ email: "user@example.com", password: "correct-password" });
    const first = await context.storage.auth.createSession({ userId: user.id });
    const second = await context.storage.auth.createSession({ replaceToken: first.token, userId: user.id });

    assert.notEqual(first.token, second.token);
    assert.equal(await context.storage.auth.getSession(first.token), null);
    assert.equal((await context.storage.auth.getSession(second.token))?.userId, user.id);
  });
});

test("expired sessions are rejected and removed", async () => {
  await withStorage(async (context) => {
    const user = await context.storage.auth.register({ email: "user@example.com", password: "correct-password" });
    const { token } = await context.storage.auth.createSession({ userId: user.id });

    context.clock.set(new Date(context.clock.now().getTime() + SESSION_LIFETIME_MS + 1000).toISOString());
    assert.equal(await context.storage.auth.getSession(token), null);
    assert.equal((context.raw.prepare("SELECT COUNT(*) AS total FROM auth_sessions").get() as { total: number }).total, 0);
  });
});

test("sessions slide: use renews the 30-day lifetime at most once a day", async () => {
  await withStorage(async (context) => {
    const user = await context.storage.auth.register({ email: "user@example.com", password: "correct-password" });
    const { session, token } = await context.storage.auth.createSession({ userId: user.id });
    const day = 24 * 60 * 60 * 1000;

    // Same day: no write.
    context.clock.set(new Date(context.clock.now().getTime() + 3600_000).toISOString());
    assert.equal((await context.storage.auth.getSession(token))?.expiresAt, session.expiresAt);

    // Ten days later: renewed to ten days + 30 days from now.
    context.clock.set(new Date(Date.parse(session.createdAt) + 10 * day).toISOString());
    const renewed = await context.storage.auth.getSession(token);
    assert.equal(renewed?.expiresAt, new Date(context.clock.now().getTime() + SESSION_LIFETIME_MS).toISOString());

    // Another request moments later does not move it again.
    context.clock.set(new Date(context.clock.now().getTime() + 60_000).toISOString());
    assert.equal((await context.storage.auth.getSession(token))?.expiresAt, renewed?.expiresAt);

    // Thirty-one days after creation the original expiry would have passed, the renewed one has not.
    context.clock.set(new Date(Date.parse(session.createdAt) + 31 * day).toISOString());
    assert.ok(await context.storage.auth.getSession(token));
  });
});

test("deleting one session or all sessions of a user", async () => {
  await withStorage(async (context) => {
    const user = await context.storage.auth.register({ email: "user@example.com", password: "correct-password" });
    const other = await context.storage.auth.register({ email: "other@example.com", password: "correct-password" });
    const a = await context.storage.auth.createSession({ userId: user.id });
    const b = await context.storage.auth.createSession({ userId: user.id });
    const c = await context.storage.auth.createSession({ userId: other.id });

    assert.equal(await context.storage.auth.deleteSession(a.token), true);
    assert.equal(await context.storage.auth.deleteSession(a.token), false);
    assert.equal(await context.storage.auth.deleteAllSessions(user.id), 1);
    assert.equal(await context.storage.auth.getSession(b.token), null);
    assert.ok(await context.storage.auth.getSession(c.token));
  });
});

test("login throttling blocks after repeated failures with Retry-After, and a success clears the pair", async () => {
  await withStorage(async (context) => {
    const { clock, raw, storage } = context;
    const subject = { email: "victim@example.com", ip: "203.0.113.9", scope: "login" as const };
    const failureLimit = AUTH_THROTTLE_POLICIES.login.find((policy) => policy.key === "ip_email")?.limit ?? 5;

    for (let attempt = 0; attempt < failureLimit; attempt += 1) {
      assert.deepEqual(await storage.auth.checkThrottle(subject), { allowed: true });
      await storage.auth.recordAttempt(subject);
      clock.set(new Date(clock.now().getTime() + 1000).toISOString());
    }

    const blocked = await storage.auth.checkThrottle(subject);
    assert.equal(blocked.allowed, false);
    assert.ok(!blocked.allowed && blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 15 * 60);
    // A different email from the same IP is only subject to the broader per-IP limit.
    assert.deepEqual(await storage.auth.checkThrottle({ ...subject, email: "someone-else@example.com" }), { allowed: true });
    // A different IP is unaffected.
    assert.deepEqual(await storage.auth.checkThrottle({ ...subject, ip: "198.51.100.1" }), { allowed: true });

    // Only hashes are persisted.
    const rows = raw.prepare("SELECT ip_hash, email_hash FROM auth_attempts").all() as Array<{ email_hash: string; ip_hash: string }>;
    assert.ok(rows.every((row) => /^[0-9a-f]{64}$/.test(row.ip_hash) && /^[0-9a-f]{64}$/.test(row.email_hash)));
    assert.ok(!JSON.stringify(rows).includes("203.0.113.9") && !JSON.stringify(rows).includes("victim"));

    await storage.auth.clearLoginFailures({ email: subject.email, ip: subject.ip });
    assert.deepEqual(await storage.auth.checkThrottle(subject), { allowed: true });
  });
});

test("throttle windows slide: attempts leave the window and old rows are pruned", async () => {
  await withStorage(async ({ clock, raw, storage }) => {
    const subject = { email: "a@example.com", ip: "203.0.113.9", scope: "login" as const };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await storage.auth.recordAttempt(subject);
    }
    assert.equal((await storage.auth.checkThrottle(subject)).allowed, false);

    clock.set(new Date(clock.now().getTime() + 16 * 60_000).toISOString());
    assert.equal((await storage.auth.checkThrottle(subject)).allowed, true);

    clock.set(new Date(clock.now().getTime() + 3 * 60 * 60_000).toISOString());
    await storage.auth.recordAttempt(subject);
    assert.equal((raw.prepare("SELECT COUNT(*) AS total FROM auth_attempts").get() as { total: number }).total, 1);
  });
});

test("registration is limited per client address", async () => {
  await withStorage(async ({ storage }) => {
    const subject = { ip: "203.0.113.50", scope: "register" as const };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await storage.auth.checkThrottle(subject)).allowed, true);
      await storage.auth.recordAttempt(subject);
    }
    const blocked = await storage.auth.checkThrottle(subject);
    assert.equal(blocked.allowed, false);
    assert.ok(!blocked.allowed && blocked.retryAfterSeconds > 0);
  });
});
