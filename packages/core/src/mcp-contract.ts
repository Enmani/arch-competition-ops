import { z } from "zod";

import { competitionFilterFields as fields } from "./discover-filters";
import { PARTICIPATION_FEE_FILTERS } from "./participation-fee";
import { PROJECT_TYPES, REGIONS } from "./taxonomy";

export const MCP_MAX_RESPONSE_BYTES = 128 * 1024;
export const MCP_MAX_OFFSET = 1000;
const paging = {
  limit: z.number().int().min(1).max(25).default(10).describe("Rows per page, 1–25. Default 10."),
  offset: z.number().int().min(0).max(MCP_MAX_OFFSET).default(0)
    .describe("Rows to skip, 0–1000. Start at 0, then use next_offset until null."),
};

export const competitionSearchSchema = z.object({
  search: fields.search.describe("Optional plain text in the title, buyer, publisher or notice ID (up to 200 characters)."),
  jurisdiction: fields.jurisdiction.describe("Exact stored country/jurisdiction key, e.g. italy (up to 200 characters)."),
  region: fields.region.describe("One stored geographic tag from get_taxonomy. Omit for all regions."),
  projectTypes: fields.projectTypes.describe("Match any listed project type from get_taxonomy (up to 20 values)."),
  deadlineAfter: fields.deadlineAfter.describe("Inclusive start date, YYYY-MM-DD. Search covers active notices."),
  deadlineBefore: fields.deadlineBefore.describe("Inclusive end date, YYYY-MM-DD. Date bounds exclude undated notices."),
  licensedArchitectRequired: fields.licensedArchitectRequired.describe("True requires a recorded requirement, false a recorded exemption. Omit to include unknowns."),
  participationFee: fields.participationFee.describe("free: both recorded fees zero; paid: either positive; unknown: insufficient evidence. Omit for all."),
  ...paging,
}).strict();

export const closingSoonSchema = z.object({
  days: z.number().int().min(1).max(90).default(7)
    .describe("Number of UTC calendar days including today. 1 means today only. Default 7, maximum 90."),
  ...paging,
}).strict();

export const competitionSlugSchema = z.object({
  slug: z.string().min(1).max(2048).describe("Exact slug returned by search_competitions or list_closing_soon."),
}).strict();
export const noArgumentsSchema = z.object({}).strict();

const summarySchema = z.object({
  slug: z.string(), title: z.string(), jurisdiction: z.string().nullable(),
  regions: z.array(z.string()), project_types: z.array(z.enum(PROJECT_TYPES)),
  deadline_at: z.string().nullable(), licensed_architect_required: z.boolean().nullable(),
  registration_fee_eur: z.number().nullable(), submission_fee_eur: z.number().nullable(),
  official_url: z.string().nullable(), source_url: z.string(), evidence_note: z.string(),
});

export const competitionPageSchema = z.object({
  competitions: z.array(summarySchema),
  hasMore: z.boolean().describe("Whether more records match after this page."),
  next_offset: z.number().int().nullable().describe("Offset for the next page, or null when none is available within the offset limit."),
});
export const competitionDetailSchema = summarySchema.extend({
  qualification_score: z.number().nullable().describe("Worker assessment based on recorded facts. May be absent. Used for browsing only."),
  authority_name: z.string(), opportunity_type: z.string(), eligibility_summary: z.string(),
  estimated_contract_value_eur: z.number().nullable(), prize_summary: z.string().nullable(),
  documents_portal_url: z.string().nullable(), brief_pdf_url: z.string().nullable(),
});

export const competitionTaxonomySchema = z.object({
  region: z.array(z.enum(REGIONS)), projectTypes: z.array(z.enum(PROJECT_TYPES)),
  participationFee: z.array(z.enum(PARTICIPATION_FEE_FILTERS)),
});
