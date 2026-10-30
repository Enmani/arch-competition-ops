import {
  DISCOVER_DEFAULT_LIMIT,
  parseDiscoverFilters,
  type DiscoverFilters,
  type OpportunitySort,
} from "@arch-competition/core";

import { todayIso, type Clock } from "../context";
import { likeContains, placeholders, type SqlStatement } from "../driver/sql";
import type { SqlParameter } from "../driver/types";
import { resolveProcedureFilterValues } from "../procedure-types";

/**
 * Discover query -> SQL. Filtering, sorting and paging all happen in SQLite/D1; nothing here
 * ever reads the whole table.
 */
export type NormalizedQuery = DiscoverFilters & {
  limit: number;
  offset: number;
  sort: OpportunitySort;
};

/**
 * Storage does not trust its callers either: the same lenient schema the web uses clamps
 * numbers and drops malformed dates/enums, then defaults are applied.
 */
export const normalizeQuery = (query: DiscoverFilters = {}): NormalizedQuery => {
  const parsed = parseDiscoverFilters(query, "lenient");
  const filters = parsed.ok ? parsed.filters : {};
  return {
    ...filters,
    limit: filters.limit ?? DISCOVER_DEFAULT_LIMIT,
    offset: filters.offset ?? 0,
    sort: filters.sort ?? "deadline",
  };
};

/** Next calendar day as `YYYY-MM-DD`, so `deadline_at < next-day` includes timestamps of that day. */
const nextDay = (isoDate: string) => {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
};

/**
 * SQLite LIKE is ASCII case-insensitive only. To let "österreich" find "Österreich" without a
 * dedicated normalised column, match the term as typed, lower-cased and capitalised.
 */
const searchVariants = (term: string) => {
  const lower = term.toLocaleLowerCase();
  const capitalised = lower.charAt(0).toLocaleUpperCase() + lower.slice(1);
  return [...new Set([term, lower, capitalised])];
};

const SEARCH_COLUMNS = ["title", "authority_name", "organizer", "source_name", "official_notice_id"] as const;

const classificationCondition = (column: string, values: string[], parameters: SqlParameter[]) => {
  parameters.push(...values);
  // json_valid() keeps a single corrupted row from failing the whole query.
  return `CASE WHEN json_valid(${column}) THEN EXISTS (SELECT 1 FROM json_each(competitions.${column}) WHERE value IN (${placeholders(values.length)})) ELSE 0 END`;
};

