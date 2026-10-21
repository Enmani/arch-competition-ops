import { parseDiscoverFilters, type DiscoverFilters } from "@arch-competition/core";

/**
 * Canonical form of saved-search filters.
 *
 * The canonical JSON text is what the unique index `(workspace_key, filters_json)` (migration
 * 0005) compares, so it must be deterministic: fixed key order, sorted/unique arrays, no
 * paging fields, no empty values. Anything the discover schema rejects is dropped.
 */
const KEY_ORDER = [
  "buildingCategories",
  "deadlineAfter",
  "deadlineBefore",
  "designScopes",
  "implementationPath",
  "includeExpired",
  "jurisdiction",
  "licensedArchitectRequired",
  "maxEstimatedValueEur",
  "minEstimatedValueEur",
  "minQualificationScore",
  "procedureType",
  "projectModes",
  "projectTypes",
  "publishedWithinDays",
  "search",
  "sort",
] as const;

export const canonicalizeFilters = (input: unknown): DiscoverFilters => {
  const parsed = parseDiscoverFilters(input, "lenient");
  const filters: Record<string, unknown> = parsed.ok ? { ...parsed.filters } : {};
  const canonical: Record<string, unknown> = {};

  for (const key of KEY_ORDER) {
    const value = filters[key];
    if (value === undefined || value === false || (Array.isArray(value) && value.length === 0)) {
      continue;
    }
    canonical[key] = Array.isArray(value) ? [...value].sort() : value;
  }
  return canonical as DiscoverFilters;
};

export const serializeFilters = (filters: DiscoverFilters) => JSON.stringify(canonicalizeFilters(filters));

export const hasActiveFilters = (filters: DiscoverFilters) => Object.keys(filters).length > 0;
