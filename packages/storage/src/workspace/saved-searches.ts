import { SAVED_SEARCH_NAME_MAX_LENGTH, type DiscoverFilters } from "@arch-competition/core";

import type { StorageContext } from "../context";
import { StorageValidationError } from "../domain-errors";
import { execute, readRow, readRows } from "../driver/sql";
import { canonicalizeFilters, hasActiveFilters, serializeFilters } from "./filters";
import { requireWorkspaceKey } from "./keys";

export type StoredSavedSearch = {
  createdAt: string;
  filters: DiscoverFilters;
  id: number;
  name: string;
  updatedAt: string;
  workspaceKey: string;
};

type SavedSearchRow = {
  created_at: string;
  filters_json: string;
  id: number;
  name: string;
  updated_at: string;
  workspace_key: string;
};

const COLUMNS = "id, workspace_key, name, filters_json, created_at, updated_at";

const mapRow = (row: SavedSearchRow, context: StorageContext): StoredSavedSearch => {
  let filters: DiscoverFilters = {};
  try {
    filters = canonicalizeFilters(JSON.parse(row.filters_json));
  } catch {
    context.logger.warn("storage.malformed_saved_search_filters", { id: row.id });
  }
  return {
    createdAt: row.created_at,
    filters,
    id: row.id,
    name: row.name,
    updatedAt: row.updated_at,
    workspaceKey: row.workspace_key,
  };
};

export const listSavedSearches = async (
  context: StorageContext,
  { limit = 20, workspaceKey }: { limit?: number; workspaceKey: string },
): Promise<StoredSavedSearch[]> => {
  const rows = await readRows<SavedSearchRow>(
    context.writer,
    `SELECT ${COLUMNS} FROM workspace_saved_searches
     WHERE workspace_key = ?
     ORDER BY updated_at DESC, id DESC
     LIMIT ?`,
    [requireWorkspaceKey(workspaceKey), Math.min(Math.max(Math.trunc(limit), 1), 100)],
  );
  return rows.map((row) => mapRow(row, context));
};

/**
 * Saves a search. Identical filters in one workspace are ONE row (unique index
 * `(workspace_key, filters_json)`): a concurrent or repeated save refreshes `updated_at` and
 * takes the latest name instead of inserting a duplicate.
 */
export const createSavedSearch = async (
  context: StorageContext,
  { filters, name, workspaceKey }: { filters: DiscoverFilters; name: string; workspaceKey: string },
): Promise<StoredSavedSearch> => {
  const key = requireWorkspaceKey(workspaceKey);
  const normalizedName = name.replace(/\s+/g, " ").trim();
  if (!normalizedName) {
    throw new StorageValidationError("Saved search name is required");
  }
  if (normalizedName.length > SAVED_SEARCH_NAME_MAX_LENGTH) {
    throw new StorageValidationError(
      `Saved search name must be ${SAVED_SEARCH_NAME_MAX_LENGTH} characters or fewer`,
    );
  }
  const canonical = canonicalizeFilters(filters);
  if (!hasActiveFilters(canonical)) {
    throw new StorageValidationError("Saved search filters are required");
  }

  const now = context.clock.now().toISOString();
  const row = await readRow<SavedSearchRow>(
    context.writer,
    `INSERT INTO workspace_saved_searches (workspace_key, name, filters_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (workspace_key, filters_json) DO UPDATE SET
       name = excluded.name,
       updated_at = excluded.updated_at
     RETURNING ${COLUMNS}`,
    [key, normalizedName, serializeFilters(canonical), now, now],
  );
  if (!row) {
    throw new Error("Saved search upsert returned no row");
  }
  return mapRow(row, context);
};

export const deleteSavedSearch = async (
  context: StorageContext,
  { id, workspaceKey }: { id: number; workspaceKey: string },
) => {
  const result = await execute(
    context.writer,
    "DELETE FROM workspace_saved_searches WHERE id = ? AND workspace_key = ?",
    [id, requireWorkspaceKey(workspaceKey)],
  );
  return result.changes > 0;
};
