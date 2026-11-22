import type { Clock } from "../context";
import type { SqlStatement } from "../driver/sql";
import { buildFilterOptions, FACET_GROUPS, type FacetRow } from "./facets";
import { buildWhere, type NormalizedQuery } from "./query";

const MAX_AGGREGATE_BYTES = 2_000_000;

const facetSources = FACET_GROUPS.flat();
const classificationColumns = new Set(["project_types", "building_categories", "design_scopes", "project_modes"]);

const aggregateValues = (column: string) => {
  if (!classificationColumns.has(column)) {
    return `json_group_array(DISTINCT ${column}) FILTER (WHERE ${column} IS NOT NULL AND TRIM(${column}) != '')`;
  }
  // Legacy non-arrays had json_each semantics, including duplicate object keys. Normalize
  // those rare rows in SQLite before deduplication, and ignore malformed JSON as before.
  return `json_group_array(DISTINCT CASE WHEN json_valid(${column}) THEN
    CASE WHEN json_type(${column}) = 'array' THEN ${column}
         ELSE (SELECT json_group_array(value) FROM json_each(competitions.${column}) WHERE type = 'text') || ''
    END END)`;
};

export const buildAggregateStatement = (
  query: NormalizedQuery,
  clock: Clock,
  maxBytes = MAX_AGGREGATE_BYTES,
): SqlStatement => {
  const { clause, parameters } = buildWhere(query, clock);
  const groups = facetSources.map(({ column }) => `'${column}', ${aggregateValues(column)}`).join(",\n      ");
  return {
    parameters,
    sql: `SELECT CASE WHEN length(CAST(payload AS BLOB)) < ${maxBytes} THEN payload END AS payload
      FROM (SELECT json_object('total', COUNT(*), ${groups}) AS payload FROM competitions ${clause})`,
  };
};

export const unpackAggregate = (payload: string, query: NormalizedQuery) => {
  const aggregate = JSON.parse(payload) as { total: number } & Record<string, (string | null)[]>;
  const rows: FacetRow[] = [];
  for (const { facet, column } of facetSources) {
    for (const value of aggregate[column]) {
      if (value === null) continue;
      if (classificationColumns.has(column)) {
        for (const item of JSON.parse(value) as unknown[]) {
          if (typeof item === "string") rows.push({ facet, value: item });
        }
      } else {
        rows.push({ facet, value });
      }
    }
  }
  return { total: aggregate.total, filterOptions: buildFilterOptions(rows, query) };
};

/** D1/SQLite limits a value or row to 2 MB. Preserve exactness via the grouped queries. */
export const isOversizeAggregate = (error: unknown): boolean =>
  error instanceof Error && (
    /SQLITE_TOOBIG|string or blob too big|row(?: size)? too (?:big|large)/i.test(error.message) ||
    isOversizeAggregate(error.cause)
  );
