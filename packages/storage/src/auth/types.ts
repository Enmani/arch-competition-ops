export type StoredAuthErrorCode = "email_taken" | "invalid_email" | "unknown_user" | "weak_password";

export class StoredAuthError extends Error {
  readonly code: StoredAuthErrorCode;

  constructor(code: StoredAuthErrorCode, message: string) {
    super(message);
    this.name = "StoredAuthError";
    this.code = code;
  }
}

export const isStoredAuthError = (error: unknown): error is StoredAuthError =>
  error instanceof StoredAuthError;

export type StoredAuthUser = {
  createdAt: string;
  email: string;
  id: string;
  updatedAt: string;
};

/** The session token hash never leaves storage: callers only see who the session belongs to. */
export type StoredAuthSession = {
  createdAt: string;
  expiresAt: string;
  user: StoredAuthUser;
  userId: string;
};

export type StoredAuthSessionWithToken = {
  session: StoredAuthSession;
  token: string;
};

export type StoredAuthCredentials = {
  email: string;
  password: string;
};
