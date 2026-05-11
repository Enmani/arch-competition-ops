"use client";

import { useState, useTransition } from "react";

import type { StoredOpportunityFeedItem, StoredOpportunityQuery } from "@arch-competition/storage/cloudflare";

import { OpportunityStreamItem } from "@/components/opportunity-stream-item";
import { serializeSearchParams, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { buildDiscoverSearchParams } from "@/lib/discover";

type DiscoverFeedProps = {
  dictionary: AppDictionary;
  initialItems: StoredOpportunityFeedItem[];
  initialWatchedIds: string[];
  locale: AppLocale;
  routeBase: string;
  total: number;
  workspaceWritesEnabled: boolean;
  filters: StoredOpportunityQuery;
};

const DISCOVER_BATCH_SIZE = 36;

type OpportunityFeedPayload = {
  opportunities: StoredOpportunityFeedItem[];
  total: number;
};

export const DiscoverFeed = ({
  dictionary,
  filters,
  initialItems,
  initialWatchedIds,
  locale,
  routeBase,
  total,
  workspaceWritesEnabled,
}: DiscoverFeedProps) => {
  const [items, setItems] = useState(initialItems);
  const [watchedIds, setWatchedIds] = useState(() => new Set(initialWatchedIds));
  const [loadedTotal, setLoadedTotal] = useState(total);
  const [isPending, startTransition] = useTransition();
  const hasMore = items.length < loadedTotal;

  const loadMore = () => {
    if (isPending || !hasMore) {
      return;
    }

    startTransition(() => {
      void (async () => {
        const nextSearch = serializeSearchParams(
          buildDiscoverSearchParams({
            ...filters,
            limit: DISCOVER_BATCH_SIZE,
            offset: items.length,
          }),
        );

        const response = await fetch(`/api/opportunities${nextSearch}`, {
          headers: {
            accept: "application/json",
          },
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as OpportunityFeedPayload;
        if (payload.opportunities.length === 0) {
          setLoadedTotal(payload.total);
          return;
        }

        setItems((current) => [...current, ...payload.opportunities]);
        setLoadedTotal(payload.total);
      })();
    });
  };

  return (
    <>
      <section className="waterfall-feed" aria-label={dictionary.discover.feedRegionLabel}>
        {items.map((opportunity, index) => (
          <OpportunityStreamItem
            dictionary={dictionary}
            index={index}
            isWatched={watchedIds.has(opportunity.id)}
            key={opportunity.id}
            locale={locale}
            onWatchChange={(nextWatched) => {
              setWatchedIds((current) => {
                const next = new Set(current);
                if (nextWatched) {
                  next.add(opportunity.id);
                } else {
                  next.delete(opportunity.id);
                }
                return next;
              });
            }}
            opportunity={opportunity}
            workspaceWritesEnabled={workspaceWritesEnabled}
          />
        ))}
      </section>

      {hasMore ? (
        <div className="discover-feed-footer">
          <button className="button secondary discover-load-more" disabled={isPending} onClick={loadMore} type="button">
            {isPending ? dictionary.discover.buttons.loadingMore : dictionary.discover.buttons.loadMore}
          </button>
          <p className="discover-feed-status">
            {items.length} / {loadedTotal}
          </p>
        </div>
      ) : null}
    </>
  );
};
