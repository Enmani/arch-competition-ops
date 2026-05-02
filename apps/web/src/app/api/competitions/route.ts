import { GET as getOpportunities } from "@/app/api/opportunities/route";

export const GET = (request: Request) => {
  return getOpportunities(request);
};
