import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import Database from "better-sqlite3";

import { silentLogger, type Logger } from "@arch-competition/core";

import type { Clock } from "./context";
import { openLocalStorage, type LocalStorageHandle } from "./node";

/**
 * Test fixtures. The database is created by the real migrations (apps/web/migrations/*.sql),
 * never by hand-written CREATE TABLE statements, so tests cannot drift from the schema.
 */
export const fixedClock = (iso: string): Clock & { set(next: string): void } => {
  let current = new Date(iso);
  return {
    now: () => new Date(current),
    set(next: string) {
      current = new Date(next);
    },
  };
};

export type TestStorage = LocalStorageHandle & {
  clock: ReturnType<typeof fixedClock>;
  /** Separate read-write connection for seeding and for asserting on raw rows. */
  raw: Database.Database;
  cleanup(): void;
};

export const createTestStorage = (
  { logger = silentLogger, now = "2026-04-19T12:00:00.000Z" }: { logger?: Logger; now?: string } = {},
): TestStorage => {
  const directory = mkdtempSync(path.join(tmpdir(), "arch-competition-storage-"));
  const clock = fixedClock(now);
  const handle = openLocalStorage({ clock, databasePath: path.join(directory, "competitions.sqlite"), logger });
  const raw = new Database(handle.databasePath);
  raw.pragma("foreign_keys = ON");

  return {
    ...handle,
    cleanup() {
      raw.close();
      handle.close();
      rmSync(directory, { force: true, recursive: true });
    },
    clock,
    raw,
  };
};

export type SeedOpportunity = Partial<Record<string, string | number | null>> & { id: string };

const DEFAULTS: Record<string, string | number | null> = {
  audience: "[]",
  authority_name: null,
  building_categories: "[]",
  competition_types: '["architecture"]',
  cpv_codes: "[]",
  dedup_key: "",
  deadline_at: null,
  design_scopes: "[]",
  discovered_at: "2026-04-10T00:00:00.000Z",
  evidence_level: "official_notice",
  extraction_confidence: 0.9,
  jurisdiction: "italy",
  languages: "[]",
  opportunity_type: "public_design_services_procurement",
  organizer: "",
  project_modes: "[]",
  project_types: "[]",
  regions: "[]",
  source_url: "https://example.org/notice",
  status: "discovered",
  title: "Untitled",
  updated_at: "2026-04-10T00:00:00.000Z",
};

export const seedOpportunity = (raw: Database.Database, row: SeedOpportunity) => {
  const values = { ...DEFAULTS, dedup_key: row.id, ...row };
  const columns = Object.keys(values);
  raw
    .prepare(`INSERT INTO competitions (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`)
    .run(...Object.values(values));
};

export const seedQueueItem = (
  raw: Database.Database,
  overrides: Partial<Record<string, string | number | null>> & { queue_id: string },
) => {
  const values = {
    first_detected_at: "2026-04-10T00:00:00.000Z",
    is_active: 1,
    last_detected_at: "2026-04-10T00:00:00.000Z",
    origin: "worker_diagnostic",
    payload_json: "{}",
    priority: 0,
    reason_code: "source_parse_failures",
    status: "pending",
    summary: "Summary",
    title: "Queue item",
    updated_at: "2026-04-10T00:00:00.000Z",
    ...overrides,
  };
  const columns = Object.keys(values);
  raw
    .prepare(
      `INSERT INTO ops_review_queue_items (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    )
    .run(...Object.values(values));
};
