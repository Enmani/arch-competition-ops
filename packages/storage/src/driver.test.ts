import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import Database from "better-sqlite3";

import { silentLogger } from "@arch-competition/core";

import { StorageBusyError, StorageError, isUniqueViolation } from "./index";
import { fromBetterSqlite3 } from "./driver/better-sqlite3";
import { execute, executeBatch, likeContains, readBatch, readRow, readRows } from "./driver/sql";
import { asD1Driver } from "./driver/d1";
import { openLocalStorage } from "./node";

const memory = () => {
  const connection = new Database(":memory:");
  connection.exec("CREATE TABLE items (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL UNIQUE)");
  return { connection, database: fromBetterSqlite3(connection) };
};

test("prepare/bind/all/first/run behave like D1 and bind returns a new statement", async () => {
  const { database } = memory();
  const insert = database.prepare("INSERT INTO items (name) VALUES (?)");
  const first = await insert.bind("a").run();
  await insert.bind("b").run();

  assert.equal(first.meta?.changes, 1);
  assert.equal(first.meta?.last_row_id, 1);
  assert.deepEqual((await database.prepare("SELECT name FROM items ORDER BY id").all<{ name: string }>()).results, [
    { name: "a" },
    { name: "b" },
  ]);
  assert.deepEqual(await database.prepare("SELECT name FROM items WHERE id = ?").bind(2).first(), { name: "b" });
  assert.equal(await database.prepare("SELECT name FROM items WHERE id = ?").bind(99).first(), null);
});

test("batch is atomic: a failing statement rolls back the whole batch", async () => {
  const { connection, database } = memory();
  await assert.rejects(
    executeBatch(database, [
      { parameters: ["x"], sql: "INSERT INTO items (name) VALUES (?)" },
      { parameters: ["x"], sql: "INSERT INTO items (name) VALUES (?)" },
    ]),
    (error) => error instanceof StorageError && isUniqueViolation(error),
  );
  assert.equal((connection.prepare("SELECT COUNT(*) AS total FROM items").get() as { total: number }).total, 0);

  const results = await executeBatch(database, [
    { parameters: ["x"], sql: "INSERT INTO items (name) VALUES (?)" },
    { parameters: ["x"], sql: "DELETE FROM items WHERE name = ?" },
  ]);
  assert.deepEqual(results.map((result) => result.changes), [1, 1]);
});

test("readBatch returns one row list per SELECT in a single round trip", async () => {
  const { database } = memory();
  await execute(database, "INSERT INTO items (name) VALUES ('a'), ('b')");
  const [all, one] = await readBatch(database, [
    { sql: "SELECT name FROM items ORDER BY id" },
    { parameters: ["b"], sql: "SELECT name FROM items WHERE name = ?" },
  ]);
  assert.equal(all.length, 2);
  assert.deepEqual(one, [{ name: "b" }]);
});

test("driver errors carry a truncated statement and never the bound parameters", async () => {
  const { database } = memory();
  await assert.rejects(readRows(database, "SELECT missing_column FROM items WHERE name = ?", ["secret-value"]), (error) => {
    assert.ok(error instanceof StorageError);
    assert.match(error.message, /missing_column/);
    assert.ok(!error.message.includes("secret-value"));
    assert.ok(error.cause instanceof Error);
    return true;
  });
});

test("likeContains escapes wildcard characters for LIKE ... ESCAPE", async () => {
  const { database } = memory();
  await execute(database, "INSERT INTO items (name) VALUES ('50% off'), ('a_b'), ('axb'), ('back\\slash')");
  const find = async (term: string) =>
    (await readRows<{ name: string }>(database, "SELECT name FROM items WHERE name LIKE ? ESCAPE '\\' ORDER BY name", [likeContains(term)])).map((row) => row.name);

  assert.deepEqual(await find("%"), ["50% off"]);
  assert.deepEqual(await find("a_b"), ["a_b"]);
  assert.deepEqual(await find("\\"), ["back\\slash"]);
});

test("asD1Driver accepts a D1-shaped binding and rejects anything else with a clear error", () => {
  const { database } = memory();
  assert.equal(asD1Driver(database), database);
  assert.throws(() => asD1Driver(undefined), /D1 binding `DB` is missing/);
  assert.throws(() => asD1Driver({ prepare: () => undefined }), /D1 binding `DB` is missing/);
});

test("lock contention surfaces as StorageBusyError (not an empty result) and the reader connection is read-only", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-driver-"));
  const databasePath = path.join(directory, "competitions.sqlite");
  const handle = openLocalStorage({ databasePath, logger: silentLogger });
  const worker = new Database(databasePath);
  try {
    worker.pragma("journal_mode = DELETE");
    worker.exec("BEGIN EXCLUSIVE");

    const started = Date.now();
    await assert.rejects(handle.storage.opportunities.feed(), (error) => error instanceof StorageBusyError);
    assert.ok(Date.now() - started >= 4000, "reads must wait for busy_timeout before failing");
    worker.exec("ROLLBACK");

    assert.deepEqual(await handle.storage.opportunities.feed(), []);
  } finally {
    worker.close();
    handle.close();
    rmSync(directory, { force: true, recursive: true });
  }
});

test("a read-only adapter refuses writes with a diagnosable StorageError", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-driver-"));
  const handle = openLocalStorage({ databasePath: path.join(directory, "competitions.sqlite"), logger: silentLogger });
  const readOnly = new Database(handle.databasePath, { readonly: true });
  try {
    const database = fromBetterSqlite3(readOnly);
    assert.equal((await readRow<{ total: number }>(database, "SELECT COUNT(*) AS total FROM competitions"))?.total, 0);
    await assert.rejects(execute(database, "DELETE FROM competitions"), (error) => {
      assert.ok(error instanceof StorageError);
      assert.match(error.message, /readonly/i);
      return true;
    });
  } finally {
    readOnly.close();
    handle.close();
    rmSync(directory, { force: true, recursive: true });
  }
});
