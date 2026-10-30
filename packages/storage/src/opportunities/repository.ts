import { noticeDetailSchema, type DiscoverFilters } from "@arch-competition/core";

import type { StorageContext } from "../context";
import { MAX_BOUND_PARAMETERS, chunk, placeholders, readBatch, readRows } from "../driver/sql";
import { buildFacetStatements, buildFilterOptions, type FacetRow } from "./facets";
import { toOpportunityFeedItem } from "./mapper";
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
): Promise<StoredOpportunityFeedItem[]> => {
  const statement = buildPageStatement(normalizeQuery(filters), context.clock);
  const rows = await readRows<OpportunityRow>(context.reader, statement.sql, statement.parameters);
  return rows.map((row) => toOpportunityFeedItem(row, context.logger));
};

/**
 * Discover page/API payload. Count, page and filter options are independent SELECTs
 * sent as ONE batch (a single D1 subrequest) and all filtered/sorted/paged inside SQL.
 */
export const getDiscoverSurfaceData = async (
  context: StorageContext,
  filters: DiscoverFilters = {},
): Promise<StoredDiscoverSurfaceData> => {
  const query = normalizeQuery(filters);
  const [countRows, pageRows, ...facetRowGroups] = await readBatch(context.reader, [
    buildCountStatement(query, context.clock),
    buildPageStatement(query, context.clock),
    ...buildFacetStatements(query, context.clock),
  ]);

  return {
    filterOptions: buildFilterOptions(facetRowGroups.flat() as FacetRow[], query),
    opportunities: (pageRows as OpportunityRow[]).map((row) => toOpportunityFeedItem(row, context.logger)),
    total: Number((countRows[0] as { total?: number } | undefined)?.total ?? 0),
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

/** Primary-key lookup. Accepts the slug as routed or percent-decoded (non-ASCII ids). */
export const getOpportunityBySlug = async (
  context: StorageContext,
  slug: string,
): Promise<StoredOpportunityFeedItem | undefined> => {
  const candidates = slugCandidates(slug);
  const rows = await readRows<OpportunityRow>(
    context.reader,
    `SELECT ${OPPORTUNITY_COLUMNS} FROM competitions WHERE id IN (${placeholders(candidates.length)})`,
    candidates,
  );
  for (const candidate of candidates) {
    const row = rows.find((item) => item.id === candidate);
    if (row) {
      const item = toOpportunityFeedItem(row, context.logger);
      const published = await readRows<{ result_json: string }>(
        context.reader,
        "SELECT result_json FROM ai_screening_results WHERE competition_id = ? AND source_updated_at = ?",
        [row.id, row.updated_at],
      );
      try {
        const result: unknown = JSON.parse(published[0]?.result_json ?? "{}");
        if (result && typeof result === "object" && "notice_details" in result && Array.isArray(result.notice_details)) {
          item.noticeDetails = result.notice_details.flatMap((detail: unknown) => {
            const parsed = noticeDetailSchema.safeParse(detail);
            return parsed.success && parsed.data.quote.includes(parsed.data.text) ? [parsed.data] : [];
          });
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
