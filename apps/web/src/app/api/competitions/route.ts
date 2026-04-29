import { GET as getOpportunities } from "@/app/api/opportunities/route";

export const runtime = "nodejs";

export const GET = (request: Request) => {
  return getOpportunities(request);
};
