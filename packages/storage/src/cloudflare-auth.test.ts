import assert from "node:assert/strict";
import Database from "better-sqlite3";
import test from "node:test";

import type { D1DatabaseLike } from "./cloudflare";
import {
  countD1AuthUsers,
  createD1AuthSession,
  createD1AuthUser,
  getD1AuthSession,
} from "./cloudflare";

type SqlParameter = string | number | null;

const createD1Database = (): D1DatabaseLike => {
  const database = new Database(":memory:");

  return {
    prepare(statement: string) {
      const prepared = database.prepare(statement);
      let boundParameters: SqlParameter[] = [];

      return {
        bind(...values: SqlParameter[]) {
          boundParameters = values;
          return this;
        },
        async all<T = unknown>() {
          return { results: prepared.all(...boundParameters) as T[] };
        },
        async first<T = unknown>() {
          return (prepared.get(...boundParameters) as T | undefined) ?? null;
        },
        async run() {
          const result = prepared.run(...boundParameters);
          return {
            meta: {
              changes: result.changes,
              last_row_id: result.lastInsertRowid,
            },
          };
        },
      };
    },
  };
};

test("D1 auth registration bootstraps auth tables and creates a session", async () => {
  const database = createD1Database();

  const user = await createD1AuthUser(database, {
    email: "  Studio@Example.COM ",
    password: "correct-password",
  });
  const { token } = await createD1AuthSession(database, { userId: user.id });
  const session = await getD1AuthSession(database, token);

  assert.equal(user.email, "studio@example.com");
  assert.equal(await countD1AuthUsers(database), 1);
  assert.equal(session?.user.id, user.id);
  assert.equal(session?.user.email, "studio@example.com");
});
