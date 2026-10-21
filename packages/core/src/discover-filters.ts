import { z } from "zod";

import {
  BUILDING_CATEGORIES,
  DESIGN_SCOPES,
  OPPORTUNITY_SORTS,
  PROJECT_MODES,
  PROJECT_TYPES,
  includesValue,
  type BuildingCategory,
  type DesignScope,
  type OpportunitySort,
  type ProjectMode,
  type ProjectType,
} from "./taxonomy";

/**
 * Discover filters: the one validated shape for URL query strings, `/api/opportunities`,
 * saved-search JSON and the storage layer's query input.
 *
 * Two parse modes share the same field definitions:
 * - "strict": API boundary, invalid input produces issues (HTTP 400);
 * - "lenient": page URLs and stored JSON, invalid fields are dropped so an old bookmark or
 *   a hand-edited row never breaks rendering.
 * Numeric values are clamped (never rejected) so absurd values cannot reach SQL or
 * `Date` arithmetic (the `publishedWithinDays=1e9` RangeError from the audit).
 */
export const DISCOVER_DEFAULT_LIMIT = 24;
export const DISCOVER_MAX_LIMIT = 100;
export const DISCOVER_MAX_OFFSET = 100_000;
export const DISCOVER_MAX_PUBLISHED_WITHIN_DAYS = 3650;
export const DISCOVER_MAX_VALUE_EUR = 1_000_000_000_000;
export const DISCOVER_MAX_TEXT_LENGTH = 200;
export const DISCOVER_MAX_MULTI_VALUES = 20;

export type DiscoverFilters = {
  buildingCategories?: BuildingCategory[];
  deadlineAfter?: string;
  deadlineBefore?: string;
  designScopes?: DesignScope[];
  implementationPath?: string;
  includeExpired?: boolean;
  jurisdiction?: string;
  licensedArchitectRequired?: boolean;
  limit?: number;
  maxEstimatedValueEur?: number;
  minEstimatedValueEur?: number;
  minQualificationScore?: number;
  offset?: number;
  procedureType?: string;
  projectModes?: ProjectMode[];
  projectTypes?: ProjectType[];
  publishedWithinDays?: number;
  search?: string;
  sort?: OpportunitySort;
};

export type DiscoverQueryInput = Record<string, string | string[] | undefined>;

export const isIsoDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const blankToUndefined = (value: unknown) =>
  value === "" || value === null || (typeof value === "string" && value.trim() === "")
    ? undefined
    : value;

const firstValue = (value: unknown) => (Array.isArray(value) ? value[0] : value);

const clampedNumber = (min: number, max: number, integer: boolean) =>
  z.preprocess(
    (value) => {
      const scalar = blankToUndefined(firstValue(value));
      if (scalar === undefined) {
        return undefined;
      }
      return typeof scalar === "number" ? scalar : typeof scalar === "string" ? Number(scalar) : Number.NaN;
    },
    z
      .number()
      .refine(Number.isFinite, "must be a finite number")
      .transform((value) => {
        const bounded = Math.min(Math.max(value, min), max);
        return integer ? Math.trunc(bounded) : bounded;
      })
      .optional(),
  );

const booleanFlag = z.preprocess(
  (value) => {
    const scalar = blankToUndefined(firstValue(value));
    if (scalar === "true" || scalar === true) return true;
    if (scalar === "false" || scalar === false) return false;
    return scalar === undefined ? undefined : "invalid";
  },
  z.boolean().optional(),
);

const boundedText = (max: number) =>
  z.preprocess(
    (value) => {
      const scalar = blankToUndefined(firstValue(value));
      return typeof scalar === "string" ? scalar.replace(/\s+/g, " ").trim() || undefined : scalar;
    },
    z.string().max(max).optional(),
  );

const isoDate = z.preprocess(
  (value) => {
    const scalar = blankToUndefined(firstValue(value));
    return typeof scalar === "string" ? scalar.trim() : scalar;
  },
  z.string().refine(isIsoDate, "must be a calendar date formatted YYYY-MM-DD").optional(),
);

const toList = (value: unknown) => {
  const scalar = blankToUndefined(value);
  if (scalar === undefined) return undefined;
  return Array.isArray(scalar) ? scalar : [scalar];
};

