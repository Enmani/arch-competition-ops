/**
 * The single driver interface every storage module is written against.
 *
 * It is the structural subset of Cloudflare D1 that this project uses, so a D1 binding
 * satisfies it directly (see ./d1.ts) and the better-sqlite3 adapter (./better-sqlite3.ts)
 * implements the same contract for local development and tests.
 *
 * Semantics both drivers guarantee (and storage code relies on):
 * - every statement is async, even on the synchronous SQLite driver;
 * - `bind()` returns a NEW statement; statements are immutable;
 * - `batch()` runs the statements in order inside ONE transaction: either all take effect
 *   or none do. This is the only way to get multi-statement atomicity on D1, which rejects
 *   explicit BEGIN/COMMIT. Single statements are individually atomic.
 */
export type SqlParameter = string | number | null;

export type D1RunMeta = {
  changes?: number;
  last_row_id?: number | string;
};

export type D1Result<T = unknown> = {
  results?: T[];
  meta?: D1RunMeta;
  success?: boolean;
};

export type D1StatementLike = {
  all<T = unknown>(): Promise<D1Result<T>>;
  bind(...values: SqlParameter[]): D1StatementLike;
  first<T = unknown>(): Promise<T | null>;
  run(): Promise<D1Result>;
};

export type D1DatabaseLike = {
  batch(statements: D1StatementLike[]): Promise<D1Result[]>;
  prepare(statement: string): D1StatementLike;
};
