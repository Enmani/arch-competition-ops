import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

import Database from "better-sqlite3";

import type {
  StoredBuildingCategory,
  StoredDesignScope,
  StoredOpportunityQuery,
  StoredProjectMode,
  StoredProjectType,
} from "./index";

type SqlParameter = string | number | bigint | Uint8Array | null;

type SavedSearchRow = {
  created_at: string;
  filters_json: string;
  id: number;
  name: string;
  updated_at: string;
  workspace_key: string;
};

type WatchlistEntryRow = {
  created_at: string;
  id: number;
  opportunity_id: string;
  updated_at: string;
  workspace_key: string;
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const resolveRepoRoot = () => {
  const cwd = process.cwd();
  const candidates = [
    cwd,
    path.resolve(cwd, ".."),
    path.resolve(cwd, "../.."),
    path.resolve(cwd, "../../.."),
    path.resolve(currentDirectory, "../../.."),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "AGENTS.md")) && existsSync(path.join(candidate, "data"))) {
      return candidate;
    }
  }

  return path.resolve(currentDirectory, "../../..");
};
const repoRoot = resolveRepoRoot();

const storedProjectTypes = new Set<StoredProjectType>([
  "urban_regeneration",
  "environment_design",
  "urban_planning",
  "interior_project",
  "building_project",
]);
const storedBuildingCategories = new Set<StoredBuildingCategory>([
  "healthcare",
  "education",
  "housing",
  "civic_public",
  "sport_leisure",
  "culture_heritage",
  "transport_infrastructure",
]);
const storedDesignScopes = new Set<StoredDesignScope>([
  "interior_design",
  "architectural_design",
  "scheme",
  "preliminary",
  "construction_docs",
  "planning",
  "design_service",
]);
const storedProjectModes = new Set<StoredProjectMode>(["new_build", "renovation", "extension"]);
const storedSortValues = new Set<NonNullable<StoredOpportunityQuery["sort"]>>([
  "deadline",
  "highest_value",
  "latest",
]);

export type StoredSavedSearch = {
  createdAt: string;
  filters: StoredOpportunityQuery;
  id: number;
  name: string;
  updatedAt: string;
  workspaceKey: string;
};

export type StoredSavedSearchQuery = {
  limit?: number;
  workspaceKey: string;
};

export type StoredSavedSearchCreateInput = {
  filters: StoredOpportunityQuery;
  name: string;
  workspaceKey: string;
};

export type StoredSavedSearchDeleteInput = {
  id: number;
  workspaceKey: string;
};

export type StoredWatchlistEntry = {
  createdAt: string;
  id: number;
  opportunityId: string;
  updatedAt: string;
  workspaceKey: string;
};

export type StoredWatchlistEntryQuery = {
  limit?: number;
  workspaceKey: string;
};

export type StoredWatchlistEntryCreateInput = {
  opportunityId: string;
  workspaceKey: string;
};

export type StoredWatchlistEntryDeleteInput = {
  opportunityId: string;
  workspaceKey: string;
};

const resolveSqlitePath = () => {
  const envPath = process.env.ARCH_COMPETITION_DB_PATH;
  if (envPath && envPath.trim()) {
    return path.resolve(envPath);
  }
  return path.join(repoRoot, "data", "competitions.sqlite");
};

const readRows = <T>(statement: string, parameters: SqlParameter[] = []) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    return [] as T[];
  }

  const database = new Database(sqlitePath, { readonly: true });
  try {
    return database.prepare(statement).all(...parameters) as T[];
  } finally {
    database.close();
  }
};

const readRow = <T>(statement: string, parameters: SqlParameter[] = []) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    return undefined;
  }

  const database = new Database(sqlitePath, { readonly: true });
  try {
    return database.prepare(statement).get(...parameters) as T | undefined;
  } finally {
    database.close();
  }
};

