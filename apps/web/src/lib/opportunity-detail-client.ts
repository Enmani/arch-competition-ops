import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import { requestJson } from "@/lib/api-client";

const DETAIL_TTL_MS = 60_000;
const requests = new Map<string, {
  expiresAt: number;
  promise: Promise<StoredOpportunityFeedItem | null>;
}>();

/** Share in-flight detail requests. Reopenings revalidate after the browser HTTP cache lifetime. */
export const loadOpportunityDetail = (slug: string): Promise<StoredOpportunityFeedItem | null> => {
  const now = Date.now();
  const cached = requests.get(slug);
  if (cached && cached.expiresAt > now) return cached.promise;

  const promise = requestJson<{ opportunity: StoredOpportunityFeedItem }>(
    `/api/opportunities/${encodeURIComponent(slug)}`,
  ).then((result) => {
    if (!result.ok && requests.get(slug)?.promise === promise) requests.delete(slug);
    return result.ok ? result.data.opportunity : null;
  });
  requests.set(slug, { expiresAt: now + DETAIL_TTL_MS, promise });
  return promise;
};
