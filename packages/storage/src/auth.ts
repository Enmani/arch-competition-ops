import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

type SqlParameter = string | number | bigint | Uint8Array | null;

type AuthUserRow = {
  created_at: string;
  email: string;
  id: string;
  password_hash: string;
  updated_at: string;
};

type AuthSessionRow = {
  created_at: string;
  email: string;
  expires_at: string;
  token_hash: string;
  user_created_at: string;
  user_id: string;
  user_updated_at: string;
};

export type StoredAuthErrorCode = "email_taken" | "invalid_email" | "unknown_user" | "weak_password";

export class StoredAuthError extends Error {
  code: StoredAuthErrorCode;

  constructor(code: StoredAuthErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "StoredAuthError";
  }
}

export type StoredAuthUser = {
  createdAt: string;
  email: string;
  id: string;
  updatedAt: string;
};

export type StoredAuthSession = {
  createdAt: string;
  expiresAt: string;
  tokenHash: string;
  user: StoredAuthUser;
  userId: string;
};

export type StoredAuthSessionWithToken = {
  session: StoredAuthSession;
  token: string;
};

export type StoredAuthUserCreateInput = {
  email: string;
  password: string;
};

export type StoredAuthLoginInput = {
  email: string;
  password: string;
};

export type StoredAuthSessionCreateInput = {
  expiresAt?: string;
  userId: string;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "../../..");
const authSessionDurationMs = 30 * 24 * 60 * 60 * 1000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const passwordMinLength = 8;
const scryptParameters = {
  keyLength: 64,
  n: 16_384,
  p: 1,
  r: 8,
};

const resolveSqlitePath = () => {
  const authPath = process.env.ARCH_AUTH_DB_PATH?.trim();
  if (authPath) {
    return path.resolve(authPath);
  }

  const envPath = process.env.ARCH_COMPETITION_DB_PATH?.trim();
  if (envPath) {
    return path.resolve(envPath);
  }

  return path.join(repoRoot, "data", "competitions.sqlite");
};

const ensureAuthTables = (database: Database.Database) => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS auth_users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      token_hash TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_expires
      ON auth_sessions (user_id, expires_at);
  `);
};

const withAuthDatabase = <T>(handler: (database: Database.Database) => T) => {
  const sqlitePath = resolveSqlitePath();
  mkdirSync(path.dirname(sqlitePath), { recursive: true });

  const database = new Database(sqlitePath);
  try {
    ensureAuthTables(database);
    return handler(database);
  } finally {
    database.close();
  }
};

const normalizeEmail = (email: string) => email.trim().toLowerCase();

const normalizeEmailOrThrow = (email: string) => {
  const normalizedEmail = normalizeEmail(email);
  if (!emailPattern.test(normalizedEmail)) {
    throw new StoredAuthError("invalid_email", "Email address is invalid.");
  }
  return normalizedEmail;
};

const assertPassword = (password: string) => {
  if (password.length < passwordMinLength) {
    throw new StoredAuthError(
      "weak_password",
      `Password must be at least ${passwordMinLength} characters.`,
    );
  }
};

const toIsoString = (value = new Date()) => value.toISOString();

const mapAuthUserRow = (row: AuthUserRow): StoredAuthUser => ({
  createdAt: row.created_at,
  email: row.email,
  id: row.id,
  updatedAt: row.updated_at,
});

const mapAuthSessionRow = (row: AuthSessionRow): StoredAuthSession => ({
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  tokenHash: row.token_hash,
  user: {
    createdAt: row.user_created_at,
    email: row.email,
    id: row.user_id,
    updatedAt: row.user_updated_at,
  },
  userId: row.user_id,
});

const createPasswordHash = (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, scryptParameters.keyLength, {
    N: scryptParameters.n,
    p: scryptParameters.p,
    r: scryptParameters.r,
  }).toString("hex");

  return [
    "scrypt",
    scryptParameters.n,
    scryptParameters.r,
    scryptParameters.p,
    salt,
    hash,
  ].join("$");
};

const verifyPasswordHash = (password: string, storedHash: string) => {
  const [scheme, rawN, rawR, rawP, salt, hash] = storedHash.split("$");
  if (scheme !== "scrypt" || !rawN || !rawR || !rawP || !salt || !hash) {
    return false;
  }

  const expectedHash = Buffer.from(hash, "hex");
  if (expectedHash.length === 0) {
    return false;
  }

  const derivedHash = scryptSync(password, salt, expectedHash.length, {
    N: Number.parseInt(rawN, 10),
    p: Number.parseInt(rawP, 10),
    r: Number.parseInt(rawR, 10),
  });

  return expectedHash.length === derivedHash.length && timingSafeEqual(expectedHash, derivedHash);
};

const hashSessionToken = (token: string) => createHash("sha256").update(token).digest("hex");

const readAuthUserById = (database: Database.Database, userId: string) => {
  const row = database
    .prepare(
      `
        SELECT id, email, password_hash, created_at, updated_at
        FROM auth_users
        WHERE id = ?
      `,
    )
    .get(userId) as AuthUserRow | undefined;

  return row ? mapAuthUserRow(row) : undefined;
};

const readAuthSession = (database: Database.Database, tokenHash: string) => {
  const row = database
    .prepare(
      `
        SELECT
          auth_sessions.token_hash,
          auth_sessions.user_id,
          auth_sessions.created_at,
          auth_sessions.expires_at,
          auth_users.email,
          auth_users.created_at AS user_created_at,
          auth_users.updated_at AS user_updated_at
        FROM auth_sessions
        INNER JOIN auth_users ON auth_users.id = auth_sessions.user_id
        WHERE auth_sessions.token_hash = ?
      `,
    )
    .get(tokenHash) as AuthSessionRow | undefined;

  return row ? mapAuthSessionRow(row) : undefined;
};

const deleteExpiredSessions = (database: Database.Database, now = toIsoString()) => {
  database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
};

export const createStoredAuthUser = ({
  email,
  password,
}: StoredAuthUserCreateInput): StoredAuthUser => {
  const normalizedEmail = normalizeEmailOrThrow(email);
  assertPassword(password);

  return withAuthDatabase((database) => {
    const existingUser = database
      .prepare("SELECT id FROM auth_users WHERE email = ?")
      .get(normalizedEmail) as { id: string } | undefined;
    if (existingUser) {
      throw new StoredAuthError("email_taken", "Email is already registered.");
    }

    const userId = randomUUID();
    const now = toIsoString();
    try {
      database
        .prepare(
          `
            INSERT INTO auth_users (
              id,
              email,
              password_hash,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(userId, normalizedEmail, createPasswordHash(password), now, now);
    } catch (error) {
      if (error instanceof Error && error.message.toLowerCase().includes("unique")) {
        throw new StoredAuthError("email_taken", "Email is already registered.");
      }
      throw error;
    }

    const user = readAuthUserById(database, userId);
    if (!user) {
      throw new Error("Failed to reload auth user.");
    }
    return user;
  });
};

