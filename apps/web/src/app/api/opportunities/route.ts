import { NextResponse } from "next/server";

import {
  queryStoredOpportunityFeed,
} from "@arch-competition/storage";

import { collectDiscoverSearchParams, readDiscoverFilters } from "@/lib/discover";

export const runtime = "nodejs";

export const GET = (request: Request) => {
  const url = new URL(request.url);
  const filters = readDiscoverFilters(collectDiscoverSearchParams(url.searchParams));
  const opportunities = queryStoredOpportunityFeed(filters);

  return NextResponse.json({
    filters,
    opportunities,
    total: opportunities.length,
  });
};
