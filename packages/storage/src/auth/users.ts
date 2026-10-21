import { EMAIL_MAX_LENGTH, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@arch-competition/core";

import type { StorageContext } from "../context";
import { execute, readRow } from "../driver/sql";
import { isUniqueViolation } from "../driver/errors";
import { DUMMY_PASSWORD_HASH, hashPassword, verifyPassword } from "./password";
import { StoredAuthError, type StoredAuthCredentials, type StoredAuthUser } from "./types";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type UserRow = {
  created_at: string;
  email: string;
  id: string;
  password_hash: string;
  updated_at: string;
};

export const normalizeEmail = (email: string) => email.trim().toLowerCase();

const isValidEmail = (email: string) => email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);

export const toAuthUser = (row: Pick<UserRow, "created_at" | "email" | "id" | "updated_at">): StoredAuthUser => ({
  createdAt: row.created_at,
  email: row.email,
  id: row.id,
  updatedAt: row.updated_at,
});

/**
 * Creates an account. Uniqueness is enforced by the database (`email` is UNIQUE NOCASE), so
 * two concurrent registrations cannot both succeed. The password is hashed BEFORE the insert
 * so "email already registered" costs as much time as a successful registration.
 *
 * Account enumeration: the `email_taken` code is returned to the caller, and the web layer
 * maps it to the same generic public error as other registration failures and rate-limits
 * registration per client (see apps/web/src/lib/api/auth-routes.ts). Email verification needs an
 * external mail service and is not implemented yet.
 */
export const registerUser = async (
  context: StorageContext,
  { email, password }: StoredAuthCredentials,
): Promise<StoredAuthUser> => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail)) {
    throw new StoredAuthError("invalid_email", "Email address is invalid.");
  }
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new StoredAuthError(
      "weak_password",
      `Password must be between ${PASSWORD_MIN_LENGTH} and ${PASSWORD_MAX_LENGTH} characters.`,
    );
  }

  const passwordHash = await hashPassword(password);
  const id = crypto.randomUUID();
  const now = context.clock.now().toISOString();
  try {
    await execute(
      context.writer,
      `INSERT INTO auth_users (id, email, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
      [id, normalizedEmail, passwordHash, now, now],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new StoredAuthError("email_taken", "Email is already registered.");
    }
    throw error;
  }
  return { createdAt: now, email: normalizedEmail, id, updatedAt: now };
};

/**
 * Verifies credentials. Returns null for any failure without saying which part failed.
 * Unknown emails still pay for a full scrypt verification (DUMMY_PASSWORD_HASH).
 * A legacy or weaker hash is re-written in the current format right after a successful login
 * (compare-and-set on the old hash, so a concurrent password change is never overwritten).
 */
export const authenticateUser = async (
  context: StorageContext,
  { email, password }: StoredAuthCredentials,
): Promise<StoredAuthUser | null> => {
  const normalizedEmail = normalizeEmail(email);
  if (!isValidEmail(normalizedEmail) || password.length === 0 || password.length > PASSWORD_MAX_LENGTH) {
    return null;
  }

  const row = await readRow<UserRow>(
    context.writer,
    "SELECT id, email, password_hash, created_at, updated_at FROM auth_users WHERE email = ?",
    [normalizedEmail],
  );
  if (!row) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH);
    return null;
  }

  const verification = await verifyPassword(password, row.password_hash);
  if (!verification.valid) {
    return null;
  }

  if (verification.needsRehash) {
    try {
      await execute(
        context.writer,
        "UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ? AND password_hash = ?",
        [await hashPassword(password), context.clock.now().toISOString(), row.id, row.password_hash],
      );
    } catch (error) {
      // The login itself succeeded; the upgrade is retried on the next login.
      context.logger.warn("storage.password_rehash_failed", { error, userId: row.id });
    }
  }
  return toAuthUser(row);
};