const unique = <T>(values: T[]) => [...new Set(values)];

const enumList = <T extends string>(values: readonly T[], strict: boolean) =>
  z.preprocess(
    toList,
    strict
      ? z
          .array(z.enum(values as readonly [T, ...T[]]))
          .max(DISCOVER_MAX_MULTI_VALUES)
          .transform(unique)
          .optional()
      : z
          .array(z.unknown())
          .transform((items) => unique(items.filter((item): item is T => includesValue(values, item))))
          .optional(),
  );

const buildSchema = (strict: boolean) =>
  z.object({
    buildingCategories: enumList(BUILDING_CATEGORIES, strict),
    deadlineAfter: isoDate,
    deadlineBefore: isoDate,
    designScopes: enumList(DESIGN_SCOPES, strict),
    implementationPath: boundedText(DISCOVER_MAX_TEXT_LENGTH),
    includeExpired: booleanFlag,
    jurisdiction: boundedText(DISCOVER_MAX_TEXT_LENGTH),
    licensedArchitectRequired: booleanFlag,
    limit: clampedNumber(1, DISCOVER_MAX_LIMIT, true),
    maxEstimatedValueEur: clampedNumber(0, DISCOVER_MAX_VALUE_EUR, false),
    minEstimatedValueEur: clampedNumber(0, DISCOVER_MAX_VALUE_EUR, false),
    minQualificationScore: clampedNumber(0, 100, false),
    offset: clampedNumber(0, DISCOVER_MAX_OFFSET, true),
    procedureType: boundedText(DISCOVER_MAX_TEXT_LENGTH),
    projectModes: enumList(PROJECT_MODES, strict),
    projectTypes: enumList(PROJECT_TYPES, strict),
    publishedWithinDays: clampedNumber(1, DISCOVER_MAX_PUBLISHED_WITHIN_DAYS, true),
    search: boundedText(DISCOVER_MAX_TEXT_LENGTH),
    sort: z.preprocess(
      (value) => blankToUndefined(firstValue(value)),
      strict
        ? z.enum(OPPORTUNITY_SORTS).optional()
        : z
            .unknown()
            .transform((value) => (includesValue(OPPORTUNITY_SORTS, value) ? value : undefined))
            .optional(),
    ),
  });

const strictSchema = buildSchema(true);
// Lenient mode additionally swallows any field-level failure (bad date, NaN, wrong type).
const lenientShape = Object.fromEntries(
  Object.entries(buildSchema(false).shape).map(([key, field]) => [key, (field as z.ZodTypeAny).catch(undefined)]),
) as unknown as ReturnType<typeof buildSchema>["shape"];
const lenientSchema = z.object(lenientShape);

const stripUndefined = (value: Record<string, unknown>): DiscoverFilters =>
  Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as DiscoverFilters;

export type DiscoverParseResult =
  | { ok: true; filters: DiscoverFilters }
  | { ok: false; issues: string[] };

/** Parses an object that already uses filter field names (saved-search JSON, JSON bodies). */
export const parseDiscoverFilters = (
  input: unknown,
  mode: "strict" | "lenient" = "lenient",
): DiscoverParseResult => {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const result = (mode === "strict" ? strictSchema : lenientSchema).safeParse(source);
  if (!result.success) {
    return {
      ok: false,
      issues: result.error.issues.map((issue) => `${issue.path.join(".") || "filters"}: ${issue.message}`),
    };
  }
  return { ok: true, filters: stripUndefined(result.data) };
};

/**
 * URL/query names differ from filter field names for the multi-select facets
 * (`projectType` -> `projectTypes`, ...). Existing bookmarks and the discover form keep
 * using the singular query names, so the mapping lives here, next to the schema.
 */
export const discoverQueryToFilters = (query: DiscoverQueryInput): Record<string, unknown> => ({
  ...query,
  buildingCategories: query.buildingCategory ?? query.buildingCategories,
  designScopes: query.designScope ?? query.designScopes,
  projectModes: query.projectMode ?? query.projectModes,
  projectTypes: query.projectType ?? query.projectTypes,
});

export const parseDiscoverQuery = (
  query: DiscoverQueryInput,
  mode: "strict" | "lenient" = "lenient",
) => parseDiscoverFilters(discoverQueryToFilters(query), mode);
