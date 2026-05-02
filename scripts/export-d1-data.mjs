import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "..");
const sqlitePath = process.env.ARCH_COMPETITION_DB_PATH
  ? path.resolve(process.env.ARCH_COMPETITION_DB_PATH)
  : path.join(repoRoot, "data", "competitions.sqlite");
const outputPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repoRoot, "artifacts", "d1-data.sql");

const tables = [
  "competitions",
  "source_runs",
  "source_health",
  "ops_review_queue_items",
  "ops_review_decisions",
  "workspace_saved_searches",
  "workspace_watchlist_entries",
];
const deleteOrder = [...tables].reverse();

const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;

const quoteValue = (value) => {
  if (value === null || value === undefined) {
    return "NULL";
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return Number.isFinite(Number(value)) ? String(value) : "NULL";
  }
  if (value instanceof Uint8Array) {
    return `X'${Buffer.from(value).toString("hex")}'`;
  }
  return `'${String(value).replaceAll("'", "''")}'`;
};

const database = new Database(sqlitePath, { readonly: true });

try {
  const existingTables = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => row.name),
  );
  const lines = [
    "-- D1 data export for Arch Competition Ops.",
    "-- Apply apps/web/migrations before importing this file.",
    "-- Auth users/sessions are intentionally not exported; D1 uses Workers-compatible password hashes.",
    "PRAGMA defer_foreign_keys = TRUE;",
  ];

  for (const table of deleteOrder) {
    if (existingTables.has(table)) {
      lines.push(`DELETE FROM ${quoteIdentifier(table)};`);
    }
  }

  for (const table of tables) {
    if (!existingTables.has(table)) {
      continue;
    }

    const columns = database
      .prepare(`PRAGMA table_info(${quoteIdentifier(table)})`)
      .all()
      .map((row) => row.name);
    if (columns.length === 0) {
      continue;
    }

    const columnList = columns.map(quoteIdentifier).join(", ");
    const rows = database.prepare(`SELECT ${columnList} FROM ${quoteIdentifier(table)}`).all();
    lines.push("");
    lines.push(`-- ${table}: ${rows.length} row(s)`);
    for (const row of rows) {
      const values = columns.map((column) => quoteValue(row[column])).join(", ");
      lines.push(`INSERT INTO ${quoteIdentifier(table)} (${columnList}) VALUES (${values});`);
    }
  }

  lines.push("PRAGMA defer_foreign_keys = FALSE;");
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
  console.log(`Wrote D1 data export to ${path.relative(repoRoot, outputPath)}`);
} finally {
  database.close();
}
