import { DISCOVER_DEFAULT_LIMIT, parseDiscoverQuery } from "@arch-competition/core";

import type { AuthDeps } from "../auth";
import { HttpError, PUBLIC_LIST_CACHE_CONTROL, guarded, jsonResponse, searchParamsToRecord } from "./http";

/** Public, read-only discover feed. Filtering, sorting and paging happen in SQL. */
export const createOpportunitiesHandlers = (deps: Pick<AuthDeps, "getStorage">) => ({
  GET: guarded("GET /api/opportunities", async (request: Request) => {
    const parsed = parseDiscoverQuery(searchParamsToRecord(new URL(request.url).searchParams), "strict");
    if (!parsed.ok) {
      throw new HttpError("invalid_request", `Invalid query. ${parsed.issues.slice(0, 3).join("; ")}`);
    }

    const { opportunities, total } = await (await deps.getStorage()).opportunities.discover(parsed.filters);
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
