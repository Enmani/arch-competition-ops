import { DISCOVER_DEFAULT_LIMIT, parseDiscoverQuery } from "@arch-competition/core";

import type { AuthDeps } from "../auth";
import { HttpError, PUBLIC_DETAIL_CACHE_CONTROL, PUBLIC_LIST_CACHE_CONTROL, guarded, jsonResponse, searchParamsToRecord } from "./http";

/** Public, read-only discover feed. Filtering, sorting and paging happen in SQL. */
export const createOpportunitiesHandlers = (deps: Pick<AuthDeps, "getStorage">) => ({
  GET: guarded("GET /api/opportunities", async (request: Request) => {
    const params = new URL(request.url).searchParams;
    const parsed = parseDiscoverQuery(searchParamsToRecord(params), "strict");
    if (!parsed.ok) {
      throw new HttpError("invalid_request", `Invalid query. ${parsed.issues.slice(0, 3).join("; ")}`);
    }

    const storage = (await deps.getStorage()).opportunities;
    const continuation = params.get("continuation");
    if (continuation !== null) {
      const opportunities = await storage.continue(parsed.filters, continuation);
      if (!opportunities) {
        throw new HttpError("conflict", "The discover snapshot expired or changed. Reload the first page.");
      }
      return jsonResponse({ opportunities });
    }

    const { opportunities, total } = await storage.list(parsed.filters);
    return jsonResponse(
      {
        filters: {
          ...parsed.filters,
          limit: parsed.filters.limit ?? DISCOVER_DEFAULT_LIMIT,
          offset: parsed.filters.offset ?? 0,
          sort: parsed.filters.sort ?? "deadline",
        },
        opportunities,
        total,
      },
      { cacheControl: PUBLIC_LIST_CACHE_CONTROL },
    );
  }),
});

/**
 * One opportunity with its published AI assessment. Public data only (nothing per visitor), so
 * browsers and the edge may cache it; the side sheet opens from list data and fills in from here.
 */
export const createOpportunityDetailHandlers = (deps: Pick<AuthDeps, "getStorage">) => ({
  GET: guarded("GET /api/opportunities/[slug]", async (_request: Request, slug: string) => {
    const opportunity = await (await deps.getStorage()).opportunities.getBySlug(slug);
    if (!opportunity) {
      throw new HttpError("not_found", "Opportunity not found.");
    }
    return jsonResponse({ opportunity }, { cacheControl: PUBLIC_DETAIL_CACHE_CONTROL });
  }),
});
