import type { StorageContext } from "../context";
import { readBatch, type SqlStatement } from "../driver/sql";
import type { NormalizedQuery } from "./query";

const CONTINUATION_TTL_MS = 30 * 60_000;

export const publicationVersionStatement: SqlStatement = {
  sql: "SELECT CASE WHEN syncing = 0 THEN version END AS version FROM discover_publication WHERE id = 1",
};

export const isMissingPublicationTable = (error: unknown): boolean =>
  error instanceof Error &&
  (/no such table: (?:main\.)?discover_publication\b/.test(error.message) || isMissingPublicationTable(error.cause));

export const readWithPublication = async (
  context: StorageContext,
  statements: SqlStatement[],
): Promise<{ version: string | null; rows: unknown[][] }> => {
  try {
    const [publication, ...rows] = await readBatch(context.reader, [publicationVersionStatement, ...statements]);
    return { version: (publication[0] as { version: string | null } | undefined)?.version ?? null, rows };
  } catch (error) {
    // An older deployment can still serve exact live results before the publication migration.
    if (!isMissingPublicationTable(error)) throw error;
    return { version: null, rows: await readBatch(context.reader, statements) };
  }
};

const conditionsKey = ({ limit: _limit, offset: _offset, ...conditions }: NormalizedQuery) =>
  JSON.stringify(Object.entries(conditions).sort(([left], [right]) => left.localeCompare(right))
    .map(([name, value]) => [name, Array.isArray(value) ? [...value].sort() : value]));

const expiresAt = (asOf: number) => {
  const midnight = new Date(asOf);
  midnight.setUTCHours(24, 0, 0, 0);
  return Math.min(asOf + CONTINUATION_TTL_MS, midnight.getTime());
};

export const issueContinuation = (version: string | null, now: Date, query: NormalizedQuery) => {
  if (!version) return null;
  const asOf = now.getTime();
  return JSON.stringify({ version, asOf, expiresAt: expiresAt(asOf), conditions: conditionsKey(query) });
};

export const readContinuation = (token: string, now: Date, query: NormalizedQuery) => {
  if (token.length > 4096 || query.offset === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(token);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const candidate = parsed as Record<string, unknown>;
  const { asOf, version } = candidate;
  if (
    typeof version !== "string" || !version || typeof asOf !== "number" || !Number.isSafeInteger(asOf) ||
    asOf > now.getTime() || asOf < now.getTime() - CONTINUATION_TTL_MS ||
    candidate.expiresAt !== expiresAt(asOf) || now.getTime() >= candidate.expiresAt ||
    candidate.conditions !== conditionsKey(query)
  ) return null;
  return { asOf: new Date(asOf), version };
};
