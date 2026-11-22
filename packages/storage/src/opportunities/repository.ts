import { aiAssessmentSchema, noticeDetailSchema, type DiscoverFilters } from "@arch-competition/core";

import type { StorageContext } from "../context";
import { MAX_BOUND_PARAMETERS, chunk, placeholders, readBatch, readRows } from "../driver/sql";
import { buildAggregateStatement, isOversizeAggregate, unpackAggregate } from "./aggregate";
import { issueContinuation, readContinuation, readWithPublication } from "./continuation";
import { buildFacetStatements, buildFilterOptions, type FacetRow } from "./facets";
import { toOpportunityFeedItem, toOpportunityLocation } from "./mapper";
import {
  OPPORTUNITY_COLUMNS,
  buildCountStatement,
  buildPageStatement,
  normalizeQuery,
} from "./query";
import type { OpportunityRow, StoredDiscoverSurfaceData, StoredOpportunityFeedItem } from "./types";

/** A paged list for APIs that do not need filter options or the total. */
export const queryOpportunityFeed = async (
  context: StorageContext,
  filters: DiscoverFilters = {},
  asOf = context.clock.now(),
): Promise<StoredOpportunityFeedItem[]> => {
  const statement = buildPageStatement(normalizeQuery(filters), { now: () => asOf });
  const rows = await readRows<OpportunityRow>(context.reader, statement.sql, statement.parameters);
  return rows.map((row) => toOpportunityFeedItem(row, context.logger));
};

const pageItems = (context: StorageContext, rows: unknown[]) =>
  (rows as OpportunityRow[]).map((row) => toOpportunityFeedItem(row, context.logger));

const exactTotal = (rows: unknown[]) => Number((rows[0] as { total?: number } | undefined)?.total ?? 0);

/** The original public list contract needs an exact total and a page, with no option groups. */
export const getOpportunityList = async (context: StorageContext, filters: DiscoverFilters = {}) => {
  const query = normalizeQuery(filters);
  const now = context.clock.now();
  const clock = { now: () => now };
  const [count, page] = await readBatch(context.reader, [
    buildCountStatement(query, clock),
    buildPageStatement(query, clock),
  ]);
  return { opportunities: pageItems(context, page), total: exactTotal(count) };
};

export const continueOpportunityList = async (context: StorageContext, filters: DiscoverFilters, token: string) => {
  const query = normalizeQuery(filters);
  const continuation = readContinuation(token, context.clock.now(), query);
  if (!continuation) return null;
  const { version, rows: [page] } = await readWithPublication(context, [
    buildPageStatement(query, { now: () => continuation.asOf }),
  ]);
  return version === continuation.version ? pageItems(context, page) : null;
};

/** Read exact options, total and the requested part of the feed in one snapshot. */
export const getDiscoverSurfaceData = async (
  context: StorageContext,
  filters: DiscoverFilters = {},
  restoredLimit?: number,
): Promise<StoredDiscoverSurfaceData> => {
  const query = normalizeQuery(filters);
  const now = context.clock.now();
  const clock = { now: () => now };
  const pageQuery = restoredLimit === undefined ? query : { ...query, limit: restoredLimit };
  const page = buildPageStatement(pageQuery, clock);
  try {
    const { version, rows: [summary, pageRows] } = await readWithPublication(context, [
      buildAggregateStatement(query, clock),
      page,
    ]);
    const { payload } = summary[0] as { payload: string | null };
    if (payload !== null) {
      return {
        ...unpackAggregate(payload, query),
        continuation: issueContinuation(version, now, query),
        opportunities: pageItems(context, pageRows),
      };
    }
  } catch (error) {
    if (!isOversizeAggregate(error)) throw error;
  }
  const { version, rows: [countRows, pageRows, ...facetRowGroups] } = await readWithPublication(context, [
    buildCountStatement(query, clock),
    page,
    ...buildFacetStatements(query, clock),
  ]);
  return {
    continuation: issueContinuation(version, now, query),
    filterOptions: buildFilterOptions(facetRowGroups.flat() as FacetRow[], query),
    opportunities: pageItems(context, pageRows),
    total: exactTotal(countRows),
  };
};

const slugCandidates = (slug: string) => {
  const candidates = [slug];
  try {
    const decoded = decodeURIComponent(slug);
    if (decoded !== slug) {
      candidates.push(decoded);
    }
  } catch {
    // Malformed percent-encoding in a URL is user input, not a fault: look up the raw value only.
  }
  return candidates;
};

