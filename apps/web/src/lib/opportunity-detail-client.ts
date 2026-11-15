import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import { requestJson } from "@/lib/api-client";

/**
 * Browser-side detail cache. One request per opportunity per page visit: hovering a card starts
 * it, opening the sheet joins it, and reopening reuses it. A failed request is forgotten so the
 * next open tries again. HTTP caching (see the API route) covers later visits.
 */
const requests = new Map<string, Promise<StoredOpportunityFeedItem | null>>();

export const loadOpportunityDetail = (slug: string): Promise<StoredOpportunityFeedItem | null> => {
  let request = requests.get(slug);
  if (!request) {
    request = requestJson<{ opportunity: StoredOpportunityFeedItem }>(
      `/api/opportunities/${encodeURIComponent(slug)}`,
    ).then((result) => {
      if (!result.ok) {
        requests.delete(slug);
        return null;
      }
      return result.data.opportunity;
    });
    requests.set(slug, request);
  }
  return request;
};
