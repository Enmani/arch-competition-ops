import Link from "next/link";

import { DISCOVER_MAX_LIMIT } from "@arch-competition/core";
import { workspaceKeyForUser, type StoredOpportunityFeedItem } from "@arch-competition/storage";

import { DiscoverDock } from "@/components/discover-dock";
import { DiscoverFeed } from "@/components/discover-feed";
import { buildLocalePath, serializeSearchParams, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { pickDiscoverDockCopy, pickDiscoverFeedCopy } from "@/i18n/slices";
import { getCurrentAuthUser } from "@/lib/auth";
import {
  buildDiscoverPageSearchParams,
  countActiveDiscoverFilters,
  readDiscoverPageState,
  type DiscoverSearchParams,
} from "@/lib/discover";
import { appendFeedPage, createFeedState } from "@/lib/feed-pagination";
import { getStorage } from "@/lib/server-storage";

type DiscoverSurfaceProps = {
  dictionary: AppDictionary;
  locale: AppLocale;
  searchParams: DiscoverSearchParams;
};

export const DiscoverSurface = async ({ dictionary, locale, searchParams }: DiscoverSurfaceProps) => {
  const { filters, loaded } = readDiscoverPageState(searchParams);
  const storage = await getStorage();
  const user = await getCurrentAuthUser();

  // `loaded` restores a deep list (reload, back button, shared link). The API caps one page at
  // DISCOVER_MAX_LIMIT, so the first page also returns the total and filter options and the
  // rest is fetched as plain pages in parallel.
  const firstSize = Math.min(loaded, DISCOVER_MAX_LIMIT);
  const extraPages = Array.from(
    { length: Math.ceil((loaded - firstSize) / DISCOVER_MAX_LIMIT) },
    (_, index) => ({
      limit: Math.min(DISCOVER_MAX_LIMIT, loaded - firstSize - index * DISCOVER_MAX_LIMIT),
      offset: firstSize + index * DISCOVER_MAX_LIMIT,
    }),
  );
  const [first, extras, watchedOpportunityIds] = await Promise.all([
    storage.opportunities.discover({ ...filters, limit: firstSize, offset: 0 }),
    Promise.all(extraPages.map((page) => storage.opportunities.feed({ ...filters, ...page }))),
    user ? storage.watchlist.listIds(workspaceKeyForUser(user.id)) : Promise.resolve([] as string[]),
  ]);
  const { filterOptions, opportunities, total } = first;
  const feed = extras.reduce(
    (state, page) => appendFeedPage(state, { opportunities: page, total }),
    createFeedState<StoredOpportunityFeedItem>(opportunities, total),
  );

  const routeBase = buildLocalePath(locale, "/discover");
  const filtersKey = serializeSearchParams(buildDiscoverPageSearchParams(filters)) || "none";

  return (
    <main className="discover-page">
      <DiscoverDock
        activeFilterCount={countActiveDiscoverFilters(filters)}
        copy={pickDiscoverDockCopy(dictionary)}
        filterOptions={filterOptions}
        filters={filters}
        routeBase={routeBase}
        signedIn={user !== null}
      />

      {feed.items.length > 0 ? (
        <DiscoverFeed
          copy={pickDiscoverFeedCopy(dictionary)}
          filters={filters}
          initialItems={feed.items}
          initialNextOffset={feed.nextOffset}
          initialTotal={feed.total}
          initialWatchedIds={watchedOpportunityIds}
          key={filtersKey}
          locale={locale}
          routeBase={routeBase}
          signedIn={user !== null}
        />
      ) : (
        <section className="empty-state">
          <span className="eyebrow">{dictionary.discover.empty.eyebrow}</span>
          <h2>{dictionary.discover.empty.title}</h2>
          <p>{dictionary.discover.empty.body}</p>
          <Link className="button primary" href={routeBase}>
            {dictionary.discover.buttons.clearFilters}
          </Link>
        </section>
      )}
    </main>
  );
};