export const buildWhere = (query: NormalizedQuery, clock: Clock) => {
  const conditions: string[] = [];
  const parameters: SqlParameter[] = [];
  const today = todayIso(clock);
  // Only current AI exclusions affect discovery; canonical facts and human decisions survive.
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM ai_screening_results ai
    WHERE ai.competition_id = competitions.id
      AND ai.source_updated_at = competitions.updated_at
      AND ai.decision = 'exclude'
      AND competitions.status NOT IN ('shortlisted', 'verified')
  )`);

  if (query.search) {
    const clauses: string[] = [];
    for (const variant of searchVariants(query.search)) {
      for (const column of SEARCH_COLUMNS) {
        clauses.push(`${column} LIKE ? ESCAPE '\\'`);
        parameters.push(likeContains(variant));
      }
    }
    conditions.push(`(${clauses.join(" OR ")})`);
  }
  if (query.jurisdiction) {
    conditions.push("jurisdiction = ?");
    parameters.push(query.jurisdiction);
  }
  if (query.procedureType) {
    const values = resolveProcedureFilterValues(query.procedureType);
    if (values.length === 0) {
      conditions.push("1 = 0");
    } else {
      conditions.push(`procedure_type IN (${placeholders(values.length)})`);
      parameters.push(...values);
    }
  }
  if (query.implementationPath) {
    conditions.push("implementation_path = ?");
    parameters.push(query.implementationPath);
  }
  if (query.licensedArchitectRequired !== undefined) {
    conditions.push("licensed_architect_required = ?");
    parameters.push(query.licensedArchitectRequired ? 1 : 0);
  }
  if (query.minQualificationScore !== undefined) {
    conditions.push("COALESCE(qualification_score, 0) >= ?");
    parameters.push(query.minQualificationScore);
  }
  if (query.publishedWithinDays !== undefined) {
    const threshold = new Date(clock.now().getTime() - query.publishedWithinDays * 86_400_000);
    conditions.push("discovered_at >= ?");
    parameters.push(threshold.toISOString());
  }

  // Visibility: archived/discarded never show by default; expired notices need an explicit opt-in.
  conditions.push(
    query.includeExpired === true ? "status != 'discarded'" : "status NOT IN ('archived', 'discarded')",
  );
  if (query.includeExpired === true) {
    if (query.deadlineAfter) {
      conditions.push("deadline_at >= ?");
      parameters.push(query.deadlineAfter);
    }
  } else if (query.deadlineAfter) {
    conditions.push("deadline_at >= ?");
    parameters.push(query.deadlineAfter >= today ? query.deadlineAfter : today);
  } else {
    conditions.push("(deadline_at IS NULL OR deadline_at >= ?)");
    parameters.push(today);
  }
  if (query.deadlineBefore) {
    conditions.push("deadline_at < ?");
    parameters.push(nextDay(query.deadlineBefore));
  }

  // Unknown (NULL) contract values never satisfy a value bound: unknown is not zero.
  if (query.minEstimatedValueEur !== undefined) {
    conditions.push("estimated_contract_value_eur >= ?");
    parameters.push(query.minEstimatedValueEur);
  }
  if (query.maxEstimatedValueEur !== undefined) {
    conditions.push("estimated_contract_value_eur <= ?");
    parameters.push(query.maxEstimatedValueEur);
  }

  if (query.projectTypes?.length) {
    conditions.push(classificationCondition("project_types", query.projectTypes, parameters));
  }
  if (query.buildingCategories?.length) {
    conditions.push(classificationCondition("building_categories", query.buildingCategories, parameters));
  }
  if (query.designScopes?.length) {
    conditions.push(classificationCondition("design_scopes", query.designScopes, parameters));
  }
  if (query.projectModes?.length) {
    conditions.push(classificationCondition("project_modes", query.projectModes, parameters));
  }

  return { clause: `WHERE ${conditions.join(" AND ")}`, parameters };
};

const ORDER_BY: Record<OpportunitySort, string> = {
  deadline:
    "COALESCE(deadline_at, '9999-12-31') ASC, COALESCE(qualification_score, 0) DESC, updated_at DESC, id ASC",
  highest_value:
    "COALESCE(estimated_contract_value_eur, 0) DESC, COALESCE(qualification_score, 0) DESC, updated_at DESC, id ASC",
  latest: "updated_at DESC, COALESCE(qualification_score, 0) DESC, id ASC",
};

export const OPPORTUNITY_COLUMNS = [
  "id",
  "dedup_key",
  "title",
  "organizer",
  "authority_name",
  "official_url",
  "source_url",
  "source_id",
  "source_name",
  "status",
  "opportunity_type",
  "jurisdiction",
  "procedure_type",
  "official_notice_id",
  "regions",
  "languages",
  "competition_types",
  "project_types",
  "building_categories",
  "official_sectors",
  "built_asset_types",
  "design_scopes",
  "project_modes",
  "audience",
  "cpv_codes",
  "implementation_path",
  "licensed_architect_required",
  "local_partner_required",
  "registration_fee_eur",
  "submission_fee_eur",
  "estimated_contract_value_eur",
  "estimated_contract_value_text",
  "prize_summary",
  "location_label",
  "geo_lat",
  "geo_lng",
  "geo_source",
  "geo_confidence",
  "deadline_at",
  "eligibility_summary",
  "brief_pdf_url",
  "documents_portal_url",
  "extraction_confidence",
  "evidence_level",
  "qualification_score",
  "evidence_note",
  "last_verified_at",
  "discovered_at",
  "updated_at",
].join(", ");

export const buildCountStatement = (query: NormalizedQuery, clock: Clock): SqlStatement => {
  const { clause, parameters } = buildWhere(query, clock);
  return { parameters, sql: `SELECT COUNT(*) AS total FROM competitions ${clause}` };
};

export const buildPageStatement = (query: NormalizedQuery, clock: Clock): SqlStatement => {
  const { clause, parameters } = buildWhere(query, clock);
  return {
    parameters: [...parameters, query.limit, query.offset],
    sql: `SELECT ${OPPORTUNITY_COLUMNS} FROM competitions ${clause} ORDER BY ${ORDER_BY[query.sort]} LIMIT ? OFFSET ?`,
  };
};