const withWriteDatabase = <T>(handler: (database: Database.Database) => T) => {
  const sqlitePath = resolveSqlitePath();
  if (!existsSync(sqlitePath)) {
    throw new Error("SQLite database not found");
  }

  const database = new Database(sqlitePath);
  try {
    return handler(database);
  } finally {
    database.close();
  }
};

const hasTable = (tableName: string) => {
  try {
    const row = readRow<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      [tableName],
    );
    return Boolean(row?.name);
  } catch {
    return false;
  }
};

const ensureWorkspaceTables = (database: Database.Database, tableNames: string[]) => {
  const placeholders = tableNames.map(() => "?").join(", ");
  const rows = database
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`,
    )
    .all(...tableNames) as Array<{ name: string }>;

  if (rows.length !== tableNames.length) {
    throw new Error("Workspace tables are unavailable");
  }
};

const toUniqueArray = <T extends string>(values: T[]) => [...new Set(values)];

const normalizeText = (value: string | null | undefined) => {
  if (!value) {
    return undefined;
  }

  const trimmed = value.replace(/\s+/g, " ").trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const normalizeNumber = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : undefined);

const normalizeStoredFilters = (value: unknown): StoredOpportunityQuery => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const source = value as Record<string, unknown>;
  const buildingCategories = Array.isArray(source.buildingCategories)
    ? toUniqueArray(
        source.buildingCategories.filter(
          (item): item is StoredBuildingCategory =>
            typeof item === "string" && storedBuildingCategories.has(item as StoredBuildingCategory),
        ),
      )
    : [];
  const designScopes = Array.isArray(source.designScopes)
    ? toUniqueArray(
        source.designScopes.filter(
          (item): item is StoredDesignScope =>
            typeof item === "string" && storedDesignScopes.has(item as StoredDesignScope),
        ),
      )
    : [];
  const projectTypes = Array.isArray(source.projectTypes)
    ? toUniqueArray(
        source.projectTypes.filter(
          (item): item is StoredProjectType =>
            typeof item === "string" && storedProjectTypes.has(item as StoredProjectType),
        ),
      )
    : [];
  const projectModes = Array.isArray(source.projectModes)
    ? toUniqueArray(
        source.projectModes.filter(
          (item): item is StoredProjectMode =>
            typeof item === "string" && storedProjectModes.has(item as StoredProjectMode),
        ),
      )
    : [];
  const rawSort = typeof source.sort === "string" ? source.sort : undefined;
  const sort =
    rawSort && storedSortValues.has(rawSort as NonNullable<StoredOpportunityQuery["sort"]>)
      ? (rawSort as NonNullable<StoredOpportunityQuery["sort"]>)
      : undefined;
  const licensedArchitectRequired =
    typeof source.licensedArchitectRequired === "boolean"
      ? source.licensedArchitectRequired
      : undefined;
  const includeExpired = typeof source.includeExpired === "boolean" ? source.includeExpired : undefined;
  const normalizedFilters: StoredOpportunityQuery = {};

  if (buildingCategories.length > 0) {
    normalizedFilters.buildingCategories = buildingCategories;
  }
  if (designScopes.length > 0) {
    normalizedFilters.designScopes = designScopes;
  }

  const deadlineAfter = normalizeText(
    typeof source.deadlineAfter === "string" ? source.deadlineAfter : undefined,
  );
  if (deadlineAfter) {
    normalizedFilters.deadlineAfter = deadlineAfter;
  }

  const deadlineBefore = normalizeText(
    typeof source.deadlineBefore === "string" ? source.deadlineBefore : undefined,
  );
  if (deadlineBefore) {
    normalizedFilters.deadlineBefore = deadlineBefore;
  }

  const implementationPath = normalizeText(
    typeof source.implementationPath === "string" ? source.implementationPath : undefined,
  );
  if (implementationPath) {
    normalizedFilters.implementationPath = implementationPath;
  }

  if (includeExpired === true) {
    normalizedFilters.includeExpired = true;
  }

  const jurisdiction = normalizeText(
    typeof source.jurisdiction === "string" ? source.jurisdiction : undefined,
  );
  if (jurisdiction) {
    normalizedFilters.jurisdiction = jurisdiction;
  }

  if (licensedArchitectRequired === true) {
    normalizedFilters.licensedArchitectRequired = true;
  }

  const maxEstimatedValueEur = normalizeNumber(source.maxEstimatedValueEur);
  if (maxEstimatedValueEur !== undefined) {
    normalizedFilters.maxEstimatedValueEur = maxEstimatedValueEur;
  }

  const minEstimatedValueEur = normalizeNumber(source.minEstimatedValueEur);
  if (minEstimatedValueEur !== undefined) {
    normalizedFilters.minEstimatedValueEur = minEstimatedValueEur;
  }

  const minQualificationScore = normalizeNumber(source.minQualificationScore);
  if (minQualificationScore !== undefined) {
    normalizedFilters.minQualificationScore = minQualificationScore;
  }

  const procedureType = normalizeText(
    typeof source.procedureType === "string" ? source.procedureType : undefined,
  );
  if (procedureType) {
    normalizedFilters.procedureType = procedureType;
  }

  if (projectTypes.length > 0) {
    normalizedFilters.projectTypes = projectTypes;
  }
  if (projectModes.length > 0) {
    normalizedFilters.projectModes = projectModes;
  }

  const publishedWithinDays = normalizeNumber(source.publishedWithinDays);
  if (publishedWithinDays !== undefined) {
    normalizedFilters.publishedWithinDays = publishedWithinDays;
  }

  const search = normalizeText(typeof source.search === "string" ? source.search : undefined);
  if (search) {
    normalizedFilters.search = search;
  }

  if (sort) {
    normalizedFilters.sort = sort;
  }

  return normalizedFilters;
};

const isSavedSearchEmpty = (filters: StoredOpportunityQuery) => Object.keys(filters).length === 0;

const mapSavedSearchRow = (row: SavedSearchRow): StoredSavedSearch => ({
  createdAt: row.created_at,
  filters: normalizeStoredFilters(safeJsonParse(row.filters_json)),
  id: row.id,
  name: row.name,
  updatedAt: row.updated_at,
  workspaceKey: row.workspace_key,
});

const mapWatchlistEntryRow = (row: WatchlistEntryRow): StoredWatchlistEntry => ({
  createdAt: row.created_at,
  id: row.id,
  opportunityId: row.opportunity_id,
  updatedAt: row.updated_at,
  workspaceKey: row.workspace_key,
});

const safeJsonParse = (payload: string) => {
  try {
    return JSON.parse(payload) as unknown;
  } catch {
    return {};
  }
};

const getSavedSearchById = (database: Database.Database, id: number) => {
  const row = database
    .prepare(
      `
        SELECT id, workspace_key, name, filters_json, created_at, updated_at
        FROM workspace_saved_searches
        WHERE id = ?
      `,
    )
    .get(id) as SavedSearchRow | undefined;

  return row ? mapSavedSearchRow(row) : undefined;
};

const getSavedSearchBySignature = (
  database: Database.Database,
  workspaceKey: string,
  name: string,
  filtersJson: string,
) => {
  const row = database
    .prepare(
      `
        SELECT id, workspace_key, name, filters_json, created_at, updated_at
        FROM workspace_saved_searches
        WHERE workspace_key = ? AND name = ? AND filters_json = ?
        ORDER BY id DESC
        LIMIT 1
      `,
    )
    .get(workspaceKey, name, filtersJson) as SavedSearchRow | undefined;

  return row ? mapSavedSearchRow(row) : undefined;
};

const getWatchlistEntry = (
  database: Database.Database,
  workspaceKey: string,
  opportunityId: string,
) => {
  const row = database
    .prepare(
      `
        SELECT id, workspace_key, opportunity_id, created_at, updated_at
        FROM workspace_watchlist_entries
        WHERE workspace_key = ? AND opportunity_id = ?
      `,
    )
    .get(workspaceKey, opportunityId) as WatchlistEntryRow | undefined;

  return row ? mapWatchlistEntryRow(row) : undefined;
};

const normalizeWorkspaceKey = (workspaceKey: string) => {
  const normalized = normalizeText(workspaceKey);
  if (!normalized) {
    throw new Error("Workspace key is required");
  }
  return normalized;
};

const normalizeSavedSearchName = (name: string) => {
  const normalized = normalizeText(name);
  if (!normalized) {
    throw new Error("Saved search name is required");
  }
  if (normalized.length > 80) {
    throw new Error("Saved search name must be 80 characters or fewer");
  }
  return normalized;
};

const normalizeOpportunityId = (opportunityId: string) => {
  const normalized = normalizeText(opportunityId);
  if (!normalized) {
    throw new Error("Opportunity id is required");
  }
  return normalized;
};

export const queryStoredSavedSearches = ({
  limit = 20,
  workspaceKey,
}: StoredSavedSearchQuery): StoredSavedSearch[] => {
  if (!hasTable("workspace_saved_searches")) {
    return [];
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  try {
    const rows = readRows<SavedSearchRow>(
      `
        SELECT id, workspace_key, name, filters_json, created_at, updated_at
        FROM workspace_saved_searches
        WHERE workspace_key = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      [normalizedWorkspaceKey, limit],
    );
    return rows.map(mapSavedSearchRow);
  } catch {
    return [];
  }
};

