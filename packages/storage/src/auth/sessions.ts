import type { StorageContext } from "../context";
import { execute, executeBatch, readRow } from "../driver/sql";
import { bytesToBase64Url, randomBytes, sha256Hex } from "./encoding";
import { StoredAuthError, type StoredAuthSession, type StoredAuthSessionWithToken } from "./types";

/**
 * Sessions: 32 random bytes as the cookie value, only its SHA-256 (lowercase hex) is stored.
 * - 30-day lifetime, renewed on use ("sliding") but written at most about once a day;
 * - every login creates a brand-new token (rotation) and can retire the presented one;
 * - sign-out-everywhere removes all of a user's sessions.
 */
export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
/** Renew when less than 29 days remain, i.e. at most once per day per session. */
export const SESSION_RENEW_BELOW_MS = 29 * 24 * 60 * 60 * 1000;
const MAX_TOKEN_LENGTH = 200;

type SessionRow = {
  created_at: string;
  email: string;
  expires_at: string;
  user_created_at: string;
  user_id: string;
  user_updated_at: string;
};

const mapSession = (row: SessionRow): StoredAuthSession => ({
  createdAt: row.created_at,
  expiresAt: row.expires_at,
  user: {
    createdAt: row.user_created_at,
    email: row.email,
    id: row.user_id,
    updatedAt: row.user_updated_at,
  },
  userId: row.user_id,
});

const SESSION_SELECT = `
  SELECT s.user_id, s.created_at, s.expires_at, u.email,
         u.created_at AS user_created_at, u.updated_at AS user_updated_at
  FROM auth_sessions AS s
  INNER JOIN auth_users AS u ON u.id = s.user_id
  WHERE s.token_hash = ?`;

/**
 * Creates a session for `userId`. In one transaction: purge expired sessions, retire the
 * previous token when the caller presents one (rotation), and insert the new session from a
 * SELECT on `auth_users` so an unknown user inserts nothing.
 */
export const createSession = async (
  context: StorageContext,
  { replaceToken, userId }: { replaceToken?: string | null; userId: string },
): Promise<StoredAuthSessionWithToken> => {
  const token = bytesToBase64Url(randomBytes(32));
  const tokenHash = await sha256Hex(token);
  const now = context.clock.now();
  const expiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();
  const nowIso = now.toISOString();

  const statements = [
    { parameters: [nowIso], sql: "DELETE FROM auth_sessions WHERE expires_at <= ?" },
    ...(replaceToken && replaceToken.length <= MAX_TOKEN_LENGTH
      ? [{ parameters: [await sha256Hex(replaceToken)], sql: "DELETE FROM auth_sessions WHERE token_hash = ?" }]
      : []),
    {
      parameters: [tokenHash, nowIso, expiresAt, userId],
      sql: `INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
            SELECT ?, id, ?, ? FROM auth_users WHERE id = ?`,
    },
  ];
  const results = await executeBatch(context.writer, statements);
  if (results[results.length - 1].changes === 0) {
    throw new StoredAuthError("unknown_user", "Auth user does not exist.");
  }

  const row = await readRow<SessionRow>(context.writer, SESSION_SELECT, [tokenHash]);
  if (!row) {
    throw new Error("Auth session disappeared right after creation.");
  }
  return { session: mapSession(row), token };
};

/** Resolves a cookie token to its session, deleting it when expired and sliding it forward when due. */
export const getSession = async (
  context: StorageContext,
  token: string | null | undefined,
): Promise<StoredAuthSession | null> => {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return null;
  }

  const tokenHash = await sha256Hex(token);
  const row = await readRow<SessionRow>(context.writer, SESSION_SELECT, [tokenHash]);
  if (!row) {
    return null;
  }

  const now = context.clock.now();
  const expiresAtMs = Date.parse(row.expires_at);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= now.getTime()) {
    await execute(context.writer, "DELETE FROM auth_sessions WHERE token_hash = ?", [tokenHash]);
    return null;
  }

  if (expiresAtMs - now.getTime() < SESSION_RENEW_BELOW_MS) {
    const renewedExpiresAt = new Date(now.getTime() + SESSION_LIFETIME_MS).toISOString();
    try {
      await execute(context.writer, "UPDATE auth_sessions SET expires_at = ? WHERE token_hash = ?", [
        renewedExpiresAt,
        tokenHash,
      ]);
      return mapSession({ ...row, expires_at: renewedExpiresAt });
    } catch (error) {
      // The session is still valid; renewal is retried on the next request.
      context.logger.warn("storage.session_renewal_failed", { error, userId: row.user_id });
    }
  }
  return mapSession(row);
};

export const deleteSession = async (context: StorageContext, token: string | null | undefined) => {
  if (!token || token.length > MAX_TOKEN_LENGTH) {
    return false;
  }
  const result = await execute(context.writer, "DELETE FROM auth_sessions WHERE token_hash = ?", [
    await sha256Hex(token),
  ]);
  return result.changes > 0;
};

/** Sign out everywhere: returns how many sessions were removed. */
export const deleteAllSessionsForUser = async (context: StorageContext, userId: string) =>
  (await execute(context.writer, "DELETE FROM auth_sessions WHERE user_id = ?", [userId])).changes;
