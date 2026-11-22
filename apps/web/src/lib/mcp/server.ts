import {
  closingSoonSchema, competitionDetailSchema, competitionPageSchema, competitionSearchSchema,
  competitionSlugSchema, competitionTaxonomySchema, createLogger, MCP_MAX_OFFSET,
  noArgumentsSchema, PARTICIPATION_FEE_FILTERS, PROJECT_TYPES, REGIONS, type DiscoverFilters,
} from "@arch-competition/core";
import { systemClock, type Clock, type Storage, type StoredOpportunityFeedItem } from "@arch-competition/storage";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

type PublicReads = Pick<Storage["opportunities"], "feed" | "getBySlug">;
export type GetPublicReads = () => Promise<PublicReads>;

const truth = "Unknown means unknown. Never invent a deadline or fee.";
const pagination = "Follow next_offset when present. If hasMore is true and next_offset is null, narrow your filters.";
const annotations = { readOnlyHint: true, openWorldHint: false };
const logger = createLogger("web.mcp");

const toolError = (text: string) => ({ isError: true, content: [{ type: "text" as const, text }] });
const result = (structuredContent: Record<string, unknown>) => ({
  structuredContent,
  content: [{ type: "text" as const, text: JSON.stringify(structuredContent) }],
});

async function read<T>(operation: () => Promise<T>) {
  try {
    return await operation();
  } catch {
    logger.error("opportunity_read_failed");
    throw new Error("Competition storage is unavailable. Please retry shortly.");
  }
}

const summary = (item: StoredOpportunityFeedItem) => ({
  slug: item.slug, title: item.title, jurisdiction: item.jurisdictionKey,
  regions: item.regions, project_types: item.projectTypes, deadline_at: item.deadlineAt,
  licensed_architect_required: item.licensedArchitectRequired,
  registration_fee_eur: item.registrationFeeEur, submission_fee_eur: item.submissionFeeEur,
});

export const createCompetitionServer = (getReads: GetPublicReads, clock: Clock = systemClock) => {
  const server = new McpServer({ name: "arch-competition-ops", version: "1.0.0" });

  const page = async (filters: DiscoverFilters & { limit: number; offset: number }, asOf = clock.now()) => {
    const { limit, offset } = filters;
    // One extra row tells the client whether to continue, without a COUNT or facet scan.
    const items = await read(async () => (await getReads()).feed({ ...filters, limit: limit + 1 }, asOf));
    const hasMore = items.length > limit;
    return result({
      competitions: items.slice(0, limit).map(summary),
      hasMore,
      next_offset: hasMore && offset + limit <= MCP_MAX_OFFSET ? offset + limit : null,
    });
  };

  server.registerTool("search_competitions", {
    annotations, inputSchema: competitionSearchSchema, outputSchema: competitionPageSchema,
    description: `Search active architecture competitions and public design procurements. All filters are optional and combined. Earliest deadline first. Use get_taxonomy for controlled values. Keep filters unchanged when paging. ${pagination} ${truth}`,
  }, (filters) => {
    if (filters.deadlineAfter && filters.deadlineBefore && filters.deadlineAfter > filters.deadlineBefore) {
      return toolError("deadlineAfter must be on or before deadlineBefore (YYYY-MM-DD).");
    }
    return page(filters);
  });

  server.registerTool("get_competition", {
    annotations, inputSchema: competitionSlugSchema, outputSchema: competitionDetailSchema,
    description: `Read a competition by its exact slug. Use official_url, source_url and evidence_note to verify facts. ${truth}`,
  }, async ({ slug }) => {
    const item = await read(async () => (await getReads()).getBySlug(slug));
    if (!item) return toolError("Competition not found. Copy an exact slug from search_competitions.");
    return result({
      ...summary(item), official_url: item.officialUrl, source_url: item.sourceUrl,
      evidence_note: item.evidenceNote, authority_name: item.authorityName,
      opportunity_type: item.opportunityTypeKey, eligibility_summary: item.eligibilitySummary,
      estimated_contract_value_eur: item.estimatedContractValueEur, prize_summary: item.prizeSummary,
      documents_portal_url: item.documentsPortalUrl, brief_pdf_url: item.briefPdfUrl,
    });
  });

  server.registerTool("list_closing_soon", {
    annotations, inputSchema: closingSoonSchema, outputSchema: competitionPageSchema,
    description: `List active notices with recorded deadlines in the next days, earliest first. Today is day 1 (UTC). ${pagination} ${truth}`,
  }, ({ days, limit, offset }) => {
    const start = clock.now();
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + days - 1);
    return page({ deadlineAfter: start.toISOString().slice(0, 10), deadlineBefore: end.toISOString().slice(0, 10), limit, offset }, start);
  });

  server.registerTool("get_taxonomy", {
    annotations, inputSchema: noArgumentsSchema, outputSchema: competitionTaxonomySchema,
    description: `Get the allowed region, projectTypes and participationFee values for search_competitions. Takes no arguments. Jurisdiction is an exact country key from a record. ${truth}`,
  }, () => result({ region: REGIONS, projectTypes: PROJECT_TYPES, participationFee: PARTICIPATION_FEE_FILTERS }));
  return server;
};