export const createStoredSavedSearch = ({
  filters,
  name,
  workspaceKey,
}: StoredSavedSearchCreateInput): StoredSavedSearch => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedName = normalizeSavedSearchName(name);
  const normalizedFilters = normalizeStoredFilters(filters);
  if (isSavedSearchEmpty(normalizedFilters)) {
    throw new Error("Saved search filters are required");
  }

  return withWriteDatabase((database) => {
    ensureWorkspaceTables(database, ["workspace_saved_searches"]);
    const filtersJson = JSON.stringify(normalizedFilters);

    database.exec("BEGIN IMMEDIATE");
    try {
      const existingSavedSearch = getSavedSearchBySignature(
        database,
        normalizedWorkspaceKey,
        normalizedName,
        filtersJson,
      );
      if (existingSavedSearch) {
        const now = new Date().toISOString();
        database
          .prepare(
            `
              UPDATE workspace_saved_searches
              SET updated_at = ?
              WHERE id = ?
            `,
          )
          .run(now, existingSavedSearch.id);

        const savedSearch = getSavedSearchById(database, existingSavedSearch.id);
        if (!savedSearch) {
          throw new Error("Failed to reload saved search");
        }

        database.exec("COMMIT");
        return savedSearch;
      }

      const now = new Date().toISOString();
      const result = database
        .prepare(
          `
            INSERT INTO workspace_saved_searches (
              workspace_key,
              name,
              filters_json,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?)
          `,
        )
        .run(normalizedWorkspaceKey, normalizedName, filtersJson, now, now);

      const savedSearch = getSavedSearchById(database, Number(result.lastInsertRowid));
      if (!savedSearch) {
        throw new Error("Failed to reload saved search");
      }

      database.exec("COMMIT");
      return savedSearch;
    } catch (error) {
      try {
        database.exec("ROLLBACK");
      } catch {
        // ignore rollback failures after aborted transactions
      }
      throw error;
    }
  });
};

