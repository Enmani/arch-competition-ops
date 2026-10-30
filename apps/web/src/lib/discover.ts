import { parseDiscoverQuery, type DiscoverQueryInput } from "@arch-competition/core";
import type { StoredOpportunityQuery } from "@arch-competition/storage";

/**
 * Page-side helpers for the discover surface. Validation lives in @arch-competition/core
 * (`parseDiscoverQuery`), the same schema the API and storage use; this file only adds URL
 * (de)serialisation and the default sort.
 */
export type DiscoverSearchParams = DiscoverQueryInput;

const DISCOVER_DEFAULT_SORT: NonNullable<StoredOpportunityQuery["sort"]> = "deadline";

/** Items rendered by the server on a fresh visit and fetched by each "load more". */
export const DISCOVER_PAGE_SIZE = 36;
/** Upper bound for restoring a deep list from the URL, so a hand-edited `loaded` stays cheap. */
export const DISCOVER_MAX_LOADED = 500;
/** URL parameter that remembers how many items were on screen (back button, reload, sharing). */
const DISCOVER_LOADED_PARAM = "loaded";

export const formatTokenLabel = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

export const collectDiscoverSearchParams = (searchParams: URLSearchParams): DiscoverSearchParams => {
  const nextSearchParams: DiscoverSearchParams = {};

  for (const key of new Set(searchParams.keys())) {
    const values = searchParams.getAll(key);
    if (values.length === 0) {
      continue;
    }
    nextSearchParams[key] = values.length === 1 ? values[0] : values;
  }

  return nextSearchParams;
};

export const buildDiscoverSearchParams = (filters: StoredOpportunityQuery): DiscoverSearchParams => {
  const searchParams: DiscoverSearchParams = {};
  const unique = <T extends string>(values: T[]) => [...new Set(values)];

  if (filters.search) {
    searchParams.search = filters.search;
  }
  if (filters.jurisdiction) {
    searchParams.jurisdiction = filters.jurisdiction;
  }
  if (filters.publishedWithinDays !== undefined) {
    searchParams.publishedWithinDays = filters.publishedWithinDays.toString();
  }
  if (filters.deadlineAfter) {
    searchParams.deadlineAfter = filters.deadlineAfter;
  }
  if (filters.deadlineBefore) {
    searchParams.deadlineBefore = filters.deadlineBefore;
  }
  if (filters.projectTypes && filters.projectTypes.length > 0) {
    searchParams.projectType = unique(filters.projectTypes);
  }
  if (filters.buildingCategories && filters.buildingCategories.length > 0) {
    searchParams.buildingCategory = unique(filters.buildingCategories);
  }
  if (filters.designScopes && filters.designScopes.length > 0) {
    searchParams.designScope = unique(filters.designScopes);
  }
  if (filters.projectModes && filters.projectModes.length > 0) {
    searchParams.projectMode = unique(filters.projectModes);
  }
  if (filters.minEstimatedValueEur !== undefined) {
    searchParams.minEstimatedValueEur = filters.minEstimatedValueEur.toString();
  }
  if (filters.maxEstimatedValueEur !== undefined) {
    searchParams.maxEstimatedValueEur = filters.maxEstimatedValueEur.toString();
  }
  if (filters.licensedArchitectRequired === true) {
    searchParams.licensedArchitectRequired = "true";
  }
  if (filters.includeExpired === true) {
    searchParams.includeExpired = "true";
  }
  if (filters.limit !== undefined) {
    searchParams.limit = filters.limit.toString();
  }
  if (filters.offset !== undefined && filters.offset > 0) {
    searchParams.offset = filters.offset.toString();
  }
  if (filters.procedureType) {
    searchParams.procedureType = filters.procedureType;
  }
  if (filters.implementationPath) {
    searchParams.implementationPath = filters.implementationPath;
  }
  if (filters.minQualificationScore !== undefined) {
    searchParams.minQualificationScore = filters.minQualificationScore.toString();
  }
  if (filters.sort && filters.sort !== DISCOVER_DEFAULT_SORT) {
    searchParams.sort = filters.sort;
  }

  return searchParams;
};

const withoutPaging = (filters: StoredOpportunityQuery): StoredOpportunityQuery => {
  const rest = { ...filters };
  delete rest.limit;
  delete rest.offset;
  return rest;
};

/** The discover page owns paging through `loaded`; `limit`/`offset` belong to the JSON API. */
export const readDiscoverPageState = (searchParams: DiscoverSearchParams) => {
  const filters = withoutPaging(readDiscoverFilters(searchParams));
  const rawLoaded = searchParams[DISCOVER_LOADED_PARAM];
  const parsed = Number.parseInt(Array.isArray(rawLoaded) ? (rawLoaded[0] ?? "") : (rawLoaded ?? ""), 10);
  const loaded = Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, DISCOVER_PAGE_SIZE), DISCOVER_MAX_LOADED)
    : DISCOVER_PAGE_SIZE;
  return { filters, loaded };
};

/** Query string for the discover URL: filters plus, once the list grew past one page, `loaded`. */
export const buildDiscoverPageSearchParams = (
  filters: StoredOpportunityQuery,
  loaded = DISCOVER_PAGE_SIZE,
): DiscoverSearchParams => ({
  ...buildDiscoverSearchParams(withoutPaging(filters)),
  ...(loaded > DISCOVER_PAGE_SIZE
    ? { [DISCOVER_LOADED_PARAM]: Math.min(Math.trunc(loaded), DISCOVER_MAX_LOADED).toString() }
    : {}),
});

/** Lenient: invalid values in an old or hand-edited URL are dropped instead of failing the page. */
export const readDiscoverFilters = (searchParams: DiscoverSearchParams): StoredOpportunityQuery => {
  const parsed = parseDiscoverQuery(searchParams, "lenient");
  const filters = parsed.ok ? parsed.filters : {};
  return { ...filters, sort: filters.sort ?? DISCOVER_DEFAULT_SORT };
};

export const countActiveDiscoverFilters = (filters: StoredOpportunityQuery) => {
  let total = 0;

  if (filters.search) total += 1;
  if (filters.jurisdiction) total += 1;
  if (filters.publishedWithinDays !== undefined) total += 1;
  if (filters.deadlineAfter) total += 1;
  if (filters.deadlineBefore) total += 1;
  if (filters.includeExpired === true) total += 1;
  if (filters.projectTypes) total += filters.projectTypes.length;
  if (filters.buildingCategories) total += filters.buildingCategories.length;
  if (filters.designScopes) total += filters.designScopes.length;
  if (filters.projectModes) total += filters.projectModes.length;
  if (filters.minEstimatedValueEur !== undefined) total += 1;
  if (filters.maxEstimatedValueEur !== undefined) total += 1;
  if (filters.minQualificationScore !== undefined) total += 1;
  if (filters.procedureType) total += 1;
  if (filters.implementationPath) total += 1;
  if (filters.licensedArchitectRequired === true) total += 1;
  if (filters.sort && filters.sort !== DISCOVER_DEFAULT_SORT) total += 1;

  return total;
};

/** Filters that live inside the collapsible panel (the bar's search, country and sort are visible anyway). */
export const countAdvancedDiscoverFilters = (filters: StoredOpportunityQuery) =>
  countActiveDiscoverFilters({
    ...filters,
    jurisdiction: undefined,
    search: undefined,
    sort: undefined,
  });
