export type StorageErrorCode = "storage_busy" | "storage_error";

/**
 * Failure of the storage layer with enough context to diagnose it from logs.
 * `statement` is a truncated SQL prefix (never bound parameters, which may hold personal data).
 */
export class StorageError extends Error {
  readonly code: StorageErrorCode;
  readonly statement: string | undefined;

  constructor(code: StorageErrorCode, message: string, options?: { cause?: unknown; statement?: string }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "StorageError";
    this.code = code;
    this.statement = options?.statement;
  }
}

/**
 * The database stayed locked longer than the busy timeout (typically the Python worker is
 * writing the same SQLite file). Callers must surface this as "temporarily unavailable"
 * and must NOT render it as an empty result list.
 */
export class StorageBusyError extends StorageError {
  constructor(message: string, options?: { cause?: unknown; statement?: string }) {
    super("storage_busy", message, options);
    this.name = "StorageBusyError";
  }
}

export const isStorageBusyError = (error: unknown): error is StorageBusyError =>
  error instanceof StorageBusyError;

const readCode = (error: unknown) => {
  const source = error as { code?: unknown; driverCode?: unknown } | null;
  const code = typeof source?.driverCode === "string" ? source.driverCode : source?.code;
  return typeof code === "string" ? code : "";
};

const readMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Works for better-sqlite3 (error.code) and D1 (message text "UNIQUE constraint failed"). */
export const isUniqueViolation = (error: unknown) =>
  readCode(error).startsWith("SQLITE_CONSTRAINT_UNIQUE") ||
  readCode(error).startsWith("SQLITE_CONSTRAINT_PRIMARYKEY") ||
  /UNIQUE constraint failed/i.test(readMessage(error));

export const isBusyFailure = (error: unknown) =>
  readCode(error) === "SQLITE_BUSY" ||
  readCode(error) === "SQLITE_LOCKED" ||
  /database is locked|SQLITE_BUSY/i.test(readMessage(error));

export const describeStatement = (statement: string) => {
  const compact = statement.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}...` : compact;
};