export const deleteStoredSavedSearch = ({
  id,
  workspaceKey,
}: StoredSavedSearchDeleteInput): boolean => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  return withWriteDatabase((database) => {
    ensureWorkspaceTables(database, ["workspace_saved_searches"]);
    const result = database
      .prepare(
        `
          DELETE FROM workspace_saved_searches
          WHERE id = ? AND workspace_key = ?
        `,
      )
      .run(id, normalizedWorkspaceKey);
    return result.changes > 0;
  });
};

export const queryStoredWatchlistEntries = ({
  limit = 50,
  workspaceKey,
}: StoredWatchlistEntryQuery): StoredWatchlistEntry[] => {
  if (!hasTable("workspace_watchlist_entries")) {
    return [];
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  try {
    const rows = readRows<WatchlistEntryRow>(
      `
        SELECT id, workspace_key, opportunity_id, created_at, updated_at
        FROM workspace_watchlist_entries
        WHERE workspace_key = ?
        ORDER BY updated_at DESC, id DESC
        LIMIT ?
      `,
      [normalizedWorkspaceKey, limit],
    );
    return rows.map(mapWatchlistEntryRow);
  } catch {
    return [];
  }
};

export const listStoredWatchedOpportunityIds = (workspaceKey: string): string[] => {
  if (!hasTable("workspace_watchlist_entries")) {
    return [];
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);

  try {
    const rows = readRows<{ opportunity_id: string }>(
      `
        SELECT opportunity_id
        FROM workspace_watchlist_entries
        WHERE workspace_key = ?
        ORDER BY updated_at DESC, id DESC
      `,
      [normalizedWorkspaceKey],
    );
    return rows.map((row) => row.opportunity_id);
  } catch {
    return [];
  }
};

export const isStoredOpportunityWatched = ({
  opportunityId,
  workspaceKey,
}: StoredWatchlistEntryCreateInput): boolean => {
  if (!hasTable("workspace_watchlist_entries")) {
    return false;
  }

  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);

  const row = readRow<{ opportunity_id: string }>(
    `
      SELECT opportunity_id
      FROM workspace_watchlist_entries
      WHERE workspace_key = ? AND opportunity_id = ?
    `,
    [normalizedWorkspaceKey, normalizedOpportunityId],
  );

  return Boolean(row?.opportunity_id);
};

