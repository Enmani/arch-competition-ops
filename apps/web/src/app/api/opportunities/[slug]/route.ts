import { apiDeps } from "@/lib/api/deps";
import { createOpportunityDetailHandlers } from "@/lib/api/opportunities";

export const dynamic = "force-dynamic";

const { GET: getDetail } = createOpportunityDetailHandlers(apiDeps);

export const GET = async (request: Request, context: { params: Promise<{ slug: string }> }) =>
  getDetail(request, (await context.params).slug);
