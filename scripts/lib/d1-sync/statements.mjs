import { formatSqlValue, quoteIdentifier, SqlValueError } from "./sql-values.mjs";
import { contentColumns, PRUNE_STAGING_TABLE } from "./table-specs.mjs";

/**
 * Build `INSERT ... ON CONFLICT(pk) DO UPDATE SET ...` for one row.
 * `columns` are the migration-defined columns (already validated against the local table).
 */
export function buildUpsertStatement(spec, columns, row) {
  const key = row[spec.primaryKey];
  if (key === null || key === undefined || key === "") {
    throw new SqlValueError(`${spec.name}: row has an empty primary key (${spec.primaryKey})`);
  }

  const updateColumns = spec.updateColumns ?? columns.filter((column) => column !== spec.primaryKey);
  for (const column of updateColumns) {
    if (!columns.includes(column)) {
      throw new Error(`${spec.name}: update column ${column} is not part of the migrated schema`);
    }
  }

  const table = quoteIdentifier(spec.name);
  const columnList = columns.map(quoteIdentifier).join(", ");
  const values = columns
    .map((column) => {
      if (spec.name === "ai_screening_results" && column === "source_updated_at" && row.current_revision) {
        return `(SELECT updated_at FROM competitions WHERE id = ${formatSqlValue(key, { table: spec.name, key, column })})`;
      }
      return formatSqlValue(row[column], { table: spec.name, key, column });
    })
    .join(", ");
  const assignments = updateColumns
    .map((column) => `${quoteIdentifier(column)} = excluded.${quoteIdentifier(column)}`)
    .join(", ");
  const comparisons = contentColumns(spec, updateColumns);
  // Advice is valid only for its source revision, including when a correction makes it stale.
  if (spec.name === "ai_screening_results") comparisons.push("source_updated_at");
  const changes = comparisons
    .map((column) => `${table}.${quoteIdentifier(column)} IS NOT excluded.${quoteIdentifier(column)}`)
    .join(" OR ");
  const guard = spec.conflictGuard ? `(${spec.conflictGuard}) AND (${changes})` : changes;

  return (
    `INSERT INTO ${table} (${columnList}) SELECT ${values} WHERE EXISTS ` +
    `(SELECT 1 FROM discover_publication WHERE id=1 AND syncing=1) ` +
    `ON CONFLICT(${quoteIdentifier(spec.primaryKey)}) DO UPDATE SET ${assignments} WHERE ${guard};`
  );
}

const PRUNE_IDS_PER_STATEMENT = 200;

/**
 * --prune flow without a remote connection: stage the full local id set in a scratch table,
 * delete remote competitions absent from it (except ones users watch, which would violate the
 * foreign key), then drop the scratch table. The DELETE on the scratch table is not a
 * user-data deletion. Every step is idempotent so a failed run can simply be re-executed.
 */
export function buildPruneStatements(competitionIds, { maxStatementBytes }) {
  const staging = quoteIdentifier(PRUNE_STAGING_TABLE);
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${staging} (id TEXT PRIMARY KEY);`,
    `DELETE FROM ${staging};`,
  ];

  const budget = Math.floor(maxStatementBytes / 2);
  let pending = [];
  let pendingBytes = 0;
  const flush = () => {
    if (pending.length > 0) {
      statements.push(`INSERT OR IGNORE INTO ${staging} (id) VALUES ${pending.join(", ")};`);
      pending = [];
      pendingBytes = 0;
    }
  };
  for (const id of competitionIds) {
    const literal = `(${formatSqlValue(id, { table: "competitions", key: id, column: "id" })})`;
    if (literal.length > budget) {
      throw new SqlValueError(`competitions[${id}].id is too long to stage for --prune`);
    }
    if (pending.length >= PRUNE_IDS_PER_STATEMENT || pendingBytes + literal.length + 2 > budget) {
      flush();
    }
    pending.push(literal);
    pendingBytes += literal.length + 2;
  }
  flush();

  statements.push(
    `DELETE FROM "competitions" WHERE "id" NOT IN (SELECT "id" FROM ${staging}) ` +
      `AND "id" NOT IN (SELECT "opportunity_id" FROM "workspace_watchlist_entries");`,
    `UPDATE discover_publication SET summary_format=0 WHERE id=1 AND changes()>0;`,
    `DROP TABLE ${staging};`,
  );
  return statements;
}
