"use client";

import { useRef, useState } from "react";

import type { StoredOpportunityFeedItem, StoredOpportunityQuery } from "@arch-competition/storage";

import { OpportunityStreamItem } from "@/components/opportunity-stream-item";
import { serializeSearchParams, type AppLocale } from "@/i18n/config";
import { fillTemplate } from "@/i18n/format";
import type { DiscoverFeedCopy } from "@/i18n/slices";
import { describeApiFailure, requestJson, type ApiFailure } from "@/lib/api-client";
import { buildDiscoverPageSearchParams, buildDiscoverSearchParams, DISCOVER_PAGE_SIZE } from "@/lib/discover";
import {
  appendFeedPage,
  createFeedState,
  hasMoreItems,
  type FeedPage,
  type FeedState,
} from "@/lib/feed-pagination";

type DiscoverFeedProps = {
  copy: DiscoverFeedCopy;
  filters: StoredOpportunityQuery;
  initialItems: StoredOpportunityFeedItem[];
  initialNextOffset: number;
  initialTotal: number;
  initialWatchedIds: string[];
  locale: AppLocale;
  routeBase: string;
  signedIn: boolean;
};

/**
 * The parent mounts this with `key` set to the serialized filters, so changing a filter
 * discards the list, offsets and any pending state instead of merging into stale results.
 *
 * Load-more is self-managed: a ref blocks duplicate clicks synchronously, pages are merged by
 * id, and the loaded count is written to the URL (`loaded`) so reload and the back button
 * restore the same depth.
 */
export const DiscoverFeed = ({
  copy,
  filters,
  initialItems,
  initialNextOffset,
  initialTotal,
  initialWatchedIds,
  locale,
  routeBase,
  signedIn,
}: DiscoverFeedProps) => {
  const [feed, setFeed] = useState<FeedState<StoredOpportunityFeedItem>>(() =>
    createFeedState(initialItems, initialTotal, initialNextOffset),
  );
  const [watchedIds, setWatchedIds] = useState(() => new Set(initialWatchedIds));
  const [isLoading, setIsLoading] = useState(false);
  const [failure, setFailure] = useState<ApiFailure | null>(null);
  const inFlightRef = useRef(false);
  const feedRef = useRef(feed);
  const hasMore = hasMoreItems(feed);

  const loadMore = async () => {
    if (inFlightRef.current || !hasMoreItems(feedRef.current)) {
      return;
    }

    inFlightRef.current = true;
    setIsLoading(true);
    setFailure(null);

    const search = serializeSearchParams(
      buildDiscoverSearchParams({ ...filters, limit: DISCOVER_PAGE_SIZE, offset: feedRef.current.nextOffset }),
    );
    const result = await requestJson<FeedPage<StoredOpportunityFeedItem>>(`/api/opportunities${search}`);

    inFlightRef.current = false;
    setIsLoading(false);
    if (!result.ok) {
      setFailure(result.failure);
      return;
    }

    const next = appendFeedPage(feedRef.current, result.data);
    feedRef.current = next;
    setFeed(next);
    // Remember the depth without a navigation: reload and back keep the same number of items.
    const url = `${routeBase}${serializeSearchParams(buildDiscoverPageSearchParams(filters, next.items.length))}`;
    window.history.replaceState(window.history.state, "", url);
  };

  const handleWatchChange = (opportunityId: string, nextWatched: boolean) => {
    setWatchedIds((current) => {
      const next = new Set(current);
      if (nextWatched) {
        next.add(opportunityId);
      } else {
        next.delete(opportunityId);
      }
      return next;
    });
  };

  return (
    <>
      <section aria-label={copy.discover.feedRegionLabel} className="waterfall-feed">
        {feed.items.map((opportunity, index) => (
          <OpportunityStreamItem
            copy={copy}
            index={index}
            isWatched={watchedIds.has(opportunity.id)}
            key={opportunity.id}
            locale={locale}
            onWatchChange={(nextWatched) => handleWatchChange(opportunity.id, nextWatched)}
            opportunity={opportunity}
            signedIn={signedIn}
          />
        ))}
      </section>

      <div className="discover-feed-footer">
        <p aria-live="polite" className="discover-feed-status" role="status">
          {hasMore
            ? fillTemplate(copy.common.templates.progress, { shown: feed.items.length, total: feed.total })
            : copy.discover.feed.allLoaded}
        </p>
        {failure ? (
          <p className="discover-feed-error" role="alert">
            {copy.discover.feed.loadMoreError} {describeApiFailure(copy.common.apiErrors, failure)}
          </p>
        ) : null}
        {hasMore ? (
          <button
            aria-busy={isLoading}
            className="button secondary discover-load-more"
            disabled={isLoading}
            onClick={() => void loadMore()}
            type="button"
          >
            {isLoading
              ? copy.discover.buttons.loadingMore
              : failure
                ? copy.common.retry
                : copy.discover.buttons.loadMore}
          </button>
        ) : null}
      </div>
    </>
  );
};
