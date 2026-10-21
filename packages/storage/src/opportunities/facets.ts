import {
  BUILDING_CATEGORIES,
  DESIGN_SCOPES,
  PROJECT_MODES,
  PROJECT_TYPES,
  includesValue,
} from "@arch-competition/core";

import type { Clock } from "../context";
import type { SqlStatement } from "../driver/sql";
import { compactText, resolveProcedureType } from "../procedure-types";
import { buildWhere, type NormalizedQuery } from "./query";
import type { StoredFilterOptions } from "./types";

/**
 * Selectable filter values for the current slice, computed by SQL aggregation (GROUP BY /
 * json_each) instead of reading every row. The slice is "all rows matching the active
 * filters", plus the currently selected values, so a selection never disappears from its
 * own control.
 */
export type FacetRow = { facet: string; value: string | null };

const jsonFacet = (facet: string, column: string) => `
  SELECT '${facet}' AS facet, item.value AS value
  FROM filtered, json_each(CASE WHEN json_valid(filtered.${column}) THEN filtered.${column} ELSE '[]' END) AS item
  GROUP BY item.value`;

const scalarFacet = (facet: string, column: string) => `
  SELECT '${facet}' AS facet, ${column} AS value
  FROM filtered
  WHERE ${column} IS NOT NULL AND TRIM(${column}) != ''
  GROUP BY ${column}`;

type FacetSource = { build: (facet: string, column: string) => string; column: string; facet: string };

/**
 * Cloudflare D1 allows at most 5 terms in a compound SELECT (SQLite's own default is 500, so the
 * local adapter would not notice). The facets are therefore split over two statements that
 * travel in the same batch. `opportunities-query.test.ts` pins the term count.
 */
export const FACET_GROUPS: FacetSource[][] = [
  [
    { build: scalarFacet, column: "jurisdiction", facet: "jurisdiction" },
    { build: scalarFacet, column: "procedure_type", facet: "procedure_type" },
    { build: scalarFacet, column: "implementation_path", facet: "implementation_path" },
    { build: jsonFacet, column: "project_types", facet: "project_type" },
  ],
  [
    { build: jsonFacet, column: "building_categories", facet: "building_category" },
    { build: jsonFacet, column: "design_scopes", facet: "design_scope" },
    { build: jsonFacet, column: "project_modes", facet: "project_mode" },
  ],
];

export const buildFacetStatements = (query: NormalizedQuery, clock: Clock): SqlStatement[] => {
  const { clause, parameters } = buildWhere(query, clock);
  return FACET_GROUPS.map((group) => ({
    parameters,
    sql: `
    WITH filtered AS (
      SELECT jurisdiction, procedure_type, implementation_path,
             project_types, building_categories, design_scopes, project_modes
      FROM competitions ${clause}
    )
    ${group.map(({ build, column, facet }) => build(facet, column)).join("\n    UNION ALL ")}`,
  }));
};

const byLocale = (left: string, right: string) => left.localeCompare(right);

export const buildFilterOptions = (rows: FacetRow[], query: NormalizedQuery): StoredFilterOptions => {
  const values = (facet: string) =>
    rows.filter((row) => row.facet === facet && row.value !== null).map((row) => row.value as string);

  const procedureTypes = new Set<string>();
  for (const raw of values("procedure_type")) {
    const key = resolveProcedureType(raw).key;
    if (key) procedureTypes.add(key);
  }
  if (query.procedureType) {
    const selected = resolveProcedureType(query.procedureType).key;
    if (selected) procedureTypes.add(selected);
  }

  const jurisdictions = new Set(values("jurisdiction").map((value) => compactText(value) ?? value));
  if (query.jurisdiction) jurisdictions.add(query.jurisdiction);
  const implementationPaths = new Set(values("implementation_path").map((value) => compactText(value) ?? value));
  if (query.implementationPath) implementationPaths.add(query.implementationPath);

  const ordered = <T extends string>(order: readonly T[], facet: string, selected: T[] | undefined) => {
    const found = new Set<string>([...values(facet), ...(selected ?? [])]);
    return order.filter((item) => found.has(item) && includesValue(order, item));
  };

  return {
    buildingCategories: ordered(BUILDING_CATEGORIES, "building_category", query.buildingCategories),
    designScopes: ordered(DESIGN_SCOPES, "design_scope", query.designScopes),
    implementationPaths: [...implementationPaths].sort(byLocale),
    jurisdictions: [...jurisdictions].sort(byLocale),
    procedureTypes: [...procedureTypes].sort(byLocale),
    projectModes: ordered(PROJECT_MODES, "project_mode", query.projectModes),
    projectTypes: ordered(PROJECT_TYPES, "project_type", query.projectTypes),
  };
};