/** Read the inputs for the locator renderer without loading detail or the AI projection. */
export const getOpportunityLocation = async (context: StorageContext, slug: string) => {
  const candidates = slugCandidates(slug);
  const rows = await readRows<Parameters<typeof toOpportunityLocation>[0] & { id: string }>(
    context.reader,
    `SELECT id, title, authority_name, organizer, jurisdiction, location_label, geo_lat, geo_lng
      FROM competitions WHERE id IN (${placeholders(candidates.length)})`,
    candidates,
  );
  const row = candidates.map((id) => rows.find((item) => item.id === id)).find((item) => item !== undefined);
  return row && toOpportunityLocation(row);
};

/** Primary-key lookup. Accepts the slug as routed or percent-decoded (non-ASCII ids). */
export const getOpportunityBySlug = async (
  context: StorageContext,
  slug: string,
): Promise<StoredOpportunityFeedItem | undefined> => {
  const candidates = slugCandidates(slug);
  // The record and its published assessment go out as one batch (one D1 round trip); the
  // assessment is matched to the record's current revision here, after both have arrived.
  const [recordRows, assessmentRows] = await readBatch(context.reader, [
    {
      sql: `SELECT ${OPPORTUNITY_COLUMNS} FROM competitions WHERE id IN (${placeholders(candidates.length)})`,
      parameters: candidates,
    },
    {
      sql: `SELECT competition_id, source_updated_at, result_json FROM ai_screening_results WHERE competition_id IN (${placeholders(candidates.length)})`,
      parameters: candidates,
    },
  ]);
  const rows = recordRows as OpportunityRow[];
  const assessments = assessmentRows as { competition_id: string; result_json: string; source_updated_at: string }[];
  for (const candidate of candidates) {
    const row = rows.find((item) => item.id === candidate);
    if (row) {
      const item = toOpportunityFeedItem(row, context.logger);
      const published = assessments.filter(
        (entry) => entry.competition_id === row.id && entry.source_updated_at === row.updated_at,
      );
      try {
        const result: unknown = JSON.parse(published[0]?.result_json ?? "{}");
        if (result && typeof result === "object" && "notice_details" in result && Array.isArray(result.notice_details)) {
          item.noticeDetails = result.notice_details.flatMap((detail: unknown) => {
            const parsed = noticeDetailSchema.safeParse(detail);
            return parsed.success && parsed.data.quote.includes(parsed.data.text) ? [parsed.data] : [];
          });
        }
        const assessment = aiAssessmentSchema.safeParse(result);
        if (assessment.success) {
          const nonBlank = (values: string[]) => values.filter((value) => value !== "");
          item.aiAssessment = {
            decision: assessment.data.decision,
            missingInformation: nonBlank(assessment.data.missing_information),
            reasonsEn: nonBlank(assessment.data.reasons_en),
            reasonsZh: nonBlank(assessment.data.reasons_zh),
            summaryEn: assessment.data.summary_en,
            summaryZh: assessment.data.summary_zh,
          };
        }
      } catch {
        // A corrupt advisory projection must not hide the canonical opportunity.
        context.logger.warn("Invalid opportunity participation excerpts", { competitionId: row.id });
      }
      return item;
    }
  }
  return undefined;
};

/** Batch primary-key lookup (dashboard): results follow the order of `ids`; unknown ids are skipped. */
export const getOpportunitiesByIds = async (
  context: StorageContext,
  ids: string[],
): Promise<StoredOpportunityFeedItem[]> => {
  const uniqueIds = [...new Set(ids)];
  const byId = new Map<string, StoredOpportunityFeedItem>();
  for (const idChunk of chunk(uniqueIds, MAX_BOUND_PARAMETERS)) {
    const rows = await readRows<OpportunityRow>(
      context.reader,
      `SELECT ${OPPORTUNITY_COLUMNS} FROM competitions WHERE id IN (${placeholders(idChunk.length)})`,
      idChunk,
    );
    for (const row of rows) {
      byId.set(row.id, toOpportunityFeedItem(row, context.logger));
    }
  }
  return uniqueIds.flatMap((id) => {
    const item = byId.get(id);
    return item ? [item] : [];
  });
};
