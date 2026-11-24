// Run two or more genuine worker snapshots through the exporter against the same local D1 fixture.
import Database from "better-sqlite3";
import path from "node:path";
import { applyMigrations, executeFiles } from "./d1-sync-fixtures.mjs";
import { runExport } from "../../scripts/export-d1-data.mjs";

const [dbPath, directory, sequence] = process.argv.slice(2);
const remote = new Database(path.join(directory, "remote.sqlite"));
try {
  if (sequence === "1") applyMigrations(remote);
  const output = runExport({ dbPath, outputRoot: path.join(directory, "export-" + sequence) });
  const count = () => remote.prepare("SELECT total_changes() n").get().n;
  const before = count();
  executeFiles(remote, output);
  console.log(count() - before);
} finally {
  remote.close();
}
