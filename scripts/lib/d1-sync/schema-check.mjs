import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { quoteIdentifier } from "./sql-values.mjs";

export class SchemaMismatchError extends Error {
  constructor(problems) {
    super(`Local database schema does not match apps/web/migrations:\n  - ${problems.join("\n  - ")}`);
    this.name = "SchemaMismatchError";
    this.problems = problems;
  }
}

function readTableColumns(database, table) {
  return database
    .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
    .all()
    .sort((left, right) => left.cid - right.cid)
    .map((row) => row.name);
}

/**
 * Apply every migration (filename order) to a throwaway in-memory database and return
 * `Map<table, columnNames[]>` for the synced tables. The migrations are the schema authority,
 * so this does not depend on any schema_migrations bookkeeping in the local database.
 */
export function loadMigratedColumns(migrationsDir, tableNames) {
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    throw new Error(`No .sql migrations found in ${migrationsDir}`);
  }

  const memory = new Database(":memory:");
  try {
    for (const file of files) {
      memory.exec(readFileSync(path.join(migrationsDir, file), "utf8"));
    }
    const columns = new Map();
    for (const table of tableNames) {
      const names = readTableColumns(memory, table);
      if (names.length === 0) {
        throw new Error(`Table ${table} is not defined by the migrations in ${migrationsDir}`);
      }
      columns.set(table, names);
    }
    return { columns, migrationFiles: files };
  } finally {
    memory.close();
  }
}

/** Compare column *sets* per table; returns a list of human-readable problems (empty = ok). */
export function findSchemaProblems(localDatabase, expectedColumns) {
  const problems = [];
  for (const [table, expected] of expectedColumns) {
    const local = readTableColumns(localDatabase, table);
    if (local.length === 0) {
      problems.push(`${table}: table is missing from the local database`);
      continue;
    }
    const localSet = new Set(local);
    const expectedSet = new Set(expected);
    const missing = expected.filter((name) => !localSet.has(name));
    const extra = local.filter((name) => !expectedSet.has(name));
    if (missing.length > 0) {
      problems.push(`${table}: local database is missing column(s) ${missing.join(", ")}`);
    }
    if (extra.length > 0) {
      problems.push(`${table}: local database has column(s) not in migrations ${extra.join(", ")}`);
    }
  }
  return problems;
}
