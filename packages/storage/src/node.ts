import { mkdirSync } from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { createLogger, type Logger } from "@arch-competition/core";

import { systemClock, type Clock } from "./context";
import { fromBetterSqlite3 } from "./driver/better-sqlite3";
import { applyPendingMigrations } from "./node/migrations";
import { resolveLocalDatabasePath, resolveMigrationsDirectory } from "./node/paths";
import { createStorage, type Storage } from "./storage";

/**
 * Node-only entry: local development and tests.
 *
 * Two connections to the same SQLite file, both through the same adapter:
 * - `writer` (read-write): applies pending migrations once at startup, then serves auth,
 *   workspace and ops-review decisions, i.e. everything the Web app owns;
 * - `reader` (read-only): serves opportunity and diagnostics reads, so a read path can never
 *   modify the worker-owned tables.
 * journal_mode is left to the Python worker (it sets WAL); this module never changes it, so the
 * two processes cannot fight over it. Both connections wait up to 5 seconds on a busy database
 * (`busy_timeout`) before failing with `StorageBusyError`, which callers must report as
 * "temporarily unavailable" rather than as an empty list.
 */
export { resolveLocalDatabasePath } from "./node/paths";
export { applyPendingMigrations, splitSqlStatements } from "./node/migrations";
export { fromBetterSqlite3 } from "./driver/better-sqlite3";

const BUSY_TIMEOUT_MS = 5000;

export type LocalStorageOptions = {
  clock?: Clock;
  databasePath?: string;
  logger?: Logger;
  migrationsDirectory?: string;
};

export type LocalStorageHandle = {
  close(): void;
  databasePath: string;
  storage: Storage;
};

export const openLocalStorage = ({
  clock = systemClock,
  databasePath = resolveLocalDatabasePath(),
  logger = createLogger("storage"),
  migrationsDirectory = resolveMigrationsDirectory(),
}: LocalStorageOptions = {}): LocalStorageHandle => {
  mkdirSync(path.dirname(databasePath), { recursive: true });

  const writeConnection = new Database(databasePath);
  writeConnection.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
  writeConnection.pragma("foreign_keys = ON");
  applyPendingMigrations(writeConnection, migrationsDirectory, logger);

  const readConnection = new Database(databasePath, { fileMustExist: true, readonly: true });
  readConnection.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);

  return {
    close() {
      readConnection.close();
      writeConnection.close();
    },
    databasePath,
    storage: createStorage({
      clock,
      logger,
      reader: fromBetterSqlite3(readConnection),
      writer: fromBetterSqlite3(writeConnection),
    }),
  };
};

const cacheKey = Symbol.for("arch-competition-ops.local-storage");
type GlobalWithCache = typeof globalThis & { [cacheKey]?: LocalStorageHandle };

/**
 * Process-wide singleton. Stored on `globalThis` so Next.js dev hot reloads reuse the same
 * connections instead of leaking a new pair on every module reload.
 */
export const getLocalStorage = (): Storage => {
  const holder = globalThis as GlobalWithCache;
  holder[cacheKey] ??= openLocalStorage();
  return holder[cacheKey].storage;
};
