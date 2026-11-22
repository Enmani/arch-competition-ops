import { apiDeps } from "@/lib/api/deps";
import { createOpportunitiesHandlers } from "@/lib/api/opportunities";
import { withOpportunityPreviews } from "@/lib/opportunity-preview-assets";

export const dynamic = "force-dynamic";

export const { GET } = createOpportunitiesHandlers(apiDeps, withOpportunityPreviews);
