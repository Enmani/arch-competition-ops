import type {
  StoredBuildingCategory,
  StoredOpportunityQuery,
  StoredProjectType,
} from "@arch-competition/storage";

export type DiscoverSearchParams = Record<string, string | string[] | undefined>;

export const DISCOVER_DEFAULT_LIMIT = 500;
export const DISCOVER_DEFAULT_SORT: NonNullable<StoredOpportunityQuery["sort"]> = "deadline";

export const discoverRecencyValues = ["", "7", "30", "90", "365"] as const;
export const discoverSortValues = ["deadline", "latest", "highest_value"] as const;

const readSingleValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const readMultiValue = (value: string | string[] | undefined) => {
  if (Array.isArray(value)) {
    return value;
  }
  return value ? [value] : [];
};

const readNumberValue = (value: string | string[] | undefined) => {
  const raw = readSingleValue(value);
  if (!raw) {
    return undefined;
  }

  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const isSortValue = (value: string | undefined): value is NonNullable<StoredOpportunityQuery["sort"]> =>
  value === "deadline" || value === "highest_value" || value === "latest";
const isProjectTypeValue = (value: string | undefined): value is StoredProjectType =>
  value === "urban_regeneration" ||
  value === "environment_design" ||
  value === "urban_planning" ||
  value === "building_project";
const isBuildingCategoryValue = (value: string | undefined): value is StoredBuildingCategory =>
  value === "healthcare" ||
  value === "education" ||
  value === "housing" ||
  value === "civic_public" ||
  value === "sport_leisure" ||
  value === "culture_heritage" ||
  value === "transport_infrastructure";

export const formatTokenLabel = (value: string) =>
  value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

const toUniqueArray = <T extends string>(values: T[]) => [...new Set(values)];

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

export const buildDiscoverSearchParams = (
  filters: StoredOpportunityQuery,
): DiscoverSearchParams => {
  const searchParams: DiscoverSearchParams = {};

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
    searchParams.projectType = toUniqueArray(filters.projectTypes);
  }
  if (filters.buildingCategories && filters.buildingCategories.length > 0) {
    searchParams.buildingCategory = toUniqueArray(filters.buildingCategories);
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

export const readDiscoverFilters = (
  searchParams: DiscoverSearchParams,
): StoredOpportunityQuery => {
  const sortValue = readSingleValue(searchParams.sort);
  const projectTypeValues = toUniqueArray(
    readMultiValue(searchParams.projectType).filter(isProjectTypeValue),
  );
  const buildingCategoryValues = toUniqueArray(
    readMultiValue(searchParams.buildingCategory).filter(isBuildingCategoryValue),
  );

  return {
    buildingCategories: buildingCategoryValues.length > 0 ? buildingCategoryValues : undefined,
    deadlineAfter: readSingleValue(searchParams.deadlineAfter) || undefined,
    deadlineBefore: readSingleValue(searchParams.deadlineBefore) || undefined,
    includeExpired: readSingleValue(searchParams.includeExpired) === "true" ? true : undefined,
    implementationPath: readSingleValue(searchParams.implementationPath) || undefined,
    jurisdiction: readSingleValue(searchParams.jurisdiction) || undefined,
    limit: readNumberValue(searchParams.limit) ?? DISCOVER_DEFAULT_LIMIT,
    licensedArchitectRequired:
      readSingleValue(searchParams.licensedArchitectRequired) === "true" ? true : undefined,
    maxEstimatedValueEur: readNumberValue(searchParams.maxEstimatedValueEur),
    minEstimatedValueEur: readNumberValue(searchParams.minEstimatedValueEur),
    minQualificationScore: readNumberValue(searchParams.minQualificationScore),
    publishedWithinDays: readNumberValue(searchParams.publishedWithinDays),
    procedureType: readSingleValue(searchParams.procedureType) || undefined,
    projectTypes: projectTypeValues.length > 0 ? projectTypeValues : undefined,
    search: readSingleValue(searchParams.search)?.trim() || undefined,
    sort: isSortValue(sortValue) ? sortValue : DISCOVER_DEFAULT_SORT,
  };
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
  if (filters.minEstimatedValueEur !== undefined) total += 1;
  if (filters.maxEstimatedValueEur !== undefined) total += 1;
  if (filters.minQualificationScore !== undefined) total += 1;
  if (filters.procedureType) total += 1;
  if (filters.implementationPath) total += 1;
  if (filters.licensedArchitectRequired === true) total += 1;
  if (filters.sort && filters.sort !== DISCOVER_DEFAULT_SORT) total += 1;

  return total;
};