export const authenticateStoredAuthUser = ({
  email,
  password,
}: StoredAuthLoginInput): StoredAuthUser | null => {
  const normalizedEmail = normalizeEmail(email);
  if (!emailPattern.test(normalizedEmail) || password.length === 0) {
    return null;
  }

  return withAuthDatabase((database) => {
    const row = database
      .prepare(
        `
          SELECT id, email, password_hash, created_at, updated_at
          FROM auth_users
          WHERE email = ?
        `,
      )
      .get(normalizedEmail) as AuthUserRow | undefined;

    if (!row || !verifyPasswordHash(password, row.password_hash)) {
      return null;
    }

    return mapAuthUserRow(row);
  });
};

export const createStoredAuthSession = ({
  expiresAt,
  userId,
}: StoredAuthSessionCreateInput): StoredAuthSessionWithToken => {
  return withAuthDatabase((database) => {
    const user = readAuthUserById(database, userId);
    if (!user) {
      throw new StoredAuthError("unknown_user", "Auth user does not exist.");
    }

    const now = toIsoString();
    deleteExpiredSessions(database, now);

    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashSessionToken(token);
    const sessionExpiresAt = expiresAt ?? new Date(Date.now() + authSessionDurationMs).toISOString();

    database
      .prepare(
        `
          INSERT INTO auth_sessions (
            token_hash,
            user_id,
            created_at,
            expires_at
          ) VALUES (?, ?, ?, ?)
        `,
      )
      .run(tokenHash, user.id, now, sessionExpiresAt);

    const session = readAuthSession(database, tokenHash);
    if (!session) {
      throw new Error("Failed to reload auth session.");
    }

    return { session, token };
  });
};

export const getStoredAuthSession = (token: string | null | undefined): StoredAuthSession | null => {
  if (!token) {
    return null;
  }

  return withAuthDatabase((database) => {
    const tokenHash = hashSessionToken(token);
    const session = readAuthSession(database, tokenHash);
    if (!session) {
      return null;
    }

    if (session.expiresAt <= toIsoString()) {
      database.prepare("DELETE FROM auth_sessions WHERE token_hash = ?").run(tokenHash);
      return null;
    }

    return session;
  });
};

export const deleteStoredAuthSession = (token: string | null | undefined) => {
  if (!token) {
    return false;
  }

  return withAuthDatabase((database) => {
    const result = database
      .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
      .run(hashSessionToken(token)) as Database.RunResult;
    return result.changes > 0;
  });
};

export const countStoredAuthUsers = () =>
  withAuthDatabase((database) => {
    const row = database.prepare("SELECT COUNT(*) AS total FROM auth_users").get() as
      | { total: number }
      | undefined;
    return row?.total ?? 0;
  });

export const deleteStoredAuthSessionsForUser = (userId: string) =>
  withAuthDatabase((database) => {
    const result = database
      .prepare("DELETE FROM auth_sessions WHERE user_id = ?")
      .run(userId as SqlParameter) as Database.RunResult;
    return result.changes;
  });
