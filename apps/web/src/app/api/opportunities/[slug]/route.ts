import { apiDeps } from "@/lib/api/deps";
import { createOpportunityDetailHandlers } from "@/lib/api/opportunities";
import { withOpportunityPreviews } from "@/lib/opportunity-preview-assets";

export const dynamic = "force-dynamic";

const { GET: getDetail } = createOpportunityDetailHandlers(apiDeps, withOpportunityPreviews);

export const GET = async (request: Request, context: { params: Promise<{ slug: string }> }) =>
  getDetail(request, (await context.params).slug);
