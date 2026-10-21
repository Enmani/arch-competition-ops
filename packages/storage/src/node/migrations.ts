import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";

import { silentLogger, type Logger } from "@arch-competition/core";

/**
 * Local "apply what is missing" migration runner (development and tests only).
 *
 * `apps/web/migrations/*.sql` is the only schema authority. Production D1 applies the same
 * files through `wrangler d1 migrations apply`, which does its own bookkeeping, so these
 * files are written for a one-shot run there. Locally the database may already exist
 * (the Python worker creates it from its own SCHEMA_SQL), so this runner:
 * - records applied files in `schema_migrations`;
 * - makes `ALTER TABLE ... ADD COLUMN` idempotent by skipping columns that already exist
 *   (the only statement kind in the migrations that is not naturally re-runnable);
 * - relies on `CREATE ... IF NOT EXISTS` for everything else.
 * It runs every pending file inside a single immediate transaction so a failed file leaves
 * no half-applied schema behind.
 *
 * Limitation: statements are split on `;` after stripping `--` comments, so migration files
 * must not contain `;` inside string literals or trigger bodies. A test enforces this.
 */
const addColumnPattern = /^ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+["`]?(\w+)["`]?/i;

export const stripSqlComments = (sql: string) =>
  sql
    .split(/\r?\n/)
    .map((line) => {
      let inString = false;
      for (let index = 0; index < line.length; index += 1) {
        const char = line[index];
        if (char === "'") {
          inString = !inString;
        } else if (!inString && char === "-" && line[index + 1] === "-") {
          return line.slice(0, index);
        }
      }
      return line;
    })
    .join("\n");

export const splitSqlStatements = (sql: string) =>
  stripSqlComments(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

export type MigrationFile = { name: string; statements: string[] };

export const readMigrationFiles = (directory: string): MigrationFile[] =>
  readdirSync(directory)
    .filter((entry) => /^\d{4}_.+\.sql$/.test(entry))
    .sort()
    .map((name) => ({
      name,
      statements: splitSqlStatements(readFileSync(path.join(directory, name), "utf8")),
    }));

const columnExists = (connection: BetterSqlite3.Database, table: string, column: string) =>
  (connection.prepare(`PRAGMA table_info("${table}")`).all() as Array<{ name: string }>).some(
    (row) => row.name === column,
  );

export type MigrationReport = { applied: string[]; skippedColumns: string[] };

export const applyPendingMigrations = (
  connection: BetterSqlite3.Database,
  directory: string,
  logger: Logger = silentLogger,
): MigrationReport => {
  connection.exec(
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const applied = new Set(
    (connection.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map(
      (row) => row.name,
    ),
  );
  const pending = readMigrationFiles(directory).filter((file) => !applied.has(file.name));
  const report: MigrationReport = { applied: [], skippedColumns: [] };
  if (pending.length === 0) {
    return report;
  }

  const run = connection.transaction(() => {
    for (const file of pending) {
      for (const statement of file.statements) {
        const addColumn = addColumnPattern.exec(statement);
        if (addColumn && columnExists(connection, addColumn[1], addColumn[2])) {
          report.skippedColumns.push(`${addColumn[1]}.${addColumn[2]}`);
          continue;
        }
        try {
          connection.exec(statement);
        } catch (error) {
          throw new Error(
            `Migration ${file.name} failed on statement "${statement.slice(0, 100).replace(/\s+/g, " ")}": ${
              error instanceof Error ? error.message : String(error)
            }`,
            { cause: error },
          );
        }
      }
      connection
        .prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)")
        .run(file.name, new Date().toISOString());
      report.applied.push(file.name);
    }
  });
  run.immediate();

  logger.info("storage.migrations_applied", { applied: report.applied, skippedColumns: report.skippedColumns });
  return report;
};
