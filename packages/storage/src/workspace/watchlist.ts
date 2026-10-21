import type { StorageContext } from "../context";
import { StorageNotFoundError } from "../domain-errors";
import { execute, readRow, readRows } from "../driver/sql";
import { requireOpportunityId, requireWorkspaceKey } from "./keys";

export type StoredWatchlistEntry = {
  createdAt: string;
  id: number;
  opportunityId: string;
  updatedAt: string;
  workspaceKey: string;
};

type WatchlistRow = {
  created_at: string;
  id: number;
  opportunity_id: string;
  updated_at: string;
  workspace_key: string;
};

const mapRow = (row: WatchlistRow): StoredWatchlistEntry => ({
  createdAt: row.created_at,
  id: row.id,
  opportunityId: row.opportunity_id,
  updatedAt: row.updated_at,
  workspaceKey: row.workspace_key,
});

export const listWatchlistEntries = async (
  context: StorageContext,
  { limit = 50, workspaceKey }: { limit?: number; workspaceKey: string },
): Promise<StoredWatchlistEntry[]> => {
  const rows = await readRows<WatchlistRow>(
    context.writer,
    `SELECT id, workspace_key, opportunity_id, created_at, updated_at
     FROM workspace_watchlist_entries
     WHERE workspace_key = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [requireWorkspaceKey(workspaceKey), Math.min(Math.max(Math.trunc(limit), 1), 200)],
  );
  return rows.map(mapRow);
};

export const listWatchedOpportunityIds = async (context: StorageContext, workspaceKey: string) => {
  const rows = await readRows<{ opportunity_id: string }>(
    context.writer,
    `SELECT opportunity_id FROM workspace_watchlist_entries
     WHERE workspace_key = ?
     ORDER BY updated_at DESC, id DESC`,
    [requireWorkspaceKey(workspaceKey)],
  );
  return rows.map((row) => row.opportunity_id);
};

export const isOpportunityWatched = async (
  context: StorageContext,
  { opportunityId, workspaceKey }: { opportunityId: string; workspaceKey: string },
) => {
  const row = await readRow<{ opportunity_id: string }>(
    context.writer,
    "SELECT opportunity_id FROM workspace_watchlist_entries WHERE workspace_key = ? AND opportunity_id = ?",
    [requireWorkspaceKey(workspaceKey), requireOpportunityId(opportunityId)],
  );
  return Boolean(row);
};

/**
 * Idempotent add. The row is inserted from a SELECT on `competitions`, so an unknown
 * opportunity id inserts nothing (reported as not found) with no check-then-insert race, and
 * a repeated add only refreshes `updated_at` through the unique key.
 */
export const addWatchlistEntry = async (
  context: StorageContext,
  { opportunityId, workspaceKey }: { opportunityId: string; workspaceKey: string },
): Promise<StoredWatchlistEntry> => {
  const key = requireWorkspaceKey(workspaceKey);
  const id = requireOpportunityId(opportunityId);
  const now = context.clock.now().toISOString();
  const row = await readRow<WatchlistRow>(
    context.writer,
    `INSERT INTO workspace_watchlist_entries (workspace_key, opportunity_id, created_at, updated_at)
     SELECT ?, id, ?, ? FROM competitions WHERE id = ?
     ON CONFLICT (workspace_key, opportunity_id) DO UPDATE SET updated_at = excluded.updated_at
     RETURNING id, workspace_key, opportunity_id, created_at, updated_at`,
    [key, now, now, id],
  );
  if (!row) {
    throw new StorageNotFoundError(`Unknown opportunity id: ${id}`);
  }
  return mapRow(row);
};

export const removeWatchlistEntry = async (
  context: StorageContext,
  { opportunityId, workspaceKey }: { opportunityId: string; workspaceKey: string },
) => {
  const result = await execute(
    context.writer,
    "DELETE FROM workspace_watchlist_entries WHERE workspace_key = ? AND opportunity_id = ?",
    [requireWorkspaceKey(workspaceKey), requireOpportunityId(opportunityId)],
  );
  return result.changes > 0;
};
