import type BetterSqlite3 from "better-sqlite3";

import { StorageBusyError, StorageError, describeStatement, isBusyFailure } from "./errors";
import type { D1DatabaseLike, D1Result, D1StatementLike, SqlParameter } from "./types";

/**
 * better-sqlite3 adapter implementing the same `D1DatabaseLike` contract as the D1 binding.
 *
 * Differences that are deliberately hidden here:
 * - better-sqlite3 is synchronous; every method still returns a Promise;
 * - `batch()` runs all statements inside one transaction (D1 does the same server side);
 * - lock contention (SQLITE_BUSY after the connection's busy_timeout) is converted to
 *   `StorageBusyError` so callers can answer "temporarily unavailable" instead of an empty list;
 * - other failures are rethrown as `StorageError` carrying a truncated statement prefix
 *   (never the bound parameters) and the original error as `cause`.
 *
 * The adapter never changes connection pragmas. journal_mode (WAL) is owned by the Python
 * worker, which creates the database; busy_timeout/foreign_keys are set by the opener in
 * ../node.ts.
 */
const statementCacheLimit = 128;

type ExecutionResult = D1Result<unknown>;

const wrapFailure = (error: unknown, sql: string): never => {
  const statement = describeStatement(sql);
  if (isBusyFailure(error)) {
    throw new StorageBusyError(`SQLite database stayed locked while running: ${statement}`, {
      cause: error,
      statement,
    });
  }
  const reason = error instanceof Error ? error.message : String(error);
  const wrapped = new StorageError("storage_error", `SQLite statement failed (${reason}): ${statement}`, {
    cause: error,
    statement,
  });
  // Keep the driver error code (e.g. SQLITE_CONSTRAINT_UNIQUE) visible to callers.
  const driverCode = (error as { code?: unknown } | null)?.code;
  if (typeof driverCode === "string") {
    Object.assign(wrapped, { driverCode });
  }
  throw wrapped;
};

class SqliteStatement implements D1StatementLike {
  constructor(
    private readonly connection: BetterSqlite3.Database,
    private readonly cache: Map<string, BetterSqlite3.Statement>,
    readonly sql: string,
    private readonly parameters: SqlParameter[] = [],
  ) {}

  bind(...values: SqlParameter[]): D1StatementLike {
    return new SqliteStatement(this.connection, this.cache, this.sql, values);
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    return this.executeSync() as D1Result<T>;
  }

  async first<T = unknown>(): Promise<T | null> {
    try {
      const statement = this.prepared();
      if (!statement.reader) {
        statement.run(...this.parameters);
        return null;
      }
      return (statement.get(...this.parameters) as T | undefined) ?? null;
    } catch (error) {
      return wrapFailure(error, this.sql);
    }
  }

  async run(): Promise<D1Result> {
    return this.executeSync();
  }

  /** Synchronous core shared by all(), run() and the transactional batch(). */
  executeSync(): ExecutionResult {
    try {
      const statement = this.prepared();
      if (statement.reader) {
        return { results: statement.all(...this.parameters), success: true };
      }
      const info = statement.run(...this.parameters);
      return {
        meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
        results: [],
        success: true,
      };
    } catch (error) {
      return wrapFailure(error, this.sql);
    }
  }

  private prepared() {
    let statement = this.cache.get(this.sql);
    if (!statement) {
      statement = this.connection.prepare(this.sql);
      if (this.cache.size >= statementCacheLimit) {
        const oldest = this.cache.keys().next().value;
        if (oldest !== undefined) {
          this.cache.delete(oldest);
        }
      }
      this.cache.set(this.sql, statement);
    }
    return statement;
  }
}

export const fromBetterSqlite3 = (connection: BetterSqlite3.Database): D1DatabaseLike => {
  const cache = new Map<string, BetterSqlite3.Statement>();

  return {
    prepare(sql: string) {
      return new SqliteStatement(connection, cache, sql);
    },
    async batch(statements: D1StatementLike[]) {
      const runAll = connection.transaction(() =>
        statements.map((statement) => {
          if (!(statement instanceof SqliteStatement)) {
            throw new StorageError("storage_error", "batch() received a statement from another driver.");
          }
          return statement.executeSync();
        }),
      );
      try {
        return runAll.immediate();
      } catch (error) {
        if (error instanceof StorageError) {
          throw error;
        }
        return wrapFailure(error, "BEGIN IMMEDIATE (batch)");
      }
    },
  };
};
