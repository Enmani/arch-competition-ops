import type { D1DatabaseLike, D1Result, SqlParameter } from "./types";

/**
 * Thin helpers over the driver interface. Business modules never call `prepare()` directly,
 * which keeps parameter binding and result normalisation in one place.
 */
export type SqlStatement = {
  parameters?: SqlParameter[];
  sql: string;
};

export type RunResult = {
  changes: number;
  lastRowId: number | null;
};

const prepare = (database: D1DatabaseLike, { parameters = [], sql }: SqlStatement) => {
  const statement = database.prepare(sql);
  return parameters.length > 0 ? statement.bind(...parameters) : statement;
};

const toRunResult = (result: D1Result | undefined): RunResult => {
  const lastRowId = Number(result?.meta?.last_row_id);
  return {
    changes: result?.meta?.changes ?? 0,
    lastRowId: Number.isFinite(lastRowId) ? lastRowId : null,
  };
};

export const readRows = async <T>(
  database: D1DatabaseLike,
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<T[]> => ((await prepare(database, { parameters, sql }).all<T>()).results ?? []) as T[];

export const readRow = async <T>(
  database: D1DatabaseLike,
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<T | undefined> => (await prepare(database, { parameters, sql }).first<T>()) ?? undefined;

export const execute = async (
  database: D1DatabaseLike,
  sql: string,
  parameters: SqlParameter[] = [],
): Promise<RunResult> => toRunResult(await prepare(database, { parameters, sql }).run());

/** Runs statements atomically (one transaction) and reports per-statement change counts. */
export const executeBatch = async (
  database: D1DatabaseLike,
  statements: SqlStatement[],
): Promise<RunResult[]> => {
  if (statements.length === 0) {
    return [];
  }
  const results = await database.batch(statements.map((statement) => prepare(database, statement)));
  return results.map(toRunResult);
};

/** Reads several SELECTs in one round trip (a single D1 subrequest). */
export const readBatch = async (
  database: D1DatabaseLike,
  statements: SqlStatement[],
): Promise<unknown[][]> => {
  if (statements.length === 0) {
    return [];
  }
  const results = await database.batch(statements.map((statement) => prepare(database, statement)));
  return results.map((result) => (result.results ?? []) as unknown[]);
};

/**
 * Escapes `%`, `_` and the escape character itself for use with `LIKE ? ESCAPE '\'`,
 * and wraps the value for a "contains" match.
 */
export const likeContains = (value: string) => `%${value.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

export const placeholders = (count: number) => Array.from({ length: count }, () => "?").join(", ");

/** D1 allows at most 100 bound parameters per statement; stay well below it. */
export const MAX_BOUND_PARAMETERS = 90;

export const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
};
