import { createLogger, type Logger } from "@arch-competition/core";

import type { D1DatabaseLike } from "./driver/types";

/** Injectable time source: tests pin it, production uses the system clock. */
export type Clock = {
  now(): Date;
};

export const systemClock: Clock = { now: () => new Date() };

/** "Today" for deadline comparisons is the UTC calendar date (deadlines are date-only). */
export const todayIso = (clock: Clock) => clock.now().toISOString().slice(0, 10);

/**
 * Everything a storage module needs.
 *
 * `reader` serves opportunity and diagnostics reads; `writer` serves everything the Web app
 * owns and mutates (auth, workspace, ops review decisions). On Cloudflare both are the same
 * D1 binding. In local development `reader` is a read-only SQLite connection so a bug in a
 * read path can never modify the worker-owned opportunity tables, while `writer` is the
 * read-write connection that also applies migrations.
 */
export type StorageContext = {
  clock: Clock;
  logger: Logger;
  reader: D1DatabaseLike;
  writer: D1DatabaseLike;
};

export type StorageContextOptions = {
  clock?: Clock;
  logger?: Logger;
  reader?: D1DatabaseLike;
  writer: D1DatabaseLike;
};

export const createStorageContext = ({
  clock = systemClock,
  logger = createLogger("storage"),
  reader,
  writer,
}: StorageContextOptions): StorageContext => ({
  clock,
  logger,
  reader: reader ?? writer,
  writer,
});