export const createStoredWatchlistEntry = ({
  opportunityId,
  workspaceKey,
}: StoredWatchlistEntryCreateInput): StoredWatchlistEntry => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);

  return withWriteDatabase((database) => {
    ensureWorkspaceTables(database, ["workspace_watchlist_entries", "competitions"]);

    const opportunity = database
      .prepare("SELECT id FROM competitions WHERE id = ?")
      .get(normalizedOpportunityId) as { id: string } | undefined;
    if (!opportunity) {
      throw new Error(`Unknown opportunity id: ${normalizedOpportunityId}`);
    }

    const now = new Date().toISOString();
    database
      .prepare(
        `
          INSERT INTO workspace_watchlist_entries (
            workspace_key,
            opportunity_id,
            created_at,
            updated_at
          ) VALUES (?, ?, ?, ?)
          ON CONFLICT(workspace_key, opportunity_id) DO UPDATE SET
            updated_at = excluded.updated_at
        `,
      )
      .run(normalizedWorkspaceKey, normalizedOpportunityId, now, now);

    const entry = getWatchlistEntry(database, normalizedWorkspaceKey, normalizedOpportunityId);
    if (!entry) {
      throw new Error("Failed to reload watchlist entry");
    }
    return entry;
  });
};

export const deleteStoredWatchlistEntry = ({
  opportunityId,
  workspaceKey,
}: StoredWatchlistEntryDeleteInput): boolean => {
  const normalizedWorkspaceKey = normalizeWorkspaceKey(workspaceKey);
  const normalizedOpportunityId = normalizeOpportunityId(opportunityId);

  return withWriteDatabase((database) => {
    ensureWorkspaceTables(database, ["workspace_watchlist_entries"]);
    const result = database
      .prepare(
        `
          DELETE FROM workspace_watchlist_entries
          WHERE workspace_key = ? AND opportunity_id = ?
        `,
      )
      .run(normalizedWorkspaceKey, normalizedOpportunityId);
    return result.changes > 0;
  });
};
