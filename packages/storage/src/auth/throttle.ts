import type { StorageContext } from "../context";
import { execute, executeBatch, readRow } from "../driver/sql";
import { sha256Hex } from "./encoding";

/**
 * Sliding-window throttling backed by the `auth_attempts` table (migration 0005).
 *
 * Keys are SHA-256 hashes of the client IP and of the email, never the raw values. Login counts
 * FAILED attempts (a success clears the IP+email pair); registration counts every attempt.
 * Limits are best-effort: two simultaneous requests can both pass the check before either is
 * recorded, which only lets a handful of extra attempts through, and an attacker who can spoof
 * the client IP header is still bounded by the per-email policy.
 */
export type AuthAttemptScope = "login" | "register";

type Policy = { key: "ip" | "ip_email"; limit: number; windowMs: number };

const MINUTE = 60_000;
export const AUTH_THROTTLE_POLICIES: Record<AuthAttemptScope, Policy[]> = {
  login: [
    { key: "ip_email", limit: 5, windowMs: 15 * MINUTE },
    { key: "ip", limit: 30, windowMs: 15 * MINUTE },
  ],
  register: [{ key: "ip", limit: 5, windowMs: 60 * MINUTE }],
};
const RETENTION_MS = 2 * 60 * MINUTE;

export type ThrottleDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

export type AuthAttemptSubject = {
  email?: string | null;
  ip: string;
  scope: AuthAttemptScope;
};

const hashKey = (kind: string, value: string) => sha256Hex(`arch-competition-ops:${kind}:${value.trim().toLowerCase()}`);

const hashSubject = async ({ email, ip }: AuthAttemptSubject) => ({
  emailHash: email ? await hashKey("email", email) : null,
  ipHash: await hashKey("ip", ip || "unknown"),
});

export const checkAuthThrottle = async (
  context: StorageContext,
  subject: AuthAttemptSubject,
): Promise<ThrottleDecision> => {
  const { emailHash, ipHash } = await hashSubject(subject);
  const nowMs = context.clock.now().getTime();
  let retryAfterSeconds = 0;

  for (const policy of AUTH_THROTTLE_POLICIES[subject.scope]) {
    if (policy.key === "ip_email" && !emailHash) {
      continue;
    }
    const windowStart = new Date(nowMs - policy.windowMs).toISOString();
    const row = await readRow<{ oldest: string | null; total: number }>(
      context.writer,
      `SELECT COUNT(*) AS total, MIN(attempted_at) AS oldest
       FROM auth_attempts
       WHERE scope = ? AND ip_hash = ? AND attempted_at > ?
         ${policy.key === "ip_email" ? "AND email_hash = ?" : ""}`,
      policy.key === "ip_email"
        ? [subject.scope, ipHash, windowStart, emailHash as string]
        : [subject.scope, ipHash, windowStart],
    );
    if ((row?.total ?? 0) >= policy.limit && row?.oldest) {
      const releaseAt = Date.parse(row.oldest) + policy.windowMs;
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((releaseAt - nowMs) / 1000), 1);
    }
  }
  return retryAfterSeconds > 0 ? { allowed: false, retryAfterSeconds } : { allowed: true };
};

/** Records an attempt and prunes rows that left every window, in one transaction. */
export const recordAuthAttempt = async (context: StorageContext, subject: AuthAttemptSubject) => {
  const { emailHash, ipHash } = await hashSubject(subject);
  const now = context.clock.now();
  await executeBatch(context.writer, [
    {
      parameters: [new Date(now.getTime() - RETENTION_MS).toISOString()],
      sql: "DELETE FROM auth_attempts WHERE attempted_at < ?",
    },
    {
      parameters: [subject.scope, ipHash, emailHash, now.toISOString()],
      sql: "INSERT INTO auth_attempts (scope, ip_hash, email_hash, attempted_at) VALUES (?, ?, ?, ?)",
    },
  ]);
};

/** A successful login forgives earlier typos for this IP + email pair. */
export const clearLoginFailures = async (context: StorageContext, subject: Omit<AuthAttemptSubject, "scope">) => {
  if (!subject.email) {
    return;
  }
  const { emailHash, ipHash } = await hashSubject({ ...subject, scope: "login" });
  await execute(
    context.writer,
    "DELETE FROM auth_attempts WHERE scope = 'login' AND ip_hash = ? AND email_hash = ?",
    [ipHash, emailHash],
  );
};
