import { NextResponse } from "next/server";

import { collectDiscoverSearchParams, readDiscoverFilters } from "@/lib/discover";
import { queryWebOpportunityFeed } from "@/lib/server-storage";

export const GET = async (request: Request) => {
  const url = new URL(request.url);
  const filters = readDiscoverFilters(collectDiscoverSearchParams(url.searchParams));
  const opportunities = await queryWebOpportunityFeed(filters);

  return NextResponse.json({
    filters,
    opportunities,
    total: opportunities.length,
  });
};
